import Jwt from "jsonwebtoken";
import mongoose from "mongoose";
import ProfileStat from "../models/ProfileStat.js";
import ProfileVisitor from "../models/ProfileVisitor.js";
import Therapists from "../models/Therapists.js";

export const SOURCES = ["google", "directory", "home", "city", "blog", "social", "direct", "other"];
export const ACTIONS = ["book", "contact", "share"];
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|whatsapp\/|curl|wget|python|axios|node-fetch/i;

// India date for "today" (YYYY-MM-DD) — the dashboard counts by Indian days
export const istDay = (d = new Date()) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
export const dayShift = (day, n) => istDay(new Date(new Date(`${day}T00:00:00+05:30`).getTime() + n * 86400000));

// therapist profile id -> owner user id, refreshed every 10 min (cheap check that an id is real)
let owners = { at: 0, map: new Map() };
async function ownerOf(id) {
  if (Date.now() - owners.at > 10 * 60000) {
    const rows = await Therapists.find({}, { user: 1 }).lean();
    owners = { at: Date.now(), map: new Map(rows.map((r) => [String(r._id), String(r.user || "")])) };
  }
  return owners.map.get(String(id));
}

// the viewer's user id when they're signed in (to skip a therapist looking at their own profile)
function viewerId(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return "";
  try { return String(Jwt.verify(h.slice(7), process.env.JWT_SECRET, { algorithms: ["HS256"] }).userId || ""); } catch { return ""; }
}

export const isBot = (req) => BOT.test(String(req.headers["user-agent"] || ""));

/* one profile event: view (with source + unique visitor) or a click (book / contact / share) */
export async function recordProfileEvent(req, { therapistId, type, vid, src }) {
  if (!mongoose.isValidObjectId(therapistId) || isBot(req)) return { counted: false };
  const owner = await ownerOf(therapistId);
  if (owner === undefined) return { counted: false };
  if (owner && owner === viewerId(req)) return { counted: false, self: true };
  const day = istDay();
  const tid = new mongoose.Types.ObjectId(String(therapistId));
  const inc = {};
  if (type === "view") {
    inc.views = 1;
    inc[`sources.${SOURCES.includes(src) ? src : "other"}`] = 1;
    const v = String(vid || "").replace(/[^a-z0-9-]/gi, "").slice(0, 40);
    if (v) {
      try { await ProfileVisitor.create({ therapist: tid, day, vid: v }); inc.visitors = 1; } catch (e) { if (e.code !== 11000) throw e; }
    }
  } else if (ACTIONS.includes(type)) {
    inc[type] = 1;
  } else {
    return { counted: false };
  }
  await ProfileStat.updateOne({ therapist: tid, day }, { $inc: inc }, { upsert: true });
  return { counted: true };
}

/* the directory / search showed these therapists' cards (one call per page view) */
export async function recordImpressions(req, ids) {
  if (isBot(req)) return 0;
  const day = istDay();
  const valid = [...new Set((ids || []).map(String))].filter((id) => mongoose.isValidObjectId(id)).slice(0, 80);
  if (!valid.length) return 0;
  await ProfileStat.bulkWrite(valid.map((id) => ({
    updateOne: { filter: { therapist: new mongoose.Types.ObjectId(id), day }, update: { $inc: { impressions: 1 } }, upsert: true },
  })), { ordered: false });
  return valid.length;
}

const sumRows = (rows) => rows.reduce((a, r) => {
  for (const k of ["views", "visitors", "impressions", ...ACTIONS]) a[k] += r[k] || 0;
  for (const s of SOURCES) a.sources[s] += r.sources?.[s] || 0;
  return a;
}, { views: 0, visitors: 0, impressions: 0, book: 0, contact: 0, share: 0, sources: Object.fromEntries(SOURCES.map((s) => [s, 0])) });

/* last 30 days vs the 30 before, plus a day-by-day series */
export async function profileInsights(therapistId) {
  const today = istDay();
  const from = dayShift(today, -59);
  const rows = await ProfileStat.find({ therapist: therapistId, day: { $gte: from } }).lean();
  const cut = dayShift(today, -29);
  const cur = sumRows(rows.filter((r) => r.day >= cut));
  const prev = sumRows(rows.filter((r) => r.day < cut));
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const d = dayShift(today, -i);
    const r = byDay.get(d);
    daily.push({ day: d, views: r?.views || 0, visitors: r?.visitors || 0 });
  }
  const allTime = await ProfileStat.aggregate([
    { $match: { therapist: new mongoose.Types.ObjectId(String(therapistId)) } },
    { $group: { _id: null, views: { $sum: "$views" } } },
  ]);
  return { current: cur, previous: prev, daily, allTimeViews: allTime[0]?.views || 0, since: rows.length ? rows.reduce((m, r) => (r.day < m ? r.day : m), today) : null };
}

/* plan state for the insights card:
   active  — a package (paid or a free grant) is running
   free    — live on the site without a package (the owner keeps these free: no locks, no reminders)
   expired — not live, had a package before   · none — not live yet, never had one */
export function planState(t) {
  const exp = t?.subscription_expires_at ? new Date(t.subscription_expires_at) : null;
  const live = t?.show_to_page === true || Number(t?.show_to_page) === 1;
  if (exp && exp > new Date()) {
    return { status: "active", plan: t.subscription_plan || null, expiresAt: exp, daysLeft: Math.ceil((exp - Date.now()) / 86400000) };
  }
  if (live) return { status: "free" };
  return { status: exp || t?.subscription_plan ? "expired" : "none", expiresAt: exp };
}

/* profile strength: what's set, and what to do next (each tip links to the screen that fixes it) */
export function profileStrength(t, { reviews = 0, hasHours = false } = {}) {
  const bio = String(t?.user?.bio || "").replace(/<[^>]*>/g, " ").trim();
  const words = bio.split(/\s+/).filter(Boolean).length;
  const expertise = String(t?.experties || "").split(",").map((x) => x.trim()).filter(Boolean);
  const langs = Array.isArray(t?.language_spoken) ? t.language_spoken : String(t?.language_spoken || "").split(",").map((x) => x.trim()).filter(Boolean);
  const fees = (Array.isArray(t?.fees) ? t.fees : []).flatMap((f) => (f?.formats || []).map((x) => Number(x?.fee) || 0)).filter((n) => n > 0);
  const checks = [
    { key: "photo", weight: 20, ok: !!t?.user?.profile, tip: "Add a clear, professional photo — profiles with a photo get far more views and bookings.", href: "/settings?tab=profile", cta: "Add photo" },
    { key: "bio", weight: 15, ok: words >= 60, tip: words ? `Your bio is short (${words} words). Write 5–6 lines on how you work and who you help.` : "Write a short bio — how you work and who you help.", href: "/settings?tab=profile", cta: "Edit bio" },
    { key: "hours", weight: 20, ok: !!hasHours, tip: "Set your available hours — clients can't book you without them.", href: "/my-schedule?tab=availability", cta: "Set hours" },
    { key: "fees", weight: 15, ok: fees.length > 0, tip: "Add your session fees so clients can book straight away.", href: "/my-schedule?tab=fees", cta: "Add fees" },
    { key: "expertise", weight: 10, ok: expertise.length >= 5, tip: `Add at least 5 areas of expertise (you have ${expertise.length}) — this is how clients find you in search.`, href: "/settings?tab=offerings", cta: "Add expertise" },
    { key: "languages", weight: 5, ok: langs.length >= 2, tip: "Add every language you can counsel in (Hindi, English and more).", href: "/settings?tab=profile", cta: "Add languages" },
    { key: "experience", weight: 5, ok: !!String(t?.year_of_exp || "").trim(), tip: "Add your years of experience.", href: "/settings?tab=profile", cta: "Add experience" },
    { key: "reviews", weight: 10, ok: reviews >= 3, tip: reviews ? `You have ${reviews} review${reviews > 1 ? "s" : ""}. Ask a few more clients — profiles with 3+ reviews get booked more.` : "No reviews yet — ask your clients to leave one after a session.", href: "/therapists/reviews", cta: "Get reviews" },
  ];
  const score = checks.reduce((a, c) => a + (c.ok ? c.weight : 0), 0);
  return { score, tips: checks.filter((c) => !c.ok).map(({ key, tip, href, cta }) => ({ key, tip, href, cta })) };
}
