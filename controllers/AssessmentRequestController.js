import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import crypto from "crypto";
import AssessmentRequest, { AssessmentOrder } from "../models/AssessmentRequest.js";
import { getPricing } from "../helper/assessmentPricing.js";
import { razorpayClient } from "../helper/therapistSubscription.js";
import { TEST_BY_KEY, validAnswers } from "../helper/assessmentTests.js";
import { notifyClient } from "../services/clientNotify.js";
import { notifyTherapists } from "../services/therapistNotify.js";
import TherapistAddon from "../models/TherapistAddon.js";
import QRCode from "qrcode";

const SITE = "https://www.chooseyourtherapist.in";
const verifyUrl = (id) => `${SITE}/verify-report/${id}`;
const initialsOf = (name = "") => String(name).trim().split(/\s+/).filter(Boolean).map((w) => `${w[0].toUpperCase()}.`).join(" ") || "—";


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
      _id: r._id, tool: r.tool, name: nameOf(r.tool), selfOnly: !!r.selfOnly, therapist: r.selfOnly ? "" : r.therapistUser?.name || "Your psychologist",
      booking_date: r.booking?.booking_date || null, createdAt: r.createdAt, status: ["sent", "done", "released"].includes(r.status) ? r.status : "sent",
      ...(r.status === "released" ? { result: { score: r.result?.score ?? null, level: r.result?.level || "" }, note: r.note } : {}),
    })),
  });
});

// GET /assessment-requests/:id/take — client: the test to answer
export const takeRequest = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid link." });
  const r = await AssessmentRequest.findOne({ _id: req.params.id, client: req.user._id }).populate("therapistUser", "name").populate("booking", "booking_date").lean();
  if (!r) return res.status(404).json({ status: false, message: "Not found." });
  res.json({ status: true, data: { _id: r._id, tool: r.tool, status: r.status, selfOnly: !!r.selfOnly, therapist: r.selfOnly ? "" : r.therapistUser?.name || "Your psychologist", booking_date: r.booking?.booking_date || null } });
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
  if (r.selfOnly) { r.status = "released"; r.releasedAt = r.doneAt; }
  r.markModified("result");
  await r.save();
  if (r.selfOnly) {
    notifyClient(r.client, { type: "completed", title: `Your ${nameOf(r.tool)} report is ready`, body: "Your automatic report is ready to view and download.", link: `/assessment-report/${r._id}`, ref: `areq-rel:${r._id}` });
    return res.json({ status: true, message: "Submitted.", data: { released: true } });
  }
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
      _id: r._id, booking: r.booking?._id || null, tool: r.tool, name: nameOf(r.tool), client: r.client?.name || "Client", booking_date: r.booking?.booking_date || null,
      status: r.status, level: r.result?.level || "", score: r.result?.score ?? null, max: r.result?.max ?? null, flag: !!r.result?.flag, note: r.note,
      doneAt: r.doneAt, releasedAt: r.releasedAt,
    })),
  });
});

const cleanNotes = (n) => {
  const t = (v, max) => String(v || "").trim().slice(0, max);
  return { observations: t(n?.observations, 1500), recommendations: t(n?.recommendations, 1500), followUp: t(n?.followUp, 200), referral: t(n?.referral, 300) };
};
const codeOf = (id, prefix) => `${prefix}-${String(id).slice(-6).toUpperCase()}`;

// GET /assessment-requests/:id/report — the therapist who owns it, or the client once released
export const reportRequest = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid link." });
  const r = await AssessmentRequest.findById(req.params.id).populate("client", "name age gender").populate("therapistUser", "name").populate("therapist", "profile_type").populate("booking", "booking_date").lean();
  const me = String(req.user._id);
  const isTherapist = r && String(r.therapistUser?._id) === me;
  const isClient = r && String(r.client?._id) === me && r.status === "released";
  if (!isTherapist && !isClient) return res.status(404).json({ status: false, message: "Report not available." });
  if (r.status === "sent") return res.status(400).json({ status: false, message: "The client hasn't completed it yet." });
  // earlier results of the same test for this client (progress)
  const earlier = await AssessmentRequest.find({ client: r.client?._id, tool: r.tool, _id: { $ne: r._id }, status: { $in: isTherapist ? ["done", "released"] : ["released"] }, doneAt: { $lt: r.doneAt } })
    .sort({ doneAt: -1 }).limit(5).select("doneAt result.score result.level").lean();
  const addon = isTherapist ? await TherapistAddon.findOne({ user: r.therapistUser._id }).select("regNo signature verified verifiedAt noRegNo credential").lean() : null;
  const signer = r.selfOnly ? null : r.signedBy || signerOf(r.therapistUser?.name, r.therapist?.profile_type, addon);
  res.json({
    status: true,
    data: {
      _id: r._id, reportNo: codeOf(r._id, "CYT-AR"), tool: r.tool, status: r.status, viewer: isTherapist ? "therapist" : "client", selfOnly: !!r.selfOnly,
      client: { name: r.client?.name || "Client", age: r.client?.age || null, gender: r.client?.gender || "", code: codeOf(r.client?._id, "CL") },
      therapist: r.therapistUser?.name || "", signer, regNo: isTherapist ? addon?.regNo || "" : undefined,
      booking_date: r.booking?.booking_date || null,
      answers: r.answers || [], result: r.result, note: r.note, notes: r.notes || null, sentAt: r.sentAt, doneAt: r.doneAt, releasedAt: r.releasedAt,
      verifyUrl: r.status === "released" ? verifyUrl(r._id) : "",
      verifyQr: r.status === "released" ? await QRCode.toDataURL(verifyUrl(r._id), { margin: 1, width: 180, errorCorrectionLevel: "M" }).catch(() => "") : "",
      earlier: earlier.map((e) => ({ doneAt: e.doneAt, score: e.result?.score ?? null, level: e.result?.level || "" })),
    },
  });
});

// the psychologist block printed on a report: only details CYT approved (Assessments add-on) are
// printed as verified; the signature prints only once approved. Frozen into signedBy on release.
function signerOf(name, profileType, addon) {
  const ok = !!addon?.verified;
  return {
    name: name || "", profileType: profileType || "Psychologist",
    credential: addon?.credential || "", regNo: addon?.noRegNo ? "" : addon?.regNo || "", noRegNo: !!addon?.noRegNo,
    signature: ok ? addon?.signature || "" : "", verified: ok, verifiedAt: ok ? addon?.verifiedAt || null : null,
  };
}

// POST /assessment-requests/:id/notes { note, notes, release? } — therapist: save notes (and release)
export const releaseRequest = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid request." });
  const r = await AssessmentRequest.findOne({ _id: req.params.id, therapistUser: req.user._id }).populate("therapist", "profile_type");
  if (!r) return res.status(404).json({ status: false, message: "Not found." });
  if (r.status === "sent") return res.status(400).json({ status: false, message: "The client hasn't completed it yet." });
  const b = req.body || {};
  if (b.note != null) r.note = String(b.note).trim().slice(0, 1000);
  if (b.notes) { r.notes = cleanNotes(b.notes); r.markModified("notes"); }
  const release = b.release !== false;
  const first = release && r.status !== "released";
  if (release) {
    const addon = await TherapistAddon.findOne({ user: req.user._id }).select("regNo signature verified verifiedAt noRegNo credential").lean();
    r.signedBy = signerOf(req.user.name, r.therapist?.profile_type, addon);
    r.markModified("signedBy");
    r.status = "released"; if (first) r.releasedAt = new Date();
  }
  await r.save();
  if (first) {
    notifyClient(r.client, {
      type: "completed", title: `Your ${nameOf(r.tool)} report is ready`,
      body: `${req.user.name || "Your psychologist"} has shared your result and notes.`, link: `/assessment-report/${r._id}`, ref: `areq-rel:${r._id}`,
    });
  }
  res.json({ status: true, message: !release ? "Draft saved — not visible to the client yet." : first ? "Released — your client can now see the report." : "Report updated." });
});

// GET /assessment-verify/:id — public: confirms a released report is genuine (from the QR on it).
// Shows only what is needed to check it — never the answers, and the client by initials.
export const verifyReport = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ status: false, message: "No report found for this code." });
  const r = await AssessmentRequest.findById(req.params.id).populate("client", "name").populate("therapistUser", "name").lean();
  if (!r || r.status !== "released") return res.status(404).json({ status: false, message: "No released report found for this code." });
  const sb = r.signedBy || {};
  res.json({
    status: true,
    data: {
      reportNo: `CYT-AR-${String(r._id).slice(-6).toUpperCase()}`, test: nameOf(r.tool), tool: r.tool,
      client: initialsOf(r.client?.name), completedAt: r.doneAt, releasedAt: r.releasedAt,
      level: r.result?.level || "", score: r.result?.score ?? null, max: r.result?.max ?? null,
      selfOnly: !!r.selfOnly,
      psychologist: r.selfOnly ? null : { name: sb.name || r.therapistUser?.name || "", profileType: sb.profileType || "", regNo: sb.regNo || "", noRegNo: !!sb.noRegNo, credential: sb.credential || "", verified: !!sb.verified, verifiedAt: sb.verifiedAt || null },
    },
  });
});

// ── an assessment on its own (no session) ─────────────────────────────────────────────────────
export const selfPaymentSource = {
  createOrder: (o) => razorpayClient().orders.create(o),
  fetchPayment: (id) => razorpayClient().payments.fetch(id),
};
async function createSelfRequest(user, tool, { amount = 0, paymentId = "" } = {}) {
  return AssessmentRequest.create({ client: user, tool, selfOnly: true, status: "sent", sentAt: new Date(), amount, paymentId });
}

// POST /assessment-self/order { tool } — client: pay for one assessment (priced here, in the admin panel)
export const createSelfOrder = expressAsyncHandler(async (req, res) => {
  const tool = String(req.body?.tool || "");
  if (!TEST_BY_KEY[tool]) return res.status(400).json({ status: false, message: "Unknown assessment." });
  const p = (await getPricing()).tests?.[tool];
  if (!p || p.active === false) return res.status(400).json({ status: false, message: "This assessment can't be booked right now." });
  if (Number(p.price) === 0) {
    const r = await createSelfRequest(req.user._id, tool);
    return res.json({ status: true, data: { free: true, requestId: r._id } });
  }
  try {
    const order = await selfPaymentSource.createOrder({
      amount: Math.round(p.price * 100), currency: "INR",
      receipt: `asmt_${String(req.user._id).slice(-10)}_${Date.now().toString(36)}`,
      notes: { purpose: "assessment_only", tool },
    });
    await AssessmentOrder.create({ orderId: order.id, user: req.user._id, tool, amount: p.price });
    res.json({ status: true, data: { orderId: order.id, amount: p.price, keyId: process.env.RAZORPAY_KEY_ID, name: nameOf(tool) } });
  } catch (e) {
    console.error("[assessment-self] order failed:", e?.error?.description || e.message);
    res.status(502).json({ status: false, message: "Couldn't start the payment right now. Please try again in a minute." });
  }
});

// POST /assessment-self/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature } → { requestId }
export const verifySelfPayment = expressAsyncHandler(async (req, res) => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = req.body || {};
  if (!orderId || !paymentId || !sig) return res.status(400).json({ status: false, message: "Missing payment details." });
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  if (expected !== sig) return res.status(400).json({ status: false, message: "Invalid payment signature." });
  const order = await AssessmentOrder.findOne({ orderId, user: req.user._id });
  if (!order) return res.status(404).json({ status: false, message: "Order not found." });
  if (order.status === "paid" && order.request) return res.json({ status: true, data: { requestId: order.request } });
  let p;
  try { p = await selfPaymentSource.fetchPayment(paymentId); } catch (e) {
    return res.status(502).json({ status: false, message: "We couldn't confirm your payment just now. Please try again in a minute — your money is safe." });
  }
  const ok = p && p.order_id === orderId && ["captured", "authorized"].includes(p.status) && (p.currency || "INR") === "INR" && Number(p.amount) === Math.round(order.amount * 100);
  if (!ok) return res.status(400).json({ status: false, message: "This payment doesn't match the assessment fee. Please contact hello@chooseyourtherapist.in with your payment ID." });
  // only the request that flips pending → paid creates the assessment
  const claimed = await AssessmentOrder.findOneAndUpdate({ _id: order._id, status: "pending" }, { $set: { status: "paid", paymentId } }, { new: true });
  if (!claimed) {
    const again = await AssessmentOrder.findById(order._id).lean();
    return res.json({ status: true, data: { requestId: again?.request || null } });
  }
  const r = await createSelfRequest(req.user._id, order.tool, { amount: order.amount, paymentId });
  await AssessmentOrder.updateOne({ _id: order._id }, { $set: { request: r._id } });
  res.json({ status: true, data: { requestId: r._id } });
});
