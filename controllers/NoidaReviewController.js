import crypto from "crypto";
import mongoose from "mongoose";
import expressAsyncHandler from "express-async-handler";
import NoidaAppointment from "../models/NoidaAppointment.js";
import NoidaReview from "../models/NoidaReview.js";
import { sendMail } from "../helper/mailer.js";
import { noidaReviewRequestEmail } from "../services/mailTemplates.js";

// Reviews of sessions at CYT Noida: asked for after a session is marked "Done", written on the
// public /noida-review/<token> page, and shown on /noida-appointment once an admin approves them.

const SITE = "https://www.chooseyourtherapist.in";
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "there";
// "Riya Sharma" -> "Riya S." (or "Verified client" when they'd rather not be named)
const publicName = (r) => {
  if (!r.showName) return "Verified client";
  const parts = String(r.name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Verified client";
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
};

// The review link for a booking, creating its token the first time.
export async function reviewLinkFor(appointment) {
  let token = appointment.reviewToken;
  if (!token) {
    token = crypto.randomBytes(16).toString("hex");
    await NoidaAppointment.updateOne({ _id: appointment._id, reviewToken: { $in: [null, ""] } }, { $set: { reviewToken: token } });
    const fresh = await NoidaAppointment.findById(appointment._id).select("reviewToken").lean();
    token = fresh?.reviewToken || token;
  }
  return `${SITE}/noida-review/${token}`;
}

// Called when the desk marks a session "Done": emails the review link once per booking.
export async function requestReviewByEmail(appointment) {
  try {
    if (!appointment?.email?.trim() || appointment.reviewRequestedAt) return;
    const claimed = await NoidaAppointment.findOneAndUpdate(
      { _id: appointment._id, reviewRequestedAt: null },
      { $set: { reviewRequestedAt: new Date() } },
      { new: true }
    );
    if (!claimed) return; // already sent from another request
    const link = await reviewLinkFor(claimed);
    await sendMail(
      claimed.email.trim(),
      "How was your session at CYT Noida?",
      `Hi ${firstName(claimed.name)}, how was your session? It takes a minute: ${link}`,
      noidaReviewRequestEmail({ name: claimed.name, date: claimed.date, therapistName: claimed.therapistName, link })
    );
  } catch (err) {
    console.error("Review request email failed (non-fatal):", err.message);
  }
}

// POST /noida-appointments/:id/review-link — admin: the link to send on WhatsApp
export const getReviewLink = expressAsyncHandler(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) { res.status(400); return next(new Error("Invalid booking.")); }
  const appt = await NoidaAppointment.findById(req.params.id).select("name phone reviewToken status").lean();
  if (!appt) { res.status(404); return next(new Error("Booking not found.")); }
  const link = await reviewLinkFor(appt);
  const reviewed = await NoidaReview.exists({ appointment: appt._id });
  res.json({ status: true, data: { link, firstName: firstName(appt.name), phone: appt.phone, reviewed: !!reviewed } });
});

// GET /noida-reviews/form/:token — public: who the form is for
export const getReviewForm = expressAsyncHandler(async (req, res, next) => {
  const token = String(req.params.token || "");
  if (!/^[a-f0-9]{32}$/.test(token)) { res.status(404); return next(new Error("This review link isn't valid.")); }
  const appt = await NoidaAppointment.findOne({ reviewToken: token }).select("name date slot therapistName").lean();
  if (!appt) { res.status(404); return next(new Error("This review link isn't valid.")); }
  const done = await NoidaReview.exists({ appointment: appt._id });
  res.json({ status: true, data: { firstName: firstName(appt.name), date: appt.date, slot: appt.slot, therapistName: appt.therapistName || "", done: !!done } });
});

// POST /noida-reviews/form/:token  { rating, text, showName } — public: one review per booking
export const submitReview = expressAsyncHandler(async (req, res, next) => {
  const token = String(req.params.token || "");
  if (!/^[a-f0-9]{32}$/.test(token)) { res.status(404); return next(new Error("This review link isn't valid.")); }
  const appt = await NoidaAppointment.findOne({ reviewToken: token }).select("name phone date therapistName").lean();
  if (!appt) { res.status(404); return next(new Error("This review link isn't valid.")); }
  const rating = Math.round(Number(req.body?.rating));
  if (!(rating >= 1 && rating <= 5)) { res.status(400); return next(new Error("Please choose a rating from 1 to 5 stars.")); }
  const text = String(req.body?.text || "").trim().slice(0, 1500);
  try {
    await NoidaReview.create({
      appointment: appt._id, name: appt.name, phone: appt.phone, rating, text,
      showName: req.body?.showName !== false, therapistName: appt.therapistName || "", sessionDate: appt.date,
    });
  } catch (err) {
    if (err?.code === 11000) { res.status(409); return next(new Error("You've already shared a review for this session — thank you!")); }
    throw err;
  }
  res.json({ status: true, message: "Thank you for your review!" });
});

// GET /noida-reviews — public: approved reviews for the booking page
export const getPublicReviews = expressAsyncHandler(async (req, res) => {
  const [list, agg] = await Promise.all([
    NoidaReview.find({ status: "approved" }).sort({ createdAt: -1 }).limit(30).select("name showName rating text therapistName createdAt").lean(),
    NoidaReview.aggregate([{ $match: { status: "approved" } }, { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } }]),
  ]);
  res.json({
    status: true,
    data: {
      summary: { average: agg[0] ? Math.round(agg[0].avg * 10) / 10 : 0, count: agg[0]?.count || 0 },
      reviews: list.map((r) => ({ id: r._id, name: publicName(r), rating: r.rating, text: r.text, therapistName: r.therapistName, date: r.createdAt })),
    },
  });
});

// GET /noida-reviews/admin?status=pending|approved|hidden|all — admin
export const getAdminReviews = expressAsyncHandler(async (req, res) => {
  const status = ["pending", "approved", "hidden"].includes(req.query.status) ? req.query.status : null;
  const [list, pending] = await Promise.all([
    NoidaReview.find(status ? { status } : {}).sort({ createdAt: -1 }).limit(200).lean(),
    NoidaReview.countDocuments({ status: "pending" }),
  ]);
  res.json({
    status: true,
    pending,
    data: list.map((r) => ({
      id: r._id, name: r.name, publicName: publicName(r), phone: r.phone, rating: r.rating, text: r.text, showName: r.showName,
      therapistName: r.therapistName, sessionDate: r.sessionDate, status: r.status, decidedBy: r.decidedBy, decidedAt: r.decidedAt, createdAt: r.createdAt,
    })),
  });
});

// PATCH /noida-reviews/:id  { status: "approved" | "hidden" | "pending" } — admin
export const decideReview = expressAsyncHandler(async (req, res, next) => {
  const { status } = req.body || {};
  if (!["approved", "hidden", "pending"].includes(status)) { res.status(400); return next(new Error("Approve or hide the review.")); }
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) { res.status(404); return next(new Error("Review not found.")); }
  const r = await NoidaReview.findByIdAndUpdate(req.params.id, { status, decidedBy: req.user?.name || "", decidedAt: new Date() }, { new: true });
  if (!r) { res.status(404); return next(new Error("Review not found.")); }
  res.json({ status: true, data: { id: r._id, status: r.status } });
});
