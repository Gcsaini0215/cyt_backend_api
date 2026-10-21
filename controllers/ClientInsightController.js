import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import User from "../models/Users.js";
import Booking from "../models/Booking.js";
import AssessmentRequest, { AssessmentOrder } from "../models/AssessmentRequest.js";
import AssessmentResult from "../models/AssessmentResult.js";
import WorkshopBooking from "../models/WorkshopBooking.js";
import Referral from "../models/Referral.js";
import Review from "../models/Review.js";
import FavoriteTherapist from "../models/FavriouteTherapist.js";
import NoidaAppointment from "../models/NoidaAppointment.js";
import "../models/Therapists.js";
import "../models/Transaction.js";
import "../models/PaymentStatus.js";
import "../models/Workshop.js";
import { TEST_BY_KEY } from "../helper/assessmentTests.js";

/* Admin → Client 360: one place to see everything a website client has done — sessions (when, with whom,
   paid or not), assessments (which one, result, report, payment), workshops, Noida centre visits,
   referrals, reviews and favourites — plus every payment in one list. Read-only. */

const num = (v) => {
  if (v == null) return 0;
  if (typeof v === "object" && v.$numberDecimal != null) return Number(v.$numberDecimal) || 0;
  return Number(String(v)) || 0;
};
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const testName = (k) => TEST_BY_KEY[k]?.full || TEST_BY_KEY[k]?.title || k;
const testShort = (k) => TEST_BY_KEY[k]?.short || k;
const THERAPIST = { path: "therapist", select: "user profile_type", populate: { path: "user", select: "name profile" } };
const therapistOf = (t) => (t ? { id: String(t._id), name: t.user?.name || "Therapist", photo: t.user?.profile || "", type: t.profile_type || "" } : null);

/* GET /api/admin/client-360?q=&page=1&limit=20 — clients with their totals */
export const listClients = expressAsyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(5, parseInt(req.query.limit, 10) || 20));
  const q = String(req.query.q || "").trim().slice(0, 80);
  const filter = { role: 0 };
  if (q) {
    const rx = new RegExp(esc(q), "i");
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter, { name: 1, email: 1, phone: 1, profile: 1, createdAt: 1, last_visit: 1, is_verified: 1 })
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  const ids = users.map((u) => u._id);
  const now = new Date();
  const [bk, ar, ao, wb] = await Promise.all([
    Booking.aggregate([
      { $match: { client: { $in: ids } } },
      { $group: {
        _id: "$client",
        sessions: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] } },
        upcoming: { $sum: { $cond: [{ $and: [{ $gt: ["$booking_date", now] }, { $ne: ["$status", "Cancelled"] }] }, 1, 0] } },
        spent: { $sum: { $cond: [{ $eq: ["$payment_status", "Paid"] }, { $toDouble: { $ifNull: ["$amount", 0] } }, 0] } },
        last: { $max: "$booking_date" },
      } },
    ]),
    AssessmentRequest.aggregate([{ $match: { client: { $in: ids } } }, { $group: { _id: "$client", n: { $sum: 1 }, last: { $max: "$createdAt" } } }]),
    AssessmentOrder.aggregate([{ $match: { user: { $in: ids }, status: "paid" } }, { $group: { _id: "$user", spent: { $sum: "$amount" } } }]),
    WorkshopBooking.aggregate([{ $match: { user: { $in: ids }, is_payment_success: true } }, { $group: { _id: "$user", n: { $sum: 1 }, spent: { $sum: { $toDouble: { $ifNull: ["$amount", 0] } } } } }]),
  ]);
  const m = (arr) => new Map(arr.map((x) => [String(x._id), x]));
  const B = m(bk); const A = m(ar); const O = m(ao); const W = m(wb);
  const data = users.map((u) => {
    const id = String(u._id);
    const b = B.get(id) || {}; const a = A.get(id) || {}; const o = O.get(id) || {}; const w = W.get(id) || {};
    const last = [b.last, a.last, u.last_visit].filter(Boolean).map((d) => new Date(d)).sort((x, y) => y - x)[0] || null;
    return {
      _id: id, name: u.name, email: u.email, phone: u.phone, photo: u.profile || "", joined: u.createdAt, verified: !!u.is_verified,
      sessions: b.sessions || 0, completed: b.completed || 0, upcoming: b.upcoming || 0, assessments: a.n || 0, workshops: w.n || 0,
      spent: Math.round((b.spent || 0) + (o.spent || 0) + (w.spent || 0)), lastActivity: last,
    };
  });
  res.json({ status: true, data, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

/* GET /api/admin/client-360/:id — the whole picture for one client */
export const clientDetail = expressAsyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ status: false, message: "Invalid client" });
  const user = await User.findById(req.params.id, { otp: 0, otp_count: 0, resetToken: 0, tokenExpiration: 0 }).lean();
  if (!user) return res.status(404).json({ status: false, message: "Client not found" });
  const uid = user._id;
  const phone = last10(user.phone);
  const noidaQ = [];
  if (phone.length === 10) noidaQ.push({ phone: new RegExp(`${phone}$`) });
  if (user.email) noidaQ.push({ email: new RegExp(`^${esc(user.email)}$`, "i") });

  const [bookings, requests, selfResults, orders, workshops, referred, referredBy, reviews, favourites, noida] = await Promise.all([
    Booking.find({ client: uid }).populate(THERAPIST).populate({ path: "transaction", populate: { path: "status", select: "name" } }).sort({ booking_date: -1 }).limit(500).lean(),
    AssessmentRequest.find({ client: uid }, { answers: 0 }).populate(THERAPIST).sort({ createdAt: -1 }).limit(300).lean(),
    AssessmentResult.find({ user: uid }).sort({ createdAt: -1 }).limit(300).lean(),
    AssessmentOrder.find({ user: uid }).sort({ createdAt: -1 }).limit(300).lean(),
    WorkshopBooking.find({ user: uid }).populate({ path: "workshop", select: "name title date" }).populate({ path: "transaction", populate: { path: "status", select: "name" } }).sort({ createdAt: -1 }).limit(200).lean(),
    Referral.find({ referrer: uid }).populate({ path: "friend", select: "name email" }).sort({ createdAt: -1 }).lean(),
    Referral.findOne({ friend: uid }).populate({ path: "referrer", select: "name email" }).lean(),
    user.email ? Review.find({ email: new RegExp(`^${esc(user.email)}$`, "i") }).populate({ path: "therapist_id", select: "user", populate: { path: "user", select: "name" } }).sort({ createdAt: -1 }).lean() : [],
    FavoriteTherapist.find({ user: uid }).populate(THERAPIST).lean(),
    noidaQ.length ? NoidaAppointment.find({ $or: noidaQ }).sort({ date: -1 }).limit(300).lean() : [],
  ]);

  const now = Date.now();
  const sessions = bookings.map((b) => {
    const amount = num(b.transaction?.amount ?? b.amount);
    const when = b.booking_date ? new Date(b.booking_date) : null;
    const state = b.status === "Cancelled" ? "cancelled" : b.status === "Completed" ? "completed" : when && when.getTime() > now ? "upcoming" : b.status === "Started" ? "in-progress" : "past";
    return {
      _id: String(b._id), date: b.booking_date, therapist: therapistOf(b.therapist), service: b.service || "", format: b.format || "",
      sessionType: b.session_type || "", forWhom: b.whom || "", forName: b.cname || "", status: b.status || "", state,
      payment: b.payment_status || "", amount, paymentId: b.transaction?.transaction_id || "", paymentMethod: b.transaction?.payment_method || "",
      startedAt: b.session_started_at || null, completedAt: b.session_completed_at || null, notes: b.notes || "",
      assessments: (b.assessments || []).map((a) => ({ tool: a.tool, name: testShort(a.tool), fee: a.fee })), assessmentFee: b.assessment_fee || 0,
    };
  });
  const assessments = requests.map((r) => ({
    _id: String(r._id), tool: r.tool, name: testName(r.tool), short: testShort(r.tool), status: r.status,
    by: r.selfOnly ? "Self (bought by client)" : therapistOf(r.therapist)?.name || "", therapist: therapistOf(r.therapist), selfOnly: !!r.selfOnly,
    amount: r.amount || 0, paymentId: r.paymentId || "", booking: r.booking ? String(r.booking) : "",
    sentAt: r.sentAt || r.createdAt, doneAt: r.doneAt || null, releasedAt: r.releasedAt || null,
    result: r.result ? { score: r.result.score, max: r.result.max, level: r.result.level, flag: !!r.result.flag } : null,
    note: r.note || "", signedBy: r.signedBy || null,
  }));
  const freeTools = selfResults.map((r) => ({ _id: String(r._id), tool: r.test, name: r.title || testName(r.test), score: r.score, max: r.max, level: r.level, flag: !!r.flag, at: r.createdAt }));

  // every payment in one list
  const payments = [];
  for (const s of sessions) {
    if (s.payment || s.amount) payments.push({ kind: "Session", title: `Session with ${s.therapist?.name || "therapist"}`, date: s.date, amount: s.amount, status: s.payment === "Paid" ? "paid" : s.payment === "Payment Failed" ? "failed" : "pending", ref: s.paymentId, method: s.paymentMethod, invoice: s.payment === "Paid" ? { type: "session", id: s._id } : null });
  }
  for (const o of orders) {
    payments.push({ kind: "Assessment", title: testName(o.tool), date: o.createdAt, amount: o.amount, status: o.status === "paid" ? "paid" : "pending", ref: o.paymentId || o.orderId, method: "razorpay", invoice: o.status === "paid" ? { type: "assessment", id: String(o._id) } : null });
  }
  for (const w of workshops) {
    payments.push({ kind: "Workshop", title: w.workshop?.name || w.workshop?.title || w.program_name || "Workshop", date: w.createdAt, amount: num(w.transaction?.amount ?? w.amount), status: w.is_payment_success ? "paid" : "pending", ref: w.transaction?.transaction_id || "", method: w.transaction?.payment_method || "", invoice: w.is_payment_success ? { type: "workshop", id: String(w._id) } : null });
  }
  for (const n of noida) {
    if (n.amount || n.paymentStatus === "paid") payments.push({ kind: "Noida centre", title: `${n.packageName || "Session"} · ${n.date} ${n.slot}`, date: n.createdAt || n.date, amount: n.amount || 0, status: n.paymentStatus === "paid" ? "paid" : n.paymentStatus === "package-credit" ? "credit" : n.paymentStatus, ref: n.razorpayPaymentId || "", method: n.paymentMethod || "", invoice: n.paymentStatus === "paid" ? { type: "noida", id: String(n._id) } : null });
  }
  payments.sort((a, b) => new Date(b.date) - new Date(a.date));
  const paidTotal = payments.filter((p) => p.status === "paid").reduce((s, p) => s + (p.amount || 0), 0);

  res.json({
    status: true,
    data: {
      profile: {
        _id: String(uid), name: user.name, email: user.email, phone: user.phone, photo: user.profile || "", gender: user.gender || "", dob: user.dob || "", age: user.age || "",
        joined: user.createdAt, lastVisit: user.last_visit || null, verified: !!user.is_verified, referralCode: user.referral_code || "", referralCredit: user.referral_credit || 0,
      },
      totals: {
        sessions: sessions.length, completed: sessions.filter((s) => s.state === "completed").length, upcoming: sessions.filter((s) => s.state === "upcoming").length,
        cancelled: sessions.filter((s) => s.state === "cancelled").length, assessments: assessments.length + freeTools.length, workshops: workshops.length,
        noida: noida.length, paid: Math.round(paidTotal), therapists: new Set(sessions.map((s) => s.therapist?.id).filter(Boolean)).size,
      },
      sessions, assessments, freeTools, payments,
      workshops: workshops.map((w) => ({ _id: String(w._id), name: w.workshop?.name || w.workshop?.title || "Workshop", date: w.workshop?.date || w.createdAt, amount: num(w.transaction?.amount ?? w.amount), paid: !!w.is_payment_success, student: !!w.is_student })),
      noida: noida.map((n) => ({ _id: String(n._id), code: n.clientCode || "", date: n.date, slot: n.slot, therapist: n.therapistName || "", type: n.type, mode: n.sessionMode, format: n.format, status: n.status, attendance: n.attendance || "", amount: n.amount || 0, payment: n.paymentStatus, package: n.packageName || "" })),
      referrals: { code: user.referral_code || "", credit: user.referral_credit || 0, friends: referred.map((r) => ({ name: r.friend?.name || "", email: r.friend?.email || "", amount: r.amount || 0, at: r.createdAt })), by: referredBy ? { name: referredBy.referrer?.name || "", email: referredBy.referrer?.email || "", at: referredBy.createdAt } : null },
      reviews: reviews.map((r) => ({ _id: String(r._id), therapist: r.therapist_id?.user?.name || "", rating: r.rating, text: r.description || "", at: r.createdAt })),
      favourites: favourites.map((f) => therapistOf(f.therapist)).filter(Boolean),
    },
  });
});
