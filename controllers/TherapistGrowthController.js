import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Therapists from "../models/Therapists.js";
import Booking from "../models/Booking.js";
import Users from "../models/Users.js";
import Availbility from "../models/Availbility.js";
import FollowupNudge from "../models/FollowupNudge.js";
import { sendMail } from "../helper/mailer.js";
import { therapistFollowupMail } from "../services/mailTemplates.js";
import { followupList, badgeProgress, demandGrid, coverage, DAYS, BANDS, NUDGE_GAP_DAYS } from "../helper/therapistGrowth.js";

const SITE = "https://www.chooseyourtherapist.in";
const myProfile = (req) => Therapists.findOne({ user: req.user._id }).lean();

/* GET /api/therapist-growth/me — goal, Top-therapist progress, follow-ups, booking demand vs their hours */
export const myGrowth = expressAsyncHandler(async (req, res) => {
  const t = await myProfile(req);
  if (!t) return res.json({ status: false, message: "Profile not found" });
  const [followups, badge, demand, av] = await Promise.all([
    followupList(t._id),
    badgeProgress(t),
    demandGrid(),
    Availbility.findOne({ user_id: { $in: [t._id, req.user._id] } }, { schedule: 1 }).lean(),
  ]);
  const sched = (t.availabilities?.length ? t.availabilities : av?.schedule) || [];
  const cov = coverage(sched);
  // busiest cells where they have no hours
  const cells = [];
  demand.grid.forEach((row, di) => row.forEach((n, bi) => cells.push({ di, bi, n })));
  const max = Math.max(1, ...cells.map((c) => c.n));
  const gaps = cells.filter((c) => c.n >= max * 0.45 && !cov[c.di][c.bi]).sort((a, b) => b.n - a.n).slice(0, 3)
    .map((c) => ({ day: DAYS[c.di], band: BANDS[c.bi].label, range: BANDS[c.bi].range }));
  res.json({
    status: true,
    data: {
      goal: Number(t.monthly_goal) || 0,
      topTherapist: !!t.top_therapist,
      badge,
      followups,
      demand: { days: DAYS, bands: BANDS.map(({ key, label, range }) => ({ key, label, range })), grid: demand.grid, total: demand.total, coverage: cov, gaps },
    },
  });
});

/* PUT /api/therapist-growth/goal { amount } — monthly earnings goal (₹, 0 clears it) */
export const setGoal = expressAsyncHandler(async (req, res) => {
  const amount = Math.round(Number(req.body?.amount) || 0);
  if (amount < 0 || amount > 1000000) return res.status(400).json({ status: false, message: "Enter an amount between ₹0 and ₹10,00,000" });
  await Therapists.updateOne({ user: req.user._id }, { $set: { monthly_goal: amount } });
  res.json({ status: true, data: { goal: amount } });
});

// the client must have had a completed session with this therapist
async function ownClient(t, clientId) {
  if (!mongoose.isValidObjectId(clientId)) return null;
  const had = await Booking.exists({ therapist: t._id, client: clientId, status: "Completed" });
  if (!had) return null;
  return Users.findById(clientId, { name: 1, email: 1 }).lean();
}

/* POST /api/therapist-growth/followups/:clientId/email { message } — CYT emails the past client for the therapist */
export const emailFollowup = expressAsyncHandler(async (req, res) => {
  const t = await Therapists.findOne({ user: req.user._id }).populate("user", "name").lean();
  if (!t) return res.status(404).json({ status: false, message: "Profile not found" });
  const c = await ownClient(t, req.params.clientId);
  if (!c) return res.status(404).json({ status: false, message: "Client not found" });
  if (!c.email) return res.status(400).json({ status: false, message: "This client has no email — use WhatsApp" });
  const last = await FollowupNudge.findOne({ therapist: t._id, client: c._id, channel: "email" }).sort({ at: -1 }).lean();
  if (last && Date.now() - new Date(last.at).getTime() < NUDGE_GAP_DAYS * 86400000) {
    return res.status(429).json({ status: false, message: `You emailed this client recently — you can send another after ${NUDGE_GAP_DAYS} days.` });
  }
  const message = String(req.body?.message || "").trim().slice(0, 1200);
  if (message.length < 10) return res.status(400).json({ status: false, message: "Write a short message first" });
  const therapistName = t.user?.name || "Your therapist";
  const html = therapistFollowupMail({ clientName: String(c.name || "").split(/\s+/)[0], therapistName, message, bookHref: `${SITE}/view-profile/${t._id}` });
  const ok = await sendMail(c.email, `A note from ${therapistName}`, `${message}\n\n— ${therapistName}\nBook: ${SITE}/view-profile/${t._id}`, html, `${therapistName} via CYT`);
  if (!ok) return res.status(502).json({ status: false, message: "Couldn't send the email — please try again" });
  await FollowupNudge.create({ therapist: t._id, client: c._id, channel: "email" });
  res.json({ status: true, message: `Email sent to ${c.name || "the client"}` });
});

/* POST /api/therapist-growth/followups/:clientId/nudged { channel: "whatsapp" } — remember a WhatsApp nudge */
export const markNudged = expressAsyncHandler(async (req, res) => {
  const t = await myProfile(req);
  if (!t) return res.status(404).json({ status: false });
  const c = await ownClient(t, req.params.clientId);
  if (!c) return res.status(404).json({ status: false });
  await FollowupNudge.create({ therapist: t._id, client: c._id, channel: "whatsapp" });
  res.json({ status: true });
});
