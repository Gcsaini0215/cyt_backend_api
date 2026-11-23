import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import GrowthSetting from "../models/GrowthSetting.js";
import Booking from "../models/Booking.js";
import "../models/Transaction.js";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/LeadActivity.js";
import Review from "../models/Review.js";
import SessionNote from "../models/SessionNote.js";
import Therapists from "../models/Therapists.js";
import TherapistSubscriptionPayment from "../models/TherapistSubscriptionPayment.js";
import AssessmentRequest, { AssessmentOrder } from "../models/AssessmentRequest.js";
import Trainee from "../models/Trainee.js";
import WorkshopBooking from "../models/WorkshopBooking.js";
import TherapistPayout from "../models/TherapistPayout.js";
import { bookingSplit } from "../helper/payoutSplit.js";
import { levelPctMap } from "../helper/achievements.js";
import { getPricing } from "../helper/assessmentPricing.js";
import { isSuperAdminReq } from "../middlewares/hideRevenueMiddleware.js";

/* Admin → Growth 2027 (owner's "Corporate Growth Plan 2027" PDF, phase 1): the Monday Weekly Review and the
   Targets it is measured against. Super Admin only — it shows CYT's revenue.

   Recognised revenue = CYT's own part only (the PDF: never count gross bookings in full), counted when the
   session is booked:
   - a session booking: CYT's part of that session (helper/payoutSplit.js "platform" — the same split as Payouts;
     a session not completed yet at the therapist's % today). A CYT Noida package is recognised session by
     session (each on its session value); the rest of what was paid for it is shown as package advance.
   - Care     = CYT Noida sessions + session-pack sessions + clinical assessments bought on their own
   - Connect  = other online bookings with listed therapists + therapist plan payments
   - Corporate = EAP contracts (phase 3) — nothing recorded yet
   - Academy  = internship fees + hours upgrades
   - Workshops are not assigned to a division yet (owner, 2026-11-24): shown apart, still in the total. */

const IST_MS = 330 * 60000;
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, "0");
const istDate = (d) => new Date(d.getTime() + IST_MS); // read with getUTC*
const ymd = (d) => { const x = istDate(d); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`; };
const istMidnight = (y, m, d) => new Date(Date.UTC(y, m, d) - IST_MS); // m is 0-based
const oid = (d) => mongoose.Types.ObjectId.createFromTime(Math.floor(d.getTime() / 1000));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Monday 00:00 IST of the week holding `dateStr` (YYYY-MM-DD) or today
function weekOf(dateStr) {
  let y, m, d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) [y, m, d] = dateStr.split("-").map(Number);
  else { const t = istDate(new Date()); y = t.getUTCFullYear(); m = t.getUTCMonth() + 1; d = t.getUTCDate(); }
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7;
  const from = istMidnight(y, m - 1, d - back);
  return { from, to: new Date(from.getTime() + 7 * DAY) };
}
const monthKeyOf = (d) => { const x = istDate(d); return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}`; };
const monthRange = (key) => { const [y, m] = key.split("-").map(Number); return { from: istMidnight(y, m - 1, 1), to: istMidnight(y, m, 1), days: new Date(Date.UTC(y, m, 0)).getUTCDate() }; };

/* ── targets: the PDF's numbers, editable on the Targets page ───────────────────────────────── */
const PLAN_2027 = [60000, 70000, 80000, 100000, 120000, 140000, 180000, 190000, 230000, 260000, 290000, 300000];
// division split at each quarter end (PDF section 10): care, connect, corporate, academy
const Q_SPLIT = [[60000, 5000, 10000, 5000], [95000, 12000, 20000, 13000], [130000, 22000, 55000, 23000], [160000, 30000, 80000, 30000]];
export const DIVISIONS = ["care", "connect", "corporate", "academy"];
function defaultMonths() {
  const out = {
    "2026-11": { total: 60000, care: 40000, connect: 12000, corporate: 5000, academy: 3000 },
    "2026-12": { total: 60000, care: 40000, connect: 12000, corporate: 5000, academy: 3000 },
  };
  PLAN_2027.forEach((total, i) => {
    const q = Q_SPLIT[Math.floor(i / 3)]; const sum = q.reduce((a, b) => a + b, 0);
    const part = (k) => Math.round((total * q[k]) / sum / 100) * 100;
    const connect = part(1), corporate = part(2), academy = part(3);
    out[`2027-${pad(i + 1)}`] = { total, care: total - connect - corporate - academy, connect, corporate, academy };
  });
  return out;
}
// starting targets (PDF section 15, Q1 column); `lower` = lower is better
export const METRIC_DEFAULTS = {
  leadsWeek: 8, conversionPct: 25, responseMins: 30, sessionsWeek: 14, secondSessionPct: 60,
  reviewsMonth: 10, noShowPct: 10, notesPct: 95, feedback: 4.5, fixedCostCeiling: 75000, contributionPct: 70,
};
const METRIC_LIMITS = { leadsWeek: 1000, conversionPct: 100, responseMins: 1440, sessionsWeek: 5000, secondSessionPct: 100, reviewsMonth: 1000, noShowPct: 100, notesPct: 100, feedback: 5, fixedCostCeiling: 1e8, contributionPct: 100 };

async function loadTargets() {
  const doc = await GrowthSetting.findOne({ key: "targets" }).lean();
  const months = defaultMonths();
  for (const [k, v] of Object.entries(doc?.data?.months || {})) if (months[k] && v) months[k] = { ...months[k], ...v };
  return { months, metrics: { ...METRIC_DEFAULTS, ...(doc?.data?.metrics || {}) }, updatedAt: doc?.updatedAt || null, updatedBy: doc?.updatedBy || "" };
}

/* ── recognised revenue in [from, to) ───────────────────────────────────────────────────────── */
async function revenue(from, to) {
  const out = { care: 0, connect: 0, corporate: 0, academy: 0, workshops: 0, gross: 0, therapists: 0, sessions: 0, plans: 0, assessments: 0, advance: 0 };
  const rows = await Booking.find({ _id: { $gte: oid(from), $lt: oid(to) }, $or: [{ payment_status: "Paid" }, { transaction: { $ne: null } }, { source: "noida" }] })
    .select("status source payment_status amount referral_discount credit_used noida_amount noida_fee noida_session_value noida_legacy assessment_fee assessment_therapist_share transaction therapist therapist_pct pack_size bundle")
    .populate("transaction", "amount").lean();
  const levels = await levelPctMap(rows.map((b) => b.therapist)).catch(() => new Map());
  for (const b of rows) {
    if (b.status === "Cancelled") continue;
    const sp = bookingSplit(b, levels.get(String(b.therapist || "")));
    if (sp.legacy || (!sp.paid && !sp.base)) continue;
    const care = b.source === "noida" || b.pack_size > 0 || !!b.bundle;
    out[care ? "care" : "connect"] += sp.platform;
    out.gross += sp.paid; out.therapists += sp.therapist; out.sessions += 1;
    // a package bought on this booking: what was paid beyond this session (its value + fee) is for later sessions
    if (b.source === "noida" && b.noida_session_value != null && sp.paid > 0) out.advance += Math.max(0, sp.paid - sp.base - (Number(b.noida_fee) || 0));
  }
  const [plans, orders, trainees, upgrades, workshops] = await Promise.all([
    TherapistSubscriptionPayment.aggregate([{ $match: { status: "paid", createdAt: { $gte: from, $lt: to } } }, { $group: { _id: null, t: { $sum: "$amount" } } }]),
    AssessmentOrder.find({ status: "paid", createdAt: { $gte: from, $lt: to } }).select("amount request").lean(),
    Trainee.aggregate([{ $match: { paymentStatus: "paid", createdAt: { $gte: from, $lt: to } } }, { $group: { _id: null, t: { $sum: { $ifNull: ["$programFee", 0] } } } }]),
    Trainee.aggregate([{ $unwind: "$upgrades" }, { $match: { "upgrades.at": { $gte: from, $lt: to } } }, { $group: { _id: null, t: { $sum: { $ifNull: ["$upgrades.amount", 0] } } } }]),
    WorkshopBooking.aggregate([{ $match: { is_payment_success: true, createdAt: { $gte: from, $lt: to } } }, { $group: { _id: null, t: { $sum: "$amount" } } }]),
  ]);
  out.plans = plans[0]?.t || 0;
  out.connect += out.plans;
  if (orders.length) {
    // a clinical assessment sent by a therapist: CYT keeps the fee less the therapist's part; bought alone: all of it
    const reqIds = orders.map((o) => o.request).filter(Boolean);
    const withTherapist = new Set((await AssessmentRequest.find({ _id: { $in: reqIds }, therapist: { $ne: null } }).select("_id").lean()).map((r) => String(r._id)));
    const share = Number((await getPricing().catch(() => null))?.therapistShare) || 0;
    for (const o of orders) {
      const amt = Number(o.amount) || 0;
      out.assessments += o.request && withTherapist.has(String(o.request)) ? amt - Math.round(amt * share) : amt;
    }
    out.care += out.assessments;
  }
  out.academy += (trainees[0]?.t || 0) + (upgrades[0]?.t || 0);
  out.workshops = workshops[0]?.t || 0;
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]);
  out.total = out.care + out.connect + out.corporate + out.academy + out.workshops;
  return out;
}

/* ── status: g on target · a within 20% · r below · n not measured yet ─────────────────────── */
function status(value, target, lower = false) {
  if (value == null || target == null || !Number.isFinite(Number(value))) return "n";
  const v = Number(value), t = Number(target);
  if (lower) return v <= t ? "g" : v <= t * 1.2 ? "a" : "r";
  return v >= t ? "g" : v >= t * 0.8 ? "a" : "r";
}
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const dur = (mins) => (mins == null ? "—" : mins < 60 ? `${Math.round(mins)} min` : `${Math.floor(mins / 60)} h ${Math.round(mins % 60)} m`);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const h = Math.floor(s.length / 2); return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const PAYOUTS_SINCE = new Date("2026-10-21T00:00:00+05:30"); // therapist payouts started (earlier sessions were settled outside)

/* GET /api/admin/growth/weekly?week=YYYY-MM-DD */
export const weeklyReview = expressAsyncHandler(async (req, res) => {
  if (!isSuperAdminReq(req)) return res.status(403).json({ status: false, message: "The Weekly Review is for the Super Admin." });
  const { from, to } = weekOf(req.query.week);
  const now = new Date();
  const weekEnd = to < now ? to : now;
  const monthKey = monthKeyOf(new Date(Math.min(to.getTime(), now.getTime()) - 1));
  const mr = monthRange(monthKey);
  const T = await loadTargets();
  const M = T.metrics;
  const monthT = T.months[monthKey] || null;
  const weekKey = ymd(from);

  const [monthRev, weekRev, manualDoc] = await Promise.all([
    revenue(mr.from, weekEnd < mr.to ? weekEnd : mr.to),
    revenue(from, weekEnd),
    GrowthSetting.findOne({ key: "manual" }).lean(),
  ]);
  const manual = manualDoc?.data?.weeks?.[weekKey] || {};

  // leads: created this week; first reply = the first update logged on the lead in Leads
  const leads = await Lead.find({ created_at: { $gte: from, $lt: to } }).select("_id status created_at").lean();
  const firsts = leads.length ? await LeadActivity.aggregate([{ $match: { lead: { $in: leads.map((l) => l._id) } } }, { $group: { _id: "$lead", first: { $min: "$createdAt" } } }]) : [];
  const F = new Map(firsts.map((x) => [String(x._id), x.first]));
  const replyMins = leads.filter((l) => F.has(String(l._id))).map((l) => Math.max(0, (new Date(F.get(String(l._id))) - new Date(l.created_at)) / 60000));
  const qualified = leads.filter((l) => l.status !== "lost").length;
  const converted = leads.filter((l) => l.status === "converted").length;
  const noReply = leads.length - replyMins.length;

  // sessions this week (by session date)
  const weekBookings = await Booking.find({ booking_date: { $gte: from, $lt: to }, noida_legacy: { $ne: true }, $or: [{ payment_status: "Paid" }, { transaction: { $ne: null } }, { source: "noida" }] })
    .select("_id status source session_completed_at").lean();
  const done = weekBookings.filter((b) => b.status === "Completed");
  const cancelled = weekBookings.filter((b) => b.status === "Cancelled").length;
  // notes within 24 h: online sessions completed this week
  const onlineDone = done.filter((b) => b.source !== "noida" && b.session_completed_at);
  const notes = onlineDone.length ? await SessionNote.find({ booking: { $in: onlineDone.map((b) => b._id) } }).select("booking createdAt").lean() : [];
  const N = new Map(notes.map((n) => [String(n.booking), n.createdAt]));
  const notesInTime = onlineDone.filter((b) => N.has(String(b._id)) && new Date(N.get(String(b._id))) - new Date(b.session_completed_at) <= DAY).length;

  // second sessions: clients whose first paid session was 1–5 weeks before the week ended
  const winFrom = new Date(to.getTime() - 35 * DAY), winTo = new Date(to.getTime() - 7 * DAY);
  const firstAgg = await Booking.aggregate([
    { $match: { client: { $ne: null }, status: { $ne: "Cancelled" }, $or: [{ payment_status: "Paid" }, { transaction: { $ne: null } }] } },
    { $group: { _id: "$client", first: { $min: "$booking_date" }, n: { $sum: 1 } } },
    { $match: { first: { $gte: winFrom, $lt: winTo } } },
  ]);
  const second = firstAgg.length ? Math.round((firstAgg.filter((c) => c.n >= 2).length / firstAgg.length) * 100) : null;

  // reviews on the site this week; Google reviews are typed in
  const rv = await Review.aggregate([{ $match: { createdAt: { $gte: from, $lt: to }, rating: { $gt: 0 } } }, { $group: { _id: null, n: { $sum: 1 }, avg: { $avg: "$rating" } } }]);
  const live = await Therapists.countDocuments({ show_to_page: { $gt: 0 } });
  const liveVerified = await Therapists.countDocuments({ show_to_page: { $gt: 0 }, verification_status: "approved" });

  // settlements: completed paid sessions with no payout yet (since payouts began)
  const unpaid = await Booking.find({ status: "Completed", payout_id: null, noida_legacy: { $ne: true }, session_completed_at: { $gte: PAYOUTS_SINCE, $lt: weekEnd } })
    .select("status source payment_status amount referral_discount credit_used noida_amount noida_fee noida_session_value noida_legacy assessment_fee assessment_therapist_share transaction therapist therapist_pct session_completed_at")
    .populate("transaction", "amount").lean();
  let dueAmt = 0, oldest = null;
  for (const b of unpaid) { const sp = bookingSplit(b); if (sp.therapist > 0) { dueAmt += sp.therapist; if (!oldest || b.session_completed_at < oldest) oldest = b.session_completed_at; } }
  const pendingPayouts = await TherapistPayout.aggregate([{ $match: { status: "pending" } }, { $group: { _id: null, t: { $sum: "$amount" }, n: { $sum: 1 } } }]);
  const oldestDays = oldest ? Math.floor((weekEnd - new Date(oldest)) / DAY) : 0;

  const weekTarget = monthT ? Math.round((monthT.total * 7) / mr.days) : null;
  const reviewsWeekTarget = Math.round((M.reviewsMonth * 7) / 30 * 10) / 10;
  const m = (group, key, label, def, value, display, target, targetLabel, st, extra = {}) => ({ group, key, label, def, value, display, target, targetLabel, status: st, ...extra });
  const metrics = [
    m("Commercial", "leads", "Qualified leads", "New leads this week, not marked lost", qualified, String(qualified), M.leadsWeek, `${M.leadsWeek}+ a week`, status(qualified, M.leadsWeek), { sub: `${leads.length} new in all` }),
    m("Commercial", "conversion", "Lead → booked", "New leads marked converted", leads.length ? Math.round((converted / leads.length) * 100) : null, leads.length ? `${Math.round((converted / leads.length) * 100)}%` : "—", M.conversionPct, `${M.conversionPct}%+`, leads.length ? status((converted / leads.length) * 100, M.conversionPct) : "n", { sub: `${converted} of ${leads.length}` }),
    m("Commercial", "response", "Median first reply", "From the enquiry to the first update in Leads", replyMins.length ? Math.round(median(replyMins)) : null, replyMins.length ? dur(median(replyMins)) : leads.length ? "Not logged" : "—", M.responseMins, `≤ ${M.responseMins} min`, replyMins.length ? status(median(replyMins), M.responseMins, true) : leads.length ? "r" : "n", { sub: noReply ? `${noReply} with no reply logged` : "every lead has a reply", lower: true }),
    m("Commercial", "sessions", "Sessions completed", "Paid sessions, online + Noida", done.length, String(done.length), M.sessionsWeek, `${M.sessionsWeek}+ a week`, status(done.length, M.sessionsWeek)),
    m("Commercial", "second", "Second-session rate", "New clients (first session 1–5 weeks ago) who booked again", second, second == null ? "—" : `${second}%`, M.secondSessionPct, `${M.secondSessionPct}%+`, status(second, M.secondSessionPct), { sub: `${firstAgg.length} new clients` }),
    m("Commercial", "revenue", "Recognised revenue", "CYT's own part, paid this week", weekRev.total, inr(weekRev.total), weekTarget, weekTarget ? inr(weekTarget) : "set a target", weekTarget ? status(weekRev.total, weekTarget) : "n"),
    m("Commercial", "greviews", "New Google reviews", "Typed in each week", manual.reviews ?? null, manual.reviews == null ? "Add" : String(manual.reviews), reviewsWeekTarget, `${M.reviewsMonth} a month`, manual.reviews == null ? "n" : status(manual.reviews, reviewsWeekTarget), { manual: true, sub: rv[0] ? `${rv[0].n} on the website` : "" }),
    m("Commercial", "pipeline", "Corporate pipeline", "Outreach · calls · proposals · signed", null, "—", null, "20 · 2 · 1 a month", "n", { later: "Phase 3" }),
    m("Clinical & operational", "verified", "Verified credentials", "Therapists live on the site who are verified", live ? Math.round((liveVerified / live) * 100) : null, live ? `${Math.round((liveVerified / live) * 100)}%` : "—", 100, "100% always", live ? status((liveVerified / live) * 100, 100) : "n", { sub: `${liveVerified} of ${live}` }),
    m("Clinical & operational", "noshow", "Cancelled sessions", "Of paid sessions due this week", weekBookings.length ? Math.round((cancelled / weekBookings.length) * 100) : null, weekBookings.length ? `${Math.round((cancelled / weekBookings.length) * 100)}%` : "—", M.noShowPct, `≤ ${M.noShowPct}%`, weekBookings.length ? status((cancelled / weekBookings.length) * 100, M.noShowPct, true) : "n", { sub: `${cancelled} of ${weekBookings.length}`, lower: true }),
    m("Clinical & operational", "notes", "Notes within 24 h", "Online sessions with a session note in time", onlineDone.length ? Math.round((notesInTime / onlineDone.length) * 100) : null, onlineDone.length ? `${Math.round((notesInTime / onlineDone.length) * 100)}%` : "—", M.notesPct, `≥ ${M.notesPct}%`, onlineDone.length ? status((notesInTime / onlineDone.length) * 100, M.notesPct) : "n", { sub: `${notesInTime} of ${onlineDone.length}` }),
    m("Clinical & operational", "feedback", "Client feedback", "Average rating of reviews this week", rv[0] ? Math.round(rv[0].avg * 10) / 10 : null, rv[0] ? `${(Math.round(rv[0].avg * 10) / 10).toFixed(1)} / 5` : "—", M.feedback, `≥ ${M.feedback}`, rv[0] ? status(rv[0].avg, M.feedback) : "n", { sub: rv[0] ? `${rv[0].n} reviews` : "no reviews this week" }),
    m("Clinical & operational", "utilisation", "Therapist utilisation", "Booked ÷ offered slots", null, "—", null, "50% → 75%", "n", { later: "Phase 5" }),
    m("Clinical & operational", "complaints", "Complaints & incidents", "Acknowledged within 24 h", null, "—", null, "100%", "n", { later: "Phase 5" }),
    m("Cash", "settlements", "Therapist settlements due", "Completed sessions with no payout yet", Math.round(dueAmt), inr(dueAmt), null, "Paid within 7 days", !dueAmt ? "g" : oldestDays <= 7 ? "g" : oldestDays <= 14 ? "a" : "r", { sub: dueAmt ? `oldest ${oldestDays} days${pendingPayouts[0] ? ` · ${inr(pendingPayouts[0].t)} in pending payouts` : ""}` : "nothing waiting" }),
    m("Cash", "cash", "Cash balance & 13-week forecast", "Updated every Monday", null, "—", null, "≥ 3 months' costs", "n", { later: "Phase 4" }),
    m("Cash", "receivables", "Receivables over 30 days", "Mainly EAP invoices", null, "—", null, "₹0", "n", { later: "Phase 4" }),
    m("Cash", "costs", "Fixed costs this month", `Ceiling ${inr(M.fixedCostCeiling)}`, null, "—", null, `≤ ${inr(M.fixedCostCeiling)}`, "n", { later: "Phase 4" }),
  ];
  const counts = { g: 0, a: 0, r: 0, n: 0 };
  for (const x of metrics) counts[x.status] += 1;

  // what to look at first: the reds, then the ambers
  const focus = [...metrics.filter((x) => x.status === "r"), ...metrics.filter((x) => x.status === "a")].slice(0, 4)
    .map((x) => ({ status: x.status, title: x.label, text: `${x.display} this week · target ${x.targetLabel}${x.sub ? ` · ${x.sub}` : ""}` }));

  const divisions = DIVISIONS.map((k) => ({ key: k, actual: monthRev[k], target: monthT ? monthT[k] : null }));

  // the 2027 path: targets, and the actual CYT revenue of each month that has begun
  const path = [];
  for (let i = 1; i <= 12; i++) {
    const key = `2027-${pad(i)}`; const r = monthRange(key);
    path.push({ key, label: SHORT[i - 1], target: T.months[key]?.total ?? null, actual: r.from <= now ? (await revenue(r.from, r.to < now ? r.to : now)).total : null });
  }

  const [, mm] = monthKey.split("-").map(Number);
  res.json({
    status: true,
    data: {
      week: { from: weekKey, to: ymd(new Date(to.getTime() - 1)), current: now >= from && now < to, isFuture: from > now },
      month: {
        key: monthKey, label: `${MONTHS[mm - 1]} ${monthKey.slice(0, 4)}`, toDate: ymd(new Date((weekEnd < mr.to ? weekEnd : mr.to).getTime() - 1)),
        actual: monthRev.total, target: monthT?.total ?? null, divisions, workshops: monthRev.workshops,
        gross: monthRev.gross, therapists: monthRev.therapists, plans: monthRev.plans, assessments: monthRev.assessments, advance: monthRev.advance,
        breakEven: Math.round(M.fixedCostCeiling / (M.contributionPct / 100)), fixedCostCeiling: M.fixedCostCeiling,
        decGoal: T.months["2027-12"]?.total ?? null,
      },
      weekRevenue: weekRev,
      metrics, counts, focus, path,
      updatedAt: new Date(),
    },
  });
});

/* GET /api/admin/growth/targets */
export const getTargets = expressAsyncHandler(async (req, res) => {
  if (!isSuperAdminReq(req)) return res.status(403).json({ status: false, message: "Targets are for the Super Admin." });
  res.json({ status: true, data: { ...(await loadTargets()), defaults: { months: defaultMonths(), metrics: METRIC_DEFAULTS } } });
});

/* PUT /api/admin/growth/targets { months: { "2027-03": { care, connect, corporate, academy } }, metrics: { … } }
   The month total is always the four divisions added up. */
export const saveTargets = expressAsyncHandler(async (req, res) => {
  if (!isSuperAdminReq(req)) return res.status(403).json({ status: false, message: "Targets are for the Super Admin." });
  const known = defaultMonths();
  const doc = (await GrowthSetting.findOne({ key: "targets" }).lean()) || { data: {} };
  const months = { ...(doc.data?.months || {}) };
  const num = (v, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= max ? n : null; };
  for (const [k, v] of Object.entries(req.body?.months || {})) {
    if (!known[k] || !v || typeof v !== "object") continue;
    const row = {};
    for (const d of DIVISIONS) { const n = num(v[d], 1e8); if (n == null) return res.status(400).json({ status: false, message: `${k}: enter a whole number of rupees for ${d}.` }); row[d] = n; }
    row.total = DIVISIONS.reduce((s, d) => s + row[d], 0);
    months[k] = row;
  }
  const metrics = { ...(doc.data?.metrics || {}) };
  for (const [k, v] of Object.entries(req.body?.metrics || {})) {
    if (!(k in METRIC_DEFAULTS)) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > METRIC_LIMITS[k]) return res.status(400).json({ status: false, message: `${k}: that number is out of range.` });
    metrics[k] = k === "feedback" ? Math.round(n * 10) / 10 : Math.round(n);
  }
  if (metrics.contributionPct === 0) return res.status(400).json({ status: false, message: "Contribution margin can't be 0%." });
  await GrowthSetting.updateOne({ key: "targets" }, { $set: { data: { months, metrics }, updatedBy: req.user?.name || req.user?.email || "" } }, { upsert: true });
  res.json({ status: true, message: "Targets saved", data: await loadTargets() });
});

/* PUT /api/admin/growth/manual { week: "YYYY-MM-DD", reviews } — numbers typed in for a week */
export const saveManual = expressAsyncHandler(async (req, res) => {
  if (!isSuperAdminReq(req)) return res.status(403).json({ status: false, message: "Only the Super Admin can do this." });
  const { from } = weekOf(req.body?.week);
  const key = ymd(from);
  const reviews = req.body?.reviews === "" || req.body?.reviews == null ? null : Math.round(Number(req.body.reviews));
  if (reviews != null && (!Number.isFinite(reviews) || reviews < 0 || reviews > 1000)) return res.status(400).json({ status: false, message: "Enter how many new Google reviews came this week (0–1000)." });
  await GrowthSetting.updateOne({ key: "manual" }, { $set: { [`data.weeks.${key}.reviews`]: reviews, updatedBy: req.user?.name || req.user?.email || "" } }, { upsert: true });
  res.json({ status: true, message: "Saved" });
});
