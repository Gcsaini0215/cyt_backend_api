import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../models/Users.js";
import Therapists from "../models/Therapists.js";
import Booking from "../models/Booking.js";
import Review from "../models/Review.js";
import AssessmentRequest from "../models/AssessmentRequest.js";
import ProfileStat from "../models/ProfileStat.js";
import TherapistPayout from "../models/TherapistPayout.js";
import TherapistSubscriptionPayment from "../models/TherapistSubscriptionPayment.js";
import TherapistAchievement from "../models/TherapistAchievement.js";
import TherapistActionRequest from "../models/TherapistActionRequest.js";
import TherapistFeedback from "../models/TherapistFeedback.js";
import TherapistGoogle from "../models/TherapistGoogle.js";
import TherapistAddon from "../models/TherapistAddon.js";
import SessionNote from "../models/SessionNote.js";
import "../models/Transaction.js";
import { bookingSplit } from "../helper/payoutSplit.js";
import { TEST_BY_KEY } from "../helper/assessmentTests.js";
import { onlineInfo, onlineIdsByRole } from "./ClientPresenceController.js";

/* Admin → Therapists → Therapist 360: every therapist with their totals, and one page per therapist with
   everything from sign-up to today — profile & verification, plan payments, sessions (client, paid, their
   share), payouts, reviews, profile views, assessments sent, achievements, requests, help messages — plus one
   activity timeline. Read-only. Session notes: only that one was written, never the text. */

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const testShort = (k) => TEST_BY_KEY[k]?.short || k;
const istDay = (d) => new Date(new Date(d).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const oidAt = (id) => { try { return new mongoose.Types.ObjectId(String(id)).getTimestamp(); } catch (e) { return null; } };

/* GET /api/admin/therapist-360?q=&page=&limit=&filter=active|hidden|rejected|pending|live|paid|top|all
   active (default) = shown on the website · hidden = approved but not shown · rejected · pending = waiting for verification */
const SHOWN = { show_to_page: { $gt: 0 } };
const STATUS_FILTER = {
  active: SHOWN,
  hidden: { show_to_page: { $not: { $gt: 0 } }, verification_status: "approved" },
  rejected: { verification_status: "rejected" },
  pending: { show_to_page: { $not: { $gt: 0 } }, verification_status: { $in: ["pending", "reupload", null] } },
};
export const listTherapists = expressAsyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(5, parseInt(req.query.limit, 10) || 20));
  const q = String(req.query.q || "").trim().slice(0, 80);
  const which = String(req.query.filter || "active");
  const filter = { ...(STATUS_FILTER[which] || {}) };
  if (q) {
    const rx = new RegExp(esc(q), "i");
    const us = await User.find({ role: 1, $or: [{ name: rx }, { email: rx }, { phone: rx }] }, { _id: 1 }).limit(500).lean();
    filter.$or = [{ user: { $in: us.map((u) => u._id) } }, { profile_code: rx }, { state: rx }, { profile_type: rx }];
  }
  if (which === "live") filter.user = { $in: [...onlineIdsByRole(1)].filter((x) => mongoose.Types.ObjectId.isValid(x)).map((x) => new mongoose.Types.ObjectId(x)) };
  else if (which === "paid") filter.subscription_expires_at = { $gt: new Date() };
  else if (which === "top") filter.top_therapist = true;

  // how many in each status (for the tabs), with the search applied
  const base = filter.$or ? { $or: filter.$or } : {};
  const counts = Object.fromEntries(await Promise.all(Object.entries(STATUS_FILTER).map(async ([k, f]) => [k, await Therapists.countDocuments({ ...base, ...f })])));
  const [total, rows] = await Promise.all([
    Therapists.countDocuments(filter),
    Therapists.find(filter, { user: 1, profile_type: 1, profile_code: 1, state: 1, verification_status: 1, show_to_page: 1, top_therapist: 1, subscription_plan: 1, subscription_expires_at: 1, createdAt: 1 })
      .populate({ path: "user", select: "name email phone profile createdAt last_visit is_verified" })
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  const ids = rows.map((t) => t._id);
  const since30 = istDay(Date.now() - 30 * 864e5);
  const now = new Date();
  const [bk, rv, ps] = await Promise.all([
    Booking.aggregate([
      { $match: { therapist: { $in: ids } } },
      { $group: {
        _id: "$therapist",
        sessions: { $sum: { $cond: [{ $or: [{ $eq: ["$payment_status", "Paid"] }, { $eq: ["$source", "noida"] }] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
        upcoming: { $sum: { $cond: [{ $and: [{ $gt: ["$booking_date", now] }, { $ne: ["$status", "Cancelled"] }, { $eq: ["$payment_status", "Paid"] }] }, 1, 0] } },
        clients: { $addToSet: "$client" },
        last: { $max: "$booking_date" },
      } },
    ]),
    Review.aggregate([{ $match: { therapist_id: { $in: ids } } }, { $group: { _id: "$therapist_id", n: { $sum: 1 }, avg: { $avg: "$rating" } } }]),
    ProfileStat.aggregate([{ $match: { therapist: { $in: ids }, day: { $gte: since30 } } }, { $group: { _id: "$therapist", views: { $sum: "$views" } } }]),
  ]);
  const m = (arr) => new Map(arr.map((x) => [String(x._id), x]));
  const B = m(bk); const R = m(rv); const P = m(ps);
  const data = rows.map((t) => {
    const id = String(t._id); const u = t.user || {};
    const b = B.get(id) || {}; const r = R.get(id) || {};
    return {
      _id: id, userId: String(u._id || ""), name: u.name || "Therapist", email: u.email || "", phone: u.phone || "", photo: u.profile || "",
      type: t.profile_type || "", code: t.profile_code || "", state: t.state || "", joined: u.createdAt || t.createdAt,
      verification: t.verification_status || "pending", live: (t.show_to_page || 0) > 0, top: !!t.top_therapist,
      plan: t.subscription_expires_at && new Date(t.subscription_expires_at) > now ? (t.subscription_plan || "Paid") : "", planEnds: t.subscription_expires_at || null,
      sessions: b.sessions || 0, completed: b.completed || 0, upcoming: b.upcoming || 0, clients: (b.clients || []).filter(Boolean).length,
      reviews: r.n || 0, rating: r.avg ? Math.round(r.avg * 10) / 10 : null, views30: P.get(id)?.views || 0,
      lastVisit: u.last_visit || null, online: !!onlineInfo(u._id),
    };
  });
  res.json({ status: true, data, total, page, pages: Math.max(1, Math.ceil(total / limit)), counts });
});

/* GET /api/admin/therapist-360/:id (Therapists _id) — the whole picture for one therapist */
export const therapistDetail = expressAsyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ status: false, message: "Invalid therapist" });
  const t = await Therapists.findById(req.params.id, { reupload_token_hash: 0, completion_token_hash: 0 })
    .populate({ path: "user", select: "name email phone profile gender createdAt last_visit is_verified bio" }).lean();
  if (!t) return res.status(404).json({ status: false, message: "Therapist not found" });
  const tid = t._id; const u = t.user || {}; const uid = u._id;

  const [bookings, reviews, assessments, stats, payouts, planPays, achievements, requests, feedback, google, addon, notes] = await Promise.all([
    Booking.find({ therapist: tid }).populate({ path: "client", select: "name email phone profile" }).populate({ path: "transaction", select: "amount transaction_id payment_method" }).sort({ booking_date: -1 }).limit(800).lean(),
    Review.find({ therapist_id: tid }).sort({ createdAt: -1 }).limit(300).lean(),
    AssessmentRequest.find({ therapist: tid }, { answers: 0 }).populate({ path: "client", select: "name" }).sort({ createdAt: -1 }).limit(300).lean(),
    ProfileStat.find({ therapist: tid }).sort({ day: -1 }).limit(400).lean(),
    uid ? TherapistPayout.find({ user: uid }).sort({ createdAt: -1 }).limit(200).lean() : [],
    uid ? TherapistSubscriptionPayment.find({ user: uid }).sort({ createdAt: -1 }).limit(100).lean() : [],
    TherapistAchievement.find({ therapist: tid }).sort({ unlockedAt: -1 }).lean(),
    uid ? TherapistActionRequest.find({ user: uid }).sort({ createdAt: -1 }).limit(100).lean() : [],
    uid ? TherapistFeedback.find({ user: uid }).sort({ createdAt: -1 }).limit(100).lean() : [],
    uid ? TherapistGoogle.findOne({ user: uid }, { refresh_token: 0 }).lean() : null,
    uid ? TherapistAddon.findOne({ user: uid }, { signature: 0, consentIp: 0 }).lean() : null,
    uid ? SessionNote.find({ user: uid }, { booking: 1, createdAt: 1, updatedAt: 1 }).lean() : [],
  ]);

  const now = Date.now();
  const noted = new Set(notes.map((n) => String(n.booking)));
  const sessions = bookings.map((b) => {
    const sp = bookingSplit(b);
    const when = b.booking_date ? new Date(b.booking_date) : null;
    const paid = b.payment_status === "Paid" || b.source === "noida";
    const state = b.status === "Cancelled" ? "cancelled" : b.status === "Completed" ? "completed" : !paid ? "pending" : when && when.getTime() > now ? "upcoming" : b.status === "Started" ? "in-progress" : "past";
    return {
      _id: String(b._id), date: b.booking_date, state, status: b.status || "", paid, noida: b.source === "noida",
      client: b.client ? { id: String(b.client._id), name: b.client.name, photo: b.client.profile || "" } : { id: "", name: b.cname || "Client", photo: "" },
      service: b.service || "", format: b.format || "", amount: sp.paid || 0, share: sp.therapist || 0, pct: sp.pct,
      paymentId: b.transaction?.transaction_id || "", payment: b.source === "noida" ? "Noida centre" : b.payment_status || "",
      startedAt: b.session_started_at || null, completedAt: b.session_completed_at || null, paidOut: !!b.payout_id, note: noted.has(String(b._id)),
      meet: !!b.meet_link || !!b.calendar_event_id,
    };
  });
  const real = sessions.filter((s) => s.paid);
  const earned = real.filter((s) => s.state !== "cancelled").reduce((x, s) => x + s.share, 0);
  const paidOut = payouts.filter((p) => p.status === "paid").reduce((x, p) => x + (p.amount || 0), 0);
  const rating = reviews.length ? Math.round((reviews.reduce((x, r) => x + (r.rating || 0), 0) / reviews.length) * 10) / 10 : null;

  // profile views: totals, last 30 days by day, where visitors came from
  const d30 = istDay(now - 30 * 864e5);
  const sum = (rows, k) => rows.reduce((x, r) => x + (r[k] || 0), 0);
  const last30 = stats.filter((s) => s.day >= d30);
  const sources = {};
  for (const s of last30) for (const [k, v] of Object.entries(s.sources || {})) sources[k] = (sources[k] || 0) + (v || 0);
  const views = {
    total: sum(stats, "views"), visitors: sum(stats, "visitors"), d30: sum(last30, "views"), visitors30: sum(last30, "visitors"),
    book30: sum(last30, "book"), contact30: sum(last30, "contact"), share30: sum(last30, "share"),
    series: [...Array(30)].map((_, i) => { const day = istDay(now - (29 - i) * 864e5); const r = stats.find((s) => s.day === day); return { day, views: r?.views || 0 }; }),
    sources: Object.entries(sources).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v })),
  };

  // one timeline, newest first
  const ev = [];
  const add = (at, kind, text, sub = "") => { if (at) ev.push({ at: new Date(at), kind, text, sub }); };
  add(u.createdAt, "account", "Created an account");
  add(t.createdAt, "profile", "Submitted the therapist profile", [t.profile_type, t.state].filter(Boolean).join(" · "));
  if (t.dashboard_since) add(t.dashboard_since, "profile", "First opened the therapist dashboard");
  if (t.completion_requested_at) add(t.completion_requested_at, "verify", "CYT asked to complete the profile", (t.completion_items || []).join(", "));
  if (t.completion_submitted_at) add(t.completion_submitted_at, "verify", "Sent the missing profile details");
  if (t.verified_at) add(t.verified_at, "verify", t.verification_status === "approved" ? "Profile verified" : `Verification: ${t.verification_status}`, t.verification_note || "");
  if (t.profile_live_mailed_at) add(t.profile_live_mailed_at, "verify", "Profile went live — public link mailed");
  if (t.office_location_confirmed_at) add(t.office_location_confirmed_at, "profile", "Confirmed practice location on the map", t.office_area?.label || "");
  if (t.top_therapist_since) add(t.top_therapist_since, "award", "Became a Top therapist");
  for (const p of planPays) add(p.createdAt, "plan", `Paid ₹${Math.round(p.amount || 0).toLocaleString("en-IN")} for the ${p.plan || ""} plan`.replace("  ", " "), p.grantedBy ? `Granted by ${p.grantedBy}` : p.paymentId || "");
  for (const r of t.renewal_mails || []) add(r.at, "mail", "Plan renewal reminder sent", r.key);
  for (const s of sessions) {
    if (s.paid) add(oidAt(s._id), "session", `${s.client.name} booked a session`, `for ${s.date ? new Date(s.date).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—"}${s.noida ? " · Noida centre" : ""}${s.amount ? ` · ₹${Math.round(s.amount).toLocaleString("en-IN")}` : ""}`);
    if (s.completedAt) add(s.completedAt, "session", `Completed a session with ${s.client.name}`, s.share ? `Earned ₹${Math.round(s.share).toLocaleString("en-IN")}` : "");
    if (s.state === "cancelled" && s.paid) add(s.date, "cancel", `Session with ${s.client.name} cancelled`);
  }
  for (const n of notes) add(n.createdAt, "note", "Wrote a session note", "content private");
  for (const r of reviews) add(r.createdAt, "review", `Got a ${r.rating || "?"}★ review from ${r.name || "a client"}`, r.description ? `“${String(r.description).slice(0, 90)}${r.description.length > 90 ? "…" : ""}”` : "");
  for (const a of assessments) {
    add(a.createdAt, "assessment", `Sent ${testShort(a.tool)} to ${a.client?.name || "a client"}`);
    if (a.releasedAt) add(a.releasedAt, "assessment", `Released the ${testShort(a.tool)} report`, a.client?.name || "");
  }
  for (const p of payouts) add(p.paidAt || p.createdAt, "payout", `${p.status === "paid" ? "Paid out" : "Payout created:"} ₹${Math.round(p.amount || 0).toLocaleString("en-IN")}`, `${p.sessions || 0} sessions${p.reference ? ` · ${p.reference}` : ""}`);
  for (const a of achievements) add(a.unlockedAt, "award", `Unlocked an award: ${a.key}`, a.code || "");
  for (const r of requests) { add(r.createdAt, "request", `CYT asked: ${r.title}`); if (r.doneAt) add(r.doneAt, "request", `Done: ${r.title}`, r.doneNote || ""); }
  for (const f of feedback) add(f.createdAt, "help", `Sent ${f.kind || "a message"} to CYT`, String(f.message || "").slice(0, 100));
  if (google?.connected_at) add(google.connected_at, "profile", "Connected Google Calendar / Meet", google.email || "");
  if (addon?.verifiedAt) add(addon.verifiedAt, "assessment", "Assessment add-on verified");
  if (addon?.lastPaidAt) add(addon.lastPaidAt, "plan", `Paid ₹${Math.round(addon.lastAmount || 0).toLocaleString("en-IN")} for an add-on`, addon.lastSource || "");
  ev.sort((a, b) => b.at - a.at);

  const live = onlineInfo(uid);
  const planActive = t.subscription_expires_at && new Date(t.subscription_expires_at) > new Date();
  res.json({
    status: true,
    data: {
      profile: {
        _id: String(tid), userId: String(uid || ""), name: u.name || "Therapist", email: u.email || "", phone: u.phone || "", photo: u.profile || "", gender: u.gender || "",
        type: t.profile_type || "", code: t.profile_code || "", state: t.state || "", city: t.office_city || "", mode: t.mode || "", serveType: t.serve_type || "",
        qualification: t.qualification || "", experience: t.year_of_exp || "", languages: t.language_spoken || "", expertise: t.experties || "", services: t.services || "",
        formats: t.session_formats || "", license: t.license_number || "", clinic: !!t.office_is_clinic, area: t.office_area?.label || "",
        joined: u.createdAt || t.createdAt, profileAt: t.createdAt, lastVisit: u.last_visit || null,
        verification: t.verification_status || "pending", verifiedAt: t.verified_at || null, verificationNote: t.verification_note || "",
        docs: { resume: !!t.resume, degree: !!t.qualification_certificate, id: !!t.id_card },
        live: (t.show_to_page || 0) > 0, top: !!t.top_therapist,
        plan: { name: t.subscription_plan || "", active: !!planActive, startedAt: t.subscription_started_at || null, endsAt: t.subscription_expires_at || null, amount: t.subscription_amount || 0 },
        google: google ? { email: google.email || "", connectedAt: google.connected_at || null, error: google.last_error || "" } : null,
        addon: addon ? { verified: !!addon.verified, till: addon.assessmentsTill || null } : null,
        fees: (t.fees || []).map((f) => ({ name: f.name, formats: (f.formats || []).map((x) => ({ type: x.type, fee: x.fee })) })),
        online: live ? { since: new Date(live.since), path: live.path, device: live.device, app: live.app } : null,
      },
      totals: {
        sessions: real.length, completed: real.filter((s) => s.state === "completed").length, upcoming: real.filter((s) => s.state === "upcoming").length,
        cancelled: real.filter((s) => s.state === "cancelled").length, pending: sessions.filter((s) => !s.paid && s.state === "pending").length,
        clients: new Set(real.map((s) => s.client.id).filter(Boolean)).size, gross: Math.round(real.filter((s) => s.state !== "cancelled").reduce((x, s) => x + s.amount, 0)),
        earned: Math.round(earned), paidOut: Math.round(paidOut), due: Math.max(0, Math.round(earned - paidOut)),
        reviews: reviews.length, rating, assessments: assessments.length, notes: notes.length, views: views.total, views30: views.d30,
      },
      sessions, views,
      reviews: reviews.map((r) => ({ _id: String(r._id), name: r.name || "", rating: r.rating, text: r.description || "", at: r.createdAt })),
      assessments: assessments.map((a) => ({ _id: String(a._id), name: testShort(a.tool), client: a.client?.name || "", status: a.status, sentAt: a.sentAt || a.createdAt, doneAt: a.doneAt || null, releasedAt: a.releasedAt || null, amount: a.amount || 0 })),
      payouts: payouts.map((p) => ({ _id: String(p._id), amount: p.amount, sessions: p.sessions, status: p.status, method: p.method, reference: p.reference, from: p.periodFrom, to: p.periodTo, paidAt: p.paidAt, at: p.createdAt })),
      planPayments: planPays.map((p) => ({ _id: String(p._id), plan: p.plan, months: p.months, amount: p.amount, status: p.status, paymentId: p.paymentId, grantedBy: p.grantedBy, startedAt: p.startedAt, expiresAt: p.expiresAt, at: p.createdAt })),
      achievements: achievements.map((a) => ({ key: a.key, code: a.code, at: a.unlockedAt })),
      requests: requests.map((r) => ({ _id: String(r._id), title: r.title, status: r.status, due: r.dueDate, doneAt: r.doneAt, at: r.createdAt })),
      feedback: feedback.map((f) => ({ _id: String(f._id), kind: f.kind, message: f.message, status: f.status, reply: f.reply, at: f.createdAt })),
      activity: ev.slice(0, 400),
    },
  });
});
