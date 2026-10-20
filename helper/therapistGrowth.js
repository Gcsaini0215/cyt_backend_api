import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Review from "../models/Review.js";
import Therapists from "../models/Therapists.js";
import Users from "../models/Users.js";
import FollowupNudge from "../models/FollowupNudge.js";

const DAY = 86400000;
const oid = (v) => new mongoose.Types.ObjectId(String(v));

/* ── 1. follow-ups: past clients with no session for 2+ weeks and nothing booked ── */
export const FOLLOWUP_MIN_DAYS = 14;
export const FOLLOWUP_MAX_DAYS = 180;
export const NUDGE_GAP_DAYS = 7; // one email per client per week, at most

export async function followupList(therapistId, now = Date.now()) {
  const tid = oid(therapistId);
  const rows = await Booking.aggregate([
    { $match: { therapist: tid, client: { $ne: null } } },
    { $group: {
      _id: "$client",
      lastDone: { $max: { $cond: [{ $eq: ["$status", "Completed"] }, "$booking_date", null] } },
      done: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
      upcoming: { $sum: { $cond: [{ $and: [{ $gt: ["$booking_date", new Date(now - 2 * 3600000)] }, { $not: [{ $in: ["$status", ["Cancelled", "Completed"]] }] }] }, 1, 0] } },
    } },
    { $match: { done: { $gt: 0 }, upcoming: 0, lastDone: { $lte: new Date(now - FOLLOWUP_MIN_DAYS * DAY), $gte: new Date(now - FOLLOWUP_MAX_DAYS * DAY) } } },
    { $sort: { lastDone: -1 } },
    { $limit: 40 },
  ]);
  if (!rows.length) return [];
  const ids = rows.map((r) => r._id);
  const [users, nudges] = await Promise.all([
    Users.find({ _id: { $in: ids } }, { name: 1, email: 1, phone: 1, profile: 1 }).lean(),
    FollowupNudge.aggregate([{ $match: { therapist: tid, client: { $in: ids } } }, { $group: { _id: "$client", at: { $max: "$at" }, emailAt: { $max: { $cond: [{ $eq: ["$channel", "email"] }, "$at", null] } } } }]),
  ]);
  const U = new Map(users.map((u) => [String(u._id), u]));
  const N = new Map(nudges.map((n) => [String(n._id), n]));
  return rows.map((r) => {
    const u = U.get(String(r._id)) || {};
    const nudgedAt = N.get(String(r._id))?.at || null;
    const emailedAt = N.get(String(r._id))?.emailAt || null;
    return {
      clientId: String(r._id),
      name: u.name || "Client",
      hasEmail: !!u.email,
      phone: String(u.phone || "").replace(/\D/g, "").slice(-12),
      photo: u.profile || "",
      lastSessionAt: r.lastDone,
      daysSince: Math.floor((now - new Date(r.lastDone).getTime()) / DAY),
      sessions: r.done,
      nudgedAt,
      canEmail: !!u.email && (!emailedAt || now - new Date(emailedAt).getTime() > NUDGE_GAP_DAYS * DAY),
    };
  });
}

/* ── 4. "Top therapist" badge ── */
export const BADGE_RULES = { minRating: 4.5, minReviews: 3, minSessions90: 5 };

export async function badgeProgress(t) {
  const since = new Date(Date.now() - 90 * DAY);
  const [rv, sessions] = await Promise.all([
    Review.aggregate([{ $match: { therapist_id: oid(t._id) } }, { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: "$rating" } } }]),
    Booking.countDocuments({ therapist: t._id, status: "Completed", booking_date: { $gte: since } }),
  ]);
  const reviews = rv[0]?.n || 0;
  const rating = rv[0] ? Math.round(rv[0].avg * 10) / 10 : 0;
  const live = t.show_to_page === true || Number(t.show_to_page) === 1;
  const checks = [
    { key: "live", label: "Profile live on the website", ok: live },
    { key: "rating", label: `Average rating ${BADGE_RULES.minRating}+`, ok: reviews > 0 && rating >= BADGE_RULES.minRating, value: rating ? `${rating} ★` : "No rating yet" },
    { key: "reviews", label: `${BADGE_RULES.minReviews}+ client reviews`, ok: reviews >= BADGE_RULES.minReviews, value: `${reviews}` },
    { key: "sessions", label: `${BADGE_RULES.minSessions90}+ sessions completed in 90 days`, ok: sessions >= BADGE_RULES.minSessions90, value: `${sessions}` },
  ];
  return { earned: checks.every((c) => c.ok), checks };
}

export async function refreshTopBadges() {
  const list = await Therapists.find({}, { show_to_page: 1, top_therapist: 1 }).lean();
  let on = 0;
  for (const t of list) {
    const { earned } = await badgeProgress(t);
    if (earned) on++;
    if (earned !== !!t.top_therapist) {
      await Therapists.updateOne({ _id: t._id }, { $set: { top_therapist: earned, top_therapist_since: earned ? new Date() : null } });
    }
  }
  return on;
}

let badgeTimer = null;
export function startTopBadgeJob() {
  if (badgeTimer) return;
  const tick = async () => { try { const n = await refreshTopBadges(); console.log(`[top-badge] ${n} top therapists`); } catch (e) { console.error("[top-badge] failed:", e.message); } };
  setTimeout(tick, 120000);
  badgeTimer = setInterval(tick, 6 * 3600000);
}

/* ── 5. when clients book: last 90 days of paid sessions across CYT, by day and time band (IST) ── */
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const BANDS = [
  { key: "morning", label: "Morning", from: 7, to: 12, range: "7 am – 12 pm" },
  { key: "afternoon", label: "Afternoon", from: 12, to: 16, range: "12 – 4 pm" },
  { key: "evening", label: "Evening", from: 16, to: 20, range: "4 – 8 pm" },
  { key: "night", label: "Night", from: 20, to: 24, range: "8 pm – 12 am" },
];
const bandOf = (h) => BANDS.findIndex((b) => h >= b.from && h < b.to);

let demandCache = { at: 0, grid: null, total: 0 };
export async function demandGrid() {
  if (demandCache.grid && Date.now() - demandCache.at < 3 * 3600000) return demandCache;
  const rows = await Booking.aggregate([
    { $match: { booking_date: { $gte: new Date(Date.now() - 90 * DAY) }, status: { $ne: "Cancelled" }, $or: [{ payment_status: "Paid" }, { source: "noida" }] } },
    { $project: { dow: { $isoDayOfWeek: { date: "$booking_date", timezone: "Asia/Kolkata" } }, h: { $hour: { date: "$booking_date", timezone: "Asia/Kolkata" } } } },
    { $group: { _id: { dow: "$dow", h: "$h" }, n: { $sum: 1 } } },
  ]);
  const grid = DAYS.map(() => BANDS.map(() => 0));
  let total = 0;
  for (const r of rows) {
    const bi = bandOf(r._id.h);
    if (bi < 0) continue;
    grid[r._id.dow - 1][bi] += r.n;
    total += r.n;
  }
  demandCache = { at: Date.now(), grid, total };
  return demandCache;
}

// "10:00am" -> 10, "01:30pm" -> 13.5
const hourOf = (s) => {
  const m = String(s || "").trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3] === "pm") h += 12;
  if (!m[3] && Number(m[1]) === 12) h = 12;
  return h + (Number(m[2] || 0) / 60);
};

// which day × band cells the therapist has any open hours in
export function coverage(schedule) {
  const cov = DAYS.map(() => BANDS.map(() => false));
  for (const d of Array.isArray(schedule) ? schedule : []) {
    const di = DAYS.indexOf(d?.day);
    if (di < 0) continue;
    for (const t of d.times || []) {
      const a = hourOf(t.open);
      let b = hourOf(t.close);
      if (a == null || b == null) continue;
      if (b <= a) b = 24;
      BANDS.forEach((band, bi) => { if (a < band.to && b > band.from) cov[di][bi] = true; });
    }
  }
  return cov;
}
