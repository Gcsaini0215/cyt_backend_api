import expressAsyncHandler from "express-async-handler";
import FunnelStat from "../models/FunnelStat.js";

// The steps a visitor goes through from a therapist's /book page to a paid session.
// Order matters: it is the order the admin report shows them in.
export const FUNNEL_STEPS = [
  "book_view",       // /book/<therapist> opened
  "slot_picked",     // chose a date + time
  "otp_sent",        // guest asked for the email code
  "otp_verified",    // guest verified the email code
  "details_done",    // "You" step finished
  "session_done",    // "Session" step finished (service + mode)
  "to_checkout",     // pressed Pay on the summary → /therapist-checkout
  "booking_created", // booking saved on the server
  "rzp_open",        // Razorpay window opened
  "rzp_failed",      // bank / UPI declined inside Razorpay
  "rzp_dismiss",     // closed the Razorpay window without paying
  "paid",            // payment verified
  "verify_error",    // money taken but confirmation failed (needs a human)
];
const STEP_SET = new Set(FUNNEL_STEPS);
const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

// POST /api/funnel/event { e, g: "guest"|"member", m: "online"|"inperson"|"na" } — public, rate limited
export const postFunnelEvent = expressAsyncHandler(async (req, res) => {
  const { e, g, m } = req.body || {};
  if (!STEP_SET.has(e)) return res.status(204).end();
  const who = g === "guest" ? "guest" : "member";
  const mode = m === "online" || m === "inperson" ? m : "na";
  await FunnelStat.updateOne(
    { day: istDay() },
    { $inc: { [`counts.${e}__${who}__${mode}`]: 1 } },
    { upsert: true }
  ).catch(() => {});
  res.status(204).end();
});

// GET /api/admin/funnel?days=30 — totals per step (and split), plus per-day rows
export const adminFunnel = expressAsyncHandler(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
  const since = istDay(new Date(Date.now() - (days - 1) * 864e5));
  const rows = await FunnelStat.find({ day: { $gte: since } }).sort({ day: 1 }).lean();
  const totals = Object.fromEntries(FUNNEL_STEPS.map((s) => [s, { all: 0, guest: 0, member: 0, online: 0, inperson: 0 }]));
  for (const r of rows) {
    for (const [k, n] of Object.entries(r.counts || {})) {
      const [e, who, mode] = k.split("__");
      if (!totals[e]) continue;
      totals[e].all += n;
      totals[e][who] = (totals[e][who] || 0) + n;
      if (mode === "online" || mode === "inperson") totals[e][mode] += n;
    }
  }
  res.json({ status: true, since, steps: FUNNEL_STEPS, totals, days: rows.map((r) => ({ day: r.day, counts: r.counts })) });
});
