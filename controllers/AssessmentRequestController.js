import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import AssessmentRequest from "../models/AssessmentRequest.js";
import TherapistLicence, { LICENSED_TOOLS } from "../models/TherapistLicence.js";
import Booking from "../models/Booking.js";
import Therapists from "../models/Therapists.js";
import { notifyClient } from "../services/clientNotify.js";
import { notifyTherapists } from "../services/therapistNotify.js";

/* Licensed questionnaires taken before a session (see models/AssessmentRequest.js). The questions live
   on the psychologist's own licensed form (formUrl in their licence) — never on CYT. The score is kept
   from the client until the psychologist releases it after going through it with them. */

const NAMES = {
  isi: "Insomnia Severity Index (ISI)", psqi: "Pittsburgh Sleep Quality Index (PSQI)", who5: "WHO-5 Well-Being Index",
  pss10: "Perceived Stress Scale (PSS-10)", ocir: "Obsessive-Compulsive Inventory – Revised (OCI-R)", spin: "Social Phobia Inventory (SPIN)",
  sdq: "Strengths & Difficulties Questionnaire (SDQ)", bdi2: "Beck Depression Inventory-II (BDI-II)", bai: "Beck Anxiety Inventory (BAI)",
};
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const currentLicence = (user, tool) => TherapistLicence.findOne({ user, tool, $or: [{ validTill: null }, { validTill: { $gte: new Date() } }] }).lean();
const upcomingBooking = (client, therapist) => Booking.findOne({
  client, therapist, payment_status: "Paid", status: { $nin: ["Cancelled", "Completed"] },
  booking_date: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
}).sort({ booking_date: 1 }).lean();
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "");

// tell both sides the questionnaire is now waiting for the client
function announceSent(r, booking, therapistName, clientName) {
  notifyClient(r.client, {
    type: "booking", title: `Please fill the ${NAMES[r.tool]} before your session`,
    body: `${therapistName || "Your psychologist"} has sent it for your session on ${when(booking?.booking_date)}.`,
    link: "/client/check-ins", ref: `areq:${r._id}`,
  });
  notifyTherapists([r.therapistUser], {
    type: "booking", title: `${NAMES[r.tool]} sent to ${clientName || "your client"}`,
    body: `For the session on ${when(booking?.booking_date)}. You'll be told when they've filled it.`,
    link: "/therapist-questionnaires", ref: `areq-t:${r._id}`,
  });
}

// Called when a booking is paid: questionnaires the client asked for with this psychologist get attached
export async function attachAssessmentIntents(booking) {
  try {
    if (!booking?._id) return;
    const client = booking.client?._id || booking.client;
    const therapist = booking.therapist?._id || booking.therapist;
    const intents = await AssessmentRequest.find({ client, therapist, status: "intent", updatedAt: { $gte: new Date(Date.now() - 14 * 864e5) } });
    for (const r of intents) {
      r.booking = booking._id; r.status = "sent"; r.sentAt = new Date();
      await r.save();
      announceSent(r, booking, booking.therapist?.user?.name, booking.client?.name);
    }
  } catch (e) {
    console.error("[assessment-request] attach failed:", e.message);
  }
}

// POST /assessment-requests/intent { therapistId, tool } — client: "I want this questionnaire with them".
// Already booked with them → sent right away; otherwise it waits for the booking.
export const requestAssessment = expressAsyncHandler(async (req, res) => {
  const { therapistId, tool } = req.body || {};
  if (!LICENSED_TOOLS.includes(tool) || !isId(therapistId)) return res.status(400).json({ status: false, message: "Invalid request." });
  const t = await Therapists.findById(therapistId).populate("user", "_id name").lean();
  if (!t?.user) return res.status(404).json({ status: false, message: "Psychologist not found." });
  if (!(await currentLicence(t.user._id, tool))) return res.status(400).json({ status: false, message: "This psychologist doesn't hold a current licence for this questionnaire." });

  const booking = await upcomingBooking(req.user._id, t._id);
  let r = await AssessmentRequest.findOne({ client: req.user._id, therapist: t._id, tool, status: { $in: ["intent", "sent", "done"] } });
  if (r && r.status !== "intent") return res.json({ status: true, data: { state: "sent", booking_date: booking?.booking_date || null } });
  if (!r) r = new AssessmentRequest({ client: req.user._id, therapistUser: t.user._id, therapist: t._id, tool });
  if (booking) {
    r.booking = booking._id; r.status = "sent"; r.sentAt = new Date();
    await r.save();
    announceSent(r, booking, t.user.name, req.user.name);
    return res.json({ status: true, data: { state: "sent", booking_date: booking.booking_date } });
  }
  r.status = "intent";
  await r.save(); // bumps updatedAt
  res.json({ status: true, data: { state: "intent" } });
});

// GET /assessment-requests/mine — client
export const myRequests = expressAsyncHandler(async (req, res) => {
  const rows = await AssessmentRequest.find({ client: req.user._id, status: { $ne: "intent" } })
    .populate("therapistUser", "name").populate("booking", "booking_date status").sort({ createdAt: -1 }).limit(50).lean();
  const lic = rows.length ? await TherapistLicence.find({ $or: rows.map((r) => ({ user: r.therapistUser?._id, tool: r.tool })) }).lean() : [];
  const formOf = (r) => lic.find((l) => String(l.user) === String(r.therapistUser?._id) && l.tool === r.tool);
  res.json({
    status: true,
    data: rows.map((r) => {
      const f = ["sent", "done"].includes(r.status) ? formOf(r) : null;
      const released = r.status === "released";
      return {
        _id: r._id, tool: r.tool, name: NAMES[r.tool], therapist: r.therapistUser?.name || "Your psychologist",
        booking_date: r.booking?.booking_date || null, status: released ? "released" : r.status === "scored" ? "done" : r.status,
        formUrl: f?.formUrl || "", instructions: f?.instructions || "",
        ...(released ? { score: r.score, max: r.max, level: r.level, note: r.note, releasedAt: r.releasedAt } : {}),
        createdAt: r.createdAt,
      };
    }),
  });
});

// POST /assessment-requests/:id/done — client has filled the form
export const markDone = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid request." });
  const r = await AssessmentRequest.findOne({ _id: req.params.id, client: req.user._id });
  if (!r) return res.status(404).json({ status: false, message: "Not found." });
  if (r.status === "sent") {
    r.status = "done"; r.doneAt = new Date();
    await r.save();
    notifyTherapists([r.therapistUser], {
      type: "booking", title: `${req.user.name || "Your client"} filled the ${NAMES[r.tool]}`,
      body: "Add the score before the session — the client sees it only after you release it.", link: "/therapist-questionnaires", ref: `areq-done:${r._id}`,
    });
  }
  res.json({ status: true });
});

// GET /assessment-requests/therapist — therapist
export const therapistRequests = expressAsyncHandler(async (req, res) => {
  const rows = await AssessmentRequest.find({ therapistUser: req.user._id, status: { $ne: "intent" } })
    .populate("client", "name email").populate("booking", "booking_date status").sort({ createdAt: -1 }).limit(200).lean();
  res.json({
    status: true,
    data: rows.map((r) => ({
      _id: r._id, tool: r.tool, name: NAMES[r.tool], client: r.client?.name || "Client", email: r.client?.email || "",
      booking_date: r.booking?.booking_date || null, status: r.status, score: r.score, max: r.max, level: r.level, note: r.note,
      sentAt: r.sentAt, doneAt: r.doneAt, releasedAt: r.releasedAt,
    })),
  });
});

// GET /assessment-requests/therapist/bookings — this therapist's upcoming paid sessions (to send a questionnaire)
export const therapistUpcoming = expressAsyncHandler(async (req, res) => {
  const t = await Therapists.findOne({ user: req.user._id }).select("_id").lean();
  if (!t) return res.json({ status: true, data: [] });
  const rows = await Booking.find({ therapist: t._id, payment_status: "Paid", status: { $nin: ["Cancelled", "Completed"] }, booking_date: { $gte: new Date(Date.now() - 60 * 60 * 1000) } })
    .populate("client", "name").sort({ booking_date: 1 }).limit(50).lean();
  res.json({ status: true, data: rows.map((b) => ({ _id: b._id, client: b.client?.name || b.cname || "Client", booking_date: b.booking_date })) });
});

// POST /assessment-requests/send { bookingId, tool } — therapist sends a questionnaire for a session
export const sendForBooking = expressAsyncHandler(async (req, res) => {
  const { bookingId, tool } = req.body || {};
  if (!LICENSED_TOOLS.includes(tool) || !isId(bookingId)) return res.status(400).json({ status: false, message: "Invalid request." });
  if (!(await currentLicence(req.user._id, tool))) return res.status(400).json({ status: false, message: "Add a current licence for this questionnaire in Settings → Licences first." });
  const t = await Therapists.findOne({ user: req.user._id }).select("_id").lean();
  const b = await Booking.findOne({ _id: bookingId, therapist: t?._id, payment_status: "Paid" }).populate("client", "_id name").lean();
  if (!b?.client) return res.status(404).json({ status: false, message: "Session not found." });
  let r = await AssessmentRequest.findOne({ client: b.client._id, therapist: t._id, tool, booking: b._id });
  if (r && r.status !== "intent") return res.json({ status: true, message: "Already sent for this session." });
  if (!r) r = new AssessmentRequest({ client: b.client._id, therapistUser: req.user._id, therapist: t._id, tool });
  r.booking = b._id; r.status = "sent"; r.sentAt = new Date();
  await r.save();
  announceSent(r, b, req.user.name, b.client.name);
  res.json({ status: true, message: "Sent to your client." });
});

// POST /assessment-requests/:id/score { score, max?, level?, note? } — therapist; hidden from the client
export const saveScore = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid request." });
  const r = await AssessmentRequest.findOne({ _id: req.params.id, therapistUser: req.user._id });
  if (!r) return res.status(404).json({ status: false, message: "Not found." });
  const score = Number(req.body?.score);
  const max = req.body?.max === "" || req.body?.max == null ? null : Number(req.body.max);
  if (!Number.isFinite(score) || score < 0 || score > 1000) return res.status(400).json({ status: false, message: "Enter a valid score." });
  if (max !== null && (!Number.isFinite(max) || max < score)) return res.status(400).json({ status: false, message: "Maximum must be at least the score." });
  r.score = score; r.max = max;
  r.level = String(req.body?.level || "").trim().slice(0, 60);
  r.note = String(req.body?.note || "").trim().slice(0, 600);
  if (r.status !== "released") { r.status = "scored"; r.scoredAt = new Date(); }
  await r.save();
  res.json({ status: true, message: r.status === "released" ? "Updated — your client sees the new score." : "Score saved. Your client won't see it until you release it." });
});

// POST /assessment-requests/:id/release — therapist, after going through it with the client
export const releaseScore = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid request." });
  const r = await AssessmentRequest.findOne({ _id: req.params.id, therapistUser: req.user._id });
  if (!r) return res.status(404).json({ status: false, message: "Not found." });
  if (r.score == null) return res.status(400).json({ status: false, message: "Add the score first." });
  if (r.status !== "released") {
    r.status = "released"; r.releasedAt = new Date();
    await r.save();
    notifyClient(r.client, {
      type: "completed", title: `Your ${NAMES[r.tool]} result is ready`,
      body: `${req.user.name || "Your psychologist"} has shared your score and a note.`, link: "/client/check-ins", ref: `areq-rel:${r._id}`,
    });
  }
  res.json({ status: true, message: "Released — your client can now see their score." });
});
