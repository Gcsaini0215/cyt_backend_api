import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import AssessmentRequest from "../models/AssessmentRequest.js";
import { TEST_BY_KEY, validAnswers } from "../helper/assessmentTests.js";
import { notifyClient } from "../services/clientNotify.js";
import { notifyTherapists } from "../services/therapistNotify.js";

/* Clinical assessments booked with a session (see models/AssessmentRequest.js). The client answers on
   CYT; the score is worked out here, on the server, from the published scoring. The psychologist sees
   the report at once; the client sees it only after the psychologist releases it. */

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const nameOf = (tool) => TEST_BY_KEY[tool]?.full || tool;
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "");

// Booking paid → one request per assessment booked with it (runs once per booking + test)
export async function attachBookingAssessments(booking) {
  try {
    const list = (booking?.assessments || []).filter((a) => TEST_BY_KEY[a.tool]);
    if (!list.length) return;
    const client = booking.client?._id || booking.client;
    const therapistUser = booking.therapist?.user?._id || booking.therapist?.user;
    const therapist = booking.therapist?._id || booking.therapist;
    if (!client || !therapistUser) return;
    for (const a of list) {
      const exists = await AssessmentRequest.exists({ booking: booking._id, tool: a.tool });
      if (exists) continue;
      const r = await AssessmentRequest.create({ client, therapistUser, therapist, booking: booking._id, tool: a.tool, status: "sent", sentAt: new Date() });
      notifyClient(client, {
        type: "booking", title: `Please complete your ${nameOf(a.tool)}`,
        body: `Before your session on ${when(booking.booking_date)} with ${booking.therapist?.user?.name || "your psychologist"}. It takes a few minutes.`,
        link: `/client/assessment/${r._id}`, ref: `areq:${r._id}`,
      });
    }
  } catch (e) {
    console.error("[assessment-request] attach failed:", e.message);
  }
}

// GET /assessment-requests/mine — client; the score only once released
export const myRequests = expressAsyncHandler(async (req, res) => {
  const rows = await AssessmentRequest.find({ client: req.user._id, tool: { $in: Object.keys(TEST_BY_KEY) } })
    .populate("therapistUser", "name").populate("booking", "booking_date").sort({ createdAt: -1 }).limit(50).lean();
  res.json({
    status: true,
    data: rows.map((r) => ({
      _id: r._id, tool: r.tool, name: nameOf(r.tool), therapist: r.therapistUser?.name || "Your psychologist",
      booking_date: r.booking?.booking_date || null, status: ["sent", "done", "released"].includes(r.status) ? r.status : "sent",
      ...(r.status === "released" ? { result: { score: r.result?.score ?? null, level: r.result?.level || "" }, note: r.note } : {}),
    })),
  });
});

// GET /assessment-requests/:id/take — client: the test to answer
export const takeRequest = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid link." });
  const r = await AssessmentRequest.findOne({ _id: req.params.id, client: req.user._id }).populate("therapistUser", "name").populate("booking", "booking_date").lean();
  if (!r) return res.status(404).json({ status: false, message: "Not found." });
  res.json({ status: true, data: { _id: r._id, tool: r.tool, status: r.status, therapist: r.therapistUser?.name || "Your psychologist", booking_date: r.booking?.booking_date || null } });
});

// POST /assessment-requests/:id/submit { answers: [n…] } — client; scored here
export const submitRequest = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid link." });
  const r = await AssessmentRequest.findOne({ _id: req.params.id, client: req.user._id });
  if (!r) return res.status(404).json({ status: false, message: "Not found." });
  if (r.status !== "sent") return res.status(400).json({ status: false, message: "This assessment has already been submitted." });
  const test = TEST_BY_KEY[r.tool];
  const answers = (req.body?.answers || []).map(Number);
  if (!test || !validAnswers(test, answers)) return res.status(400).json({ status: false, message: "Please answer every question." });
  const out = test.score(Object.fromEntries(answers.map((v, i) => [i, v])));
  r.answers = answers;
  r.result = { score: out.score ?? null, max: test.max ?? null, level: out.level, color: out.color, text: out.text, dims: out.dims || null, bars: out.bars || null, flag: !!out.flag };
  r.status = "done"; r.doneAt = new Date();
  r.markModified("result");
  await r.save();
  notifyTherapists([r.therapistUser], {
    type: "booking", title: `${req.user.name || "Your client"} completed the ${test.short}${out.flag ? " ⚠ self-harm item" : ""}`,
    body: `${out.level}${out.score != null ? ` · ${out.score}/${test.max}` : ""} — open the report before the session.`,
    link: `/assessment-report/${r._id}`, ref: `areq-done:${r._id}`,
  });
  res.json({ status: true, message: "Submitted." });
});

// GET /assessment-requests/therapist — therapist's list
export const therapistRequests = expressAsyncHandler(async (req, res) => {
  const rows = await AssessmentRequest.find({ therapistUser: req.user._id, tool: { $in: Object.keys(TEST_BY_KEY) } })
    .populate("client", "name").populate("booking", "booking_date").sort({ createdAt: -1 }).limit(200).lean();
  res.json({
    status: true,
    data: rows.map((r) => ({
      _id: r._id, tool: r.tool, name: nameOf(r.tool), client: r.client?.name || "Client", booking_date: r.booking?.booking_date || null,
      status: r.status, level: r.result?.level || "", score: r.result?.score ?? null, max: r.result?.max ?? null, flag: !!r.result?.flag, note: r.note,
      doneAt: r.doneAt, releasedAt: r.releasedAt,
    })),
  });
});

// GET /assessment-requests/:id/report — the therapist who owns it, or the client once released
export const reportRequest = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid link." });
  const r = await AssessmentRequest.findById(req.params.id).populate("client", "name age gender").populate("therapistUser", "name").populate("booking", "booking_date").lean();
  const me = String(req.user._id);
  const isTherapist = r && String(r.therapistUser?._id) === me;
  const isClient = r && String(r.client?._id) === me && r.status === "released";
  if (!isTherapist && !isClient) return res.status(404).json({ status: false, message: "Report not available." });
  if (r.status === "sent") return res.status(400).json({ status: false, message: "The client hasn't completed it yet." });
  res.json({
    status: true,
    data: {
      _id: r._id, tool: r.tool, status: r.status, viewer: isTherapist ? "therapist" : "client",
      client: { name: r.client?.name || "Client", age: r.client?.age || null, gender: r.client?.gender || "" },
      therapist: r.therapistUser?.name || "", booking_date: r.booking?.booking_date || null,
      answers: r.answers || [], result: r.result, note: r.note, doneAt: r.doneAt, releasedAt: r.releasedAt,
    },
  });
});

// POST /assessment-requests/:id/release { note? } — therapist, after going through it with the client
export const releaseRequest = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid request." });
  const r = await AssessmentRequest.findOne({ _id: req.params.id, therapistUser: req.user._id });
  if (!r) return res.status(404).json({ status: false, message: "Not found." });
  if (r.status === "sent") return res.status(400).json({ status: false, message: "The client hasn't completed it yet." });
  if (req.body?.note != null) r.note = String(req.body.note).trim().slice(0, 1000);
  const first = r.status !== "released";
  r.status = "released"; if (first) r.releasedAt = new Date();
  await r.save();
  if (first) {
    notifyClient(r.client, {
      type: "completed", title: `Your ${nameOf(r.tool)} report is ready`,
      body: `${req.user.name || "Your psychologist"} has shared your result and a note.`, link: `/assessment-report/${r._id}`, ref: `areq-rel:${r._id}`,
    });
  }
  res.json({ status: true, message: first ? "Released — your client can now see the report." : "Note updated." });
});
