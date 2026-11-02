import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import ProbonoIntern from "../models/ProbonoIntern.js";
import ProbonoSession from "../models/ProbonoSession.js";
import TherapistGoogle from "../models/TherapistGoogle.js";
import { sendMail } from "../helper/mailer.js";
import { isNewClient } from "../helper/referral.js";
import { notifyClient } from "../services/clientNotify.js";
import { notifyTrainees, traineeChanged } from "../services/traineeNotify.js";
import { PROBONO_COUPON_AMOUNT, PROBONO_COUPON_DAYS, phoneKey, issueCoupon, couponActive, findRepeats } from "../helper/probono.js";
import { googleConfigured, authUrlFor, createMeetForProbono, deleteProbonoEvent, revoke } from "../helper/googleMeet.js";

/* The free first session. A signed-in client shares their details from their dashboard; the admin team picks the
   trainee and the time; the Meet comes from the trainee's Google (or a link the team pastes). A completed session
   gives the client a time-limited coupon for their first paid session, with any therapist. */

const SITE = "https://www.chooseyourtherapist.in";
const clip = (v, n = 500) => String(v ?? "").trim().slice(0, n);
const validId = (id) => mongoose.Types.ObjectId.isValid(id);
const mail = (to, subject, text) => sendMail(to, subject, text, `<p>${text}</p>`).catch(() => {});
const slotText = (d) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const internOf = (email) => ProbonoIntern.findOne({ email: new RegExp(`^${escRe(email)}$`, "i") });
const OPEN = ["requested", "accepted"];

const detailsOf = (body) => {
  const age = Number(body.age);
  return {
    concern: clip(body.concern, 1000), city: clip(body.city, 80), language: clip(body.language, 60),
    age: Number.isInteger(age) && age >= 18 && age <= 120 ? age : null,
  };
};
const detailsError = (d) => {
  if (!d.concern) return "Please tell us briefly what you'd like to talk about.";
  if (!d.age) return "Please enter your age. This service is for adults (18+).";
  return "";
};

// a client may cancel once and ask again; a second cancel, or one under a day before the session, uses the free session
const LATE_CANCEL_MS = 24 * 3600000;
const cancelUsesFree = async (s) => {
  if (s.slot_at && new Date(s.slot_at).getTime() - Date.now() < LATE_CANCEL_MS) return true;
  return !!(await ProbonoSession.exists({ $or: [{ client: s.client }, { phone: s.phone }], status: "cancelled" }));
};

/* ── client (signed in) ── */

const clientRow = (s, usesFree = false) => ({
  cancel_uses_free: usesFree,
  _id: s._id, status: s.status, slot_at: s.slot_at, concern: s.concern, age: s.age, city: s.city, language: s.language, phone: s.phone,
  decline_reason: s.decline_reason, meet_link: s.status === "accepted" ? s.meet_link : "",
  preferred: s.preferred?.name || "",
  intern: s.intern ? { name: s.intern.name, slug: s.intern.slug, photo: s.intern.photo, roleLabel: s.intern.roleLabel } : null,
  coupon: couponActive(s) ? { code: s.coupon_code, amount: s.coupon_amount, expires_at: s.coupon_expires_at } : null,
});

/* GET /api/probono/me — the client's free session and coupon */
export const myProbono = expressAsyncHandler(async (req, res) => {
  const s = await ProbonoSession.findOne({ client: req.user._id }).sort({ holds_free: -1, createdAt: -1 })
    .populate("intern", "name slug photo roleLabel").populate("preferred", "name").lean();
  const eligible = !s?.holds_free && (await isNewClient(req.user.email)); // the free session is for a first-time client
  const usesFree = OPEN.includes(s?.status) ? await cancelUsesFree(s) : false;
  res.set("Cache-Control", "no-store").json({ status: true, data: { eligible, session: s ? clientRow(s, usesFree) : null } });
});

/* POST /api/probono/request { guide (slug, optional), phone, age, city, language, concern, consent } */
export const requestSession = expressAsyncHandler(async (req, res) => {
  if (req.body.consent !== true) return res.status(400).json({ status: false, message: "Please read and accept the consent first." });
  const d = detailsOf(req.body);
  const phone = phoneKey(req.body.phone || req.user.phone);
  const bad = phone.length !== 10 ? "Please enter a valid phone number." : detailsError(d);
  if (bad) return res.status(400).json({ status: false, message: bad });
  if (!(await isNewClient(req.user.email))) return res.status(409).json({ status: false, message: "The free session is for clients who are new to CYT." });
  if (await ProbonoSession.exists({ phone, holds_free: true })) {
    return res.status(409).json({ status: false, message: "The free session has already been used with this phone number." });
  }
  const preferred = req.body.guide ? await ProbonoIntern.findOne({ slug: clip(req.body.guide, 120), isActive: true }).select("_id").lean() : null;
  let s;
  try {
    s = await ProbonoSession.create({
      client: req.user._id, name: clip(req.user.name, 120), email: req.user.email, phone, ...d, preferred: preferred?._id || null, consent_at: new Date(),
    });
  } catch (e) {
    if (e?.code !== 11000) throw e;
    return res.status(409).json({ status: false, message: "You've already used your free session." });
  }
  if (preferred) await ProbonoIntern.updateOne({ _id: preferred._id }, { $inc: { requestsSent: 1 } });
  res.status(201).json({ status: true, message: "Details sent", data: { _id: s._id } });
});

/* PUT /api/probono/:id — change the details until the team has scheduled the session. The phone stays as sent:
   it's what limits a free session to one person, so only the team can change it. */
export const updateDetails = expressAsyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ status: false, message: "Session not found" });
  const d = detailsOf(req.body);
  const bad = detailsError(d);
  if (bad) return res.status(400).json({ status: false, message: bad });
  const s = await ProbonoSession.findOneAndUpdate(
    { _id: req.params.id, client: req.user._id, status: "requested" }, { $set: d }, { new: true }
  );
  if (!s) return res.status(409).json({ status: false, message: "Your session is already scheduled. Please contact us to change your details." });
  res.json({ status: true, message: "Details updated" });
});

/* POST /api/probono/:id/cancel */
export const cancelSession = expressAsyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ status: false, message: "Session not found" });
  const where = { _id: req.params.id, client: req.user._id, status: { $in: OPEN } };
  const open = await ProbonoSession.findOne(where).select("client phone slot_at").lean();
  if (!open) return res.status(404).json({ status: false, message: "Session not found" });
  const usesFree = await cancelUsesFree(open);
  // slot_at is cleared when the free session is used up, or the record would keep holding the trainee's time
  const s = await ProbonoSession.findOneAndUpdate(where, { $set: { status: "cancelled", holds_free: usesFree, ...(usesFree ? { slot_at: null } : {}) } }, { new: true }).populate("intern", "email");
  if (!s) return res.status(404).json({ status: false, message: "Session not found" });
  deleteProbonoEvent(s);
  if (s.intern?.email && open.slot_at) notifyTrainees(s.intern.email, { type: "probono", title: "A pro bono session was cancelled", body: slotText(open.slot_at), link: "/trainee/probono" });
  res.json({ status: true, message: "Session cancelled", data: { used_free: usesFree } });
});

/* ── shared by the admin panel and the trainee portal ── */

async function complete(s, intern) {
  deleteProbonoEvent(s, intern);
  const withCoupon = await issueCoupon(s._id);
  notifyClient(s.client, {
    type: "referral", title: `₹${PROBONO_COUPON_AMOUNT} off your first session`,
    body: `Your coupon works with any CYT therapist for ${PROBONO_COUPON_DAYS} days.`, link: "/my-dashboard", ref: `probono-coupon:${s._id}`,
  });
  mail(s.email, `Your ₹${PROBONO_COUPON_AMOUNT} coupon for your first session`, `Thank you for your session${intern?.name ? ` with ${intern.name}` : ""}. If you'd like to continue, coupon ${withCoupon.coupon_code} gives you ₹${PROBONO_COUPON_AMOUNT} off your first paid session with any CYT therapist for the next ${PROBONO_COUPON_DAYS} days. There's no pressure to book: ${SITE}/client/find`);
}

const started = () => ({ status: "accepted", slot_at: { $lte: new Date() } });

/* ── trainee portal: sessions the team gave them, and their Google connection ── */

// every /trainee-portal/probono route: the pro bono profile with this trainee's email
export const needIntern = expressAsyncHandler(async (req, res, next) => {
  req.intern = await internOf(req.trainee.email);
  if (!req.intern) return res.status(404).json({ status: false, code: "no_profile", message: "Your pro bono profile isn't set up yet. Please ask the CYT team." });
  next();
});

const traineeRow = (s) => ({
  _id: s._id, name: s.name, concern: s.concern, age: s.age, language: s.language, slot_at: s.slot_at, status: s.status, meet_link: s.meet_link, createdAt: s.createdAt,
});

/* GET /api/trainee-portal/probono */
export const traineeProbono = expressAsyncHandler(async (req, res) => {
  const [rows, conn] = await Promise.all([
    ProbonoSession.find({ intern: req.intern._id, slot_at: { $ne: null } }).sort({ slot_at: -1 }).limit(200).lean(),
    TherapistGoogle.findOne({ user: req.intern._id }).select("email last_error").lean(),
  ]);
  res.json({
    status: true,
    data: {
      sessions: rows.map(traineeRow),
      google: { configured: googleConfigured(), connected: !!conn, email: conn?.email || "", lastError: conn?.last_error || "" },
    },
  });
});

const mine = (req, extra = {}) => ({ _id: req.params.id, intern: req.intern._id, ...extra });

/* POST /api/trainee-portal/probono/:id/complete */
export const completeSession = expressAsyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ status: false, message: "Session not found" });
  const s = await ProbonoSession.findOneAndUpdate(mine(req, started()), { $set: { status: "completed", completed_at: new Date() } }, { new: true });
  if (!s) return res.status(404).json({ status: false, message: "This session can be completed once its time has started." });
  await complete(s, req.intern);
  res.json({ status: true, message: "Session completed" });
});

/* POST /api/trainee-portal/probono/:id/no-show */
export const markNoShow = expressAsyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ status: false, message: "Session not found" });
  const s = await ProbonoSession.findOneAndUpdate(mine(req, started()), { $set: { status: "no_show" } }, { new: true });
  if (!s) return res.status(404).json({ status: false, message: "This session can be marked once its time has started." });
  deleteProbonoEvent(s, req.intern);
  res.json({ status: true, message: "Marked as not attended" });
});

/* POST /api/trainee-portal/probono/:id/release { reason } — can't make it: back to the team to schedule again */
export const releaseSession = expressAsyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ status: false, message: "Session not found" });
  const s = await ProbonoSession.findOne(mine(req, { status: "accepted", slot_at: { $gt: new Date() } }));
  if (!s) return res.status(404).json({ status: false, message: "This session can't be changed now." });
  deleteProbonoEvent(s, req.intern);
  await ProbonoSession.updateOne({ _id: s._id }, { $set: { status: "requested", intern: null, slot_at: null, meet_link: "", calendar_event_id: "", team_note: `${req.intern.name} couldn't make it. ${clip(req.body.reason, 300)}`.trim() } });
  notifyClient(s.client, { type: "rescheduled", title: "We're finding you a new time", body: "Your guide can't make that time. Our team will confirm a new one soon.", link: "/client/free-session", ref: `probono-release:${s._id}:${Date.now()}` });
  mail(s.email, "We're finding you a new time", "Your guide can't make your free session time. Our team will confirm a new time soon. Your free session is still yours.");
  res.json({ status: true, message: "Sent back to the CYT team" });
});

/* GET /api/trainee-portal/probono/google/connect */
export const traineeGoogleConnect = expressAsyncHandler(async (req, res) => {
  if (!googleConfigured()) return res.status(503).json({ status: false, message: "Google connection isn't available yet" });
  res.json({ status: true, data: { url: authUrlFor(req.intern._id, "trainee") } });
});

/* POST /api/trainee-portal/probono/google/disconnect */
export const traineeGoogleDisconnect = expressAsyncHandler(async (req, res) => {
  const conn = await TherapistGoogle.findOne({ user: req.intern._id });
  if (conn) {
    await revoke(conn);
    await TherapistGoogle.deleteOne({ _id: conn._id });
  }
  res.json({ status: true, message: "Google disconnected" });
});

/* ── admin: every request, and full control of who takes it and when ── */

/* GET /api/admin/probono/sessions */
export const adminSessions = expressAsyncHandler(async (req, res) => {
  const [rows, conns, everyone] = await Promise.all([
    ProbonoSession.find().sort({ createdAt: -1 }).limit(500).populate("intern", "name").populate("preferred", "name").lean(),
    TherapistGoogle.find().select("user").lean(),
    ProbonoSession.find().select("client name email phone status").lean(),
  ]);
  const sessions = rows.map((r) => (OPEN.includes(r.status) ? { ...r, repeats: findRepeats(r, everyone) } : r));
  res.json({ status: true, data: { sessions, googleConnected: conns.map((c) => String(c.user)) } });
});

/* POST /api/admin/probono/sessions/:id/schedule { intern, slot_at, meet_link } — also reschedules.
   No link given → the Meet is created on the trainee's Google. */
export const adminSchedule = expressAsyncHandler(async (req, res) => {
  const { intern: internId, slot_at } = req.body;
  const link = clip(req.body.meet_link, 300);
  if (!validId(req.params.id) || !validId(internId)) return res.status(404).json({ status: false, message: "Please choose a trainee." });
  const at = new Date(slot_at);
  if (isNaN(at) || at <= new Date()) return res.status(400).json({ status: false, message: "Please choose a future date and time." });
  if (link && !/^https:\/\/\S+$/.test(link)) return res.status(400).json({ status: false, message: "The Meet link must start with https://" });
  const intern = await ProbonoIntern.findById(internId);
  if (!intern?.isActive) return res.status(400).json({ status: false, message: "This trainee isn't active." });
  if (!link && !(await TherapistGoogle.exists({ user: intern._id }))) {
    return res.status(400).json({ status: false, message: "This trainee hasn't connected Google. Paste a Meet link instead." });
  }
  const before = await ProbonoSession.findOne({ _id: req.params.id, status: { $in: OPEN } });
  if (!before) return res.status(404).json({ status: false, message: "This request is no longer open." });

  const fields = (x) => ({ status: x.status, intern: x.intern, slot_at: x.slot_at, meet_link: x.meet_link, calendar_event_id: x.calendar_event_id, accepted_at: x.accepted_at });
  let s;
  try {
    s = await ProbonoSession.findByIdAndUpdate(before._id, {
      $set: { status: "accepted", intern: intern._id, slot_at: at, meet_link: link, calendar_event_id: "", accepted_at: new Date(), team_note: "" },
    }, { new: true });
  } catch (e) {
    if (e?.code !== 11000) throw e;
    return res.status(409).json({ status: false, message: "This trainee already has a session at that time." });
  }
  if (!link) {
    const meet = await createMeetForProbono(s, intern);
    if (!meet) {
      await ProbonoSession.updateOne({ _id: s._id }, { $set: fields(before) });
      return res.status(502).json({ status: false, message: "Google couldn't create the Meet link. Try again, or paste a link." });
    }
    await ProbonoSession.updateOne({ _id: s._id }, { $set: { meet_link: meet.link, calendar_event_id: meet.eventId } });
  }
  if (before.calendar_event_id) deleteProbonoEvent(before);
  if (before.status === "requested") await ProbonoIntern.updateOne({ _id: intern._id }, { $inc: { connected: 1 } });
  const moved = before.status === "accepted";
  notifyClient(s.client, { type: "booking", title: `Your free session is ${moved ? "moved" : "confirmed"} with ${intern.name}`, body: slotText(at), link: "/my-dashboard", ref: `probono:${s._id}:${at.getTime()}` });
  mail(s.email, `Your free session is ${moved ? "moved" : "confirmed"}`, `Your free session with ${intern.name} is on ${slotText(at)}. Join from My Space: ${SITE}/my-dashboard`);
  if (intern.email) {
    notifyTrainees(intern.email, { type: "probono", title: "New pro bono session", body: `${s.name} · ${slotText(at)}`, link: "/trainee/probono" });
    mail(intern.email, "New pro bono session", `The CYT team has scheduled a pro bono session for you on ${slotText(at)}. Details: ${SITE}/trainee/probono`);
    traineeChanged(intern.email, "probono");
  }
  res.json({ status: true, message: moved ? "Session moved" : "Session scheduled" });
});

/* POST /api/admin/probono/sessions/:id/phone { phone } — clients can't change it themselves */
export const adminSetPhone = expressAsyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(404).json({ status: false, message: "Session not found" });
  const phone = phoneKey(req.body.phone);
  if (phone.length !== 10) return res.status(400).json({ status: false, message: "Please enter a 10-digit phone number." });
  if (await ProbonoSession.exists({ _id: { $ne: req.params.id }, phone, holds_free: true })) {
    return res.status(409).json({ status: false, message: "Another free session already uses this phone number." });
  }
  const s = await ProbonoSession.findOneAndUpdate({ _id: req.params.id, status: { $in: OPEN } }, { $set: { phone } });
  if (!s) return res.status(404).json({ status: false, message: "This request is no longer open." });
  res.json({ status: true, message: "Phone updated" });
});

/* POST /api/admin/probono/sessions/:id/status { status: completed | no_show | declined, reason, repeat }
   repeat: declined because this person has had their free session, so they can't ask again */
export const adminSetStatus = expressAsyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!validId(req.params.id) || !["completed", "no_show", "declined"].includes(status)) return res.status(400).json({ status: false, message: "That change isn't allowed." });
  const reason = clip(req.body.reason, 300);
  const repeat = status === "declined" && req.body.repeat === true;
  const set = status === "completed" ? { status, completed_at: new Date() } : status === "no_show" ? { status }
    : repeat ? { status, holds_free: true, slot_at: null, decline_reason: reason }
    : { status, holds_free: false, decline_reason: reason };
  const where = status === "declined" ? { _id: req.params.id, status: { $in: OPEN } } : { _id: req.params.id, ...started() };
  const s = await ProbonoSession.findOneAndUpdate(where, { $set: set }, { new: true }).populate("intern", "name email");
  if (!s) return res.status(404).json({ status: false, message: status === "declined" ? "This request is no longer open." : "This can be set once the session's time has started." });
  if (status === "completed") await complete(s, s.intern);
  else deleteProbonoEvent(s);
  if (repeat) {
    notifyClient(s.client, { type: "cancelled", title: "The free consultation is one per person", body: reason || "You can book with any of our therapists.", link: "/client/find", ref: `probono-declined:${s._id}` });
    mail(s.email, "About your free consultation", `The free consultation is one per person, so we can't arrange another one. ${reason} You can book with any of our therapists here: ${SITE}/client/find`);
  } else if (status === "declined") {
    notifyClient(s.client, { type: "cancelled", title: "We couldn't arrange your free session", body: reason || "Your free session is still yours — you can share your details again.", link: "/client/free-session", ref: `probono-declined:${s._id}` });
    mail(s.email, "About your free session", `We couldn't arrange your free session. ${reason} You can share your details again here: ${SITE}/client/free-session`);
  }
  res.json({ status: true, message: "Updated" });
});

/* GET /api/admin/probono/funnel — request → session → first paid session */
export const probonoFunnel = expressAsyncHandler(async (req, res) => {
  const rows = await ProbonoSession.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const [coupons, couponsUsed] = await Promise.all([
    ProbonoSession.countDocuments({ coupon_code: { $exists: true } }),
    ProbonoSession.countDocuments({ coupon_used_at: { $ne: null } }),
  ]);
  res.json({
    status: true,
    data: {
      requests: rows.reduce((n, r) => n + r.n, 0), waiting: by.requested || 0, upcoming: by.accepted || 0,
      completed: by.completed || 0, noShow: by.no_show || 0, lost: (by.declined || 0) + (by.cancelled || 0), coupons, couponsUsed,
    },
  });
});
