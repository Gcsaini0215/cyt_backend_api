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
import CycleProfile from "../models/CycleProfile.js";
import CycleLog from "../models/CycleLog.js";
import MoodEntry from "../models/MoodEntry.js";
import { onlineClientIds, onlineInfo } from "./ClientPresenceController.js";
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

/* GET /api/admin/client-360?q=&page=1&limit=20&filter=all|live|booked|cycle|new — clients with their totals */
export const listClients = expressAsyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(5, parseInt(req.query.limit, 10) || 20));
  const q = String(req.query.q || "").trim().slice(0, 80);
  const filter = { role: 0 };
  const which = String(req.query.filter || "all");
  if (which === "live") filter._id = { $in: [...onlineClientIds()].filter((x) => mongoose.Types.ObjectId.isValid(x)).map((x) => new mongoose.Types.ObjectId(x)) };
  else if (which === "booked") filter._id = { $in: await Booking.distinct("client") };
  else if (which === "cycle") filter._id = { $in: await CycleProfile.distinct("user", { $or: [{ enabled: true }, { consentAt: { $ne: null } }] }) };
  else if (which === "new") filter.createdAt = { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) };
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
  const [bk, ar, ao, wb, cy] = await Promise.all([
    Booking.aggregate([
      { $match: { client: { $in: ids }, source: { $ne: "noida" } } }, // Noida mirrors are counted with the Noida visits below
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
    CycleProfile.find({ user: { $in: ids } }, { user: 1, enabled: 1, dismissed: 1, consentAt: 1 }).lean(),
  ]);
  const CY = new Map(cy.map((x) => [String(x.user), x.enabled ? "on" : x.dismissed ? "not-for-me" : x.consentAt ? "off" : "started"]));
  // Noida centre payments, matched by phone (last 10 digits) or email
  const phones = users.map((u) => last10(u.phone)).filter((x) => x.length === 10);
  const emails = users.map((u) => String(u.email || "").toLowerCase()).filter(Boolean);
  const noidaPaid = phones.length || emails.length
    ? await NoidaAppointment.find({ paymentStatus: "paid", $or: [...(phones.length ? [{ phone: { $in: phones.flatMap((x) => [x, `+91${x}`, `91${x}`, `+91 ${x}`]) } }] : []), ...(emails.length ? [{ email: { $in: emails } }] : [])] }, { phone: 1, email: 1, amount: 1, date: 1 }).lean()
    : [];
  const noidaBy = new Map();
  for (const u of users) {
    const ph = last10(u.phone); const em = String(u.email || "").toLowerCase();
    const mine = noidaPaid.filter((n) => (ph.length === 10 && last10(n.phone) === ph) || (em && String(n.email || "").toLowerCase() === em));
    if (mine.length) noidaBy.set(String(u._id), { spent: mine.reduce((x, n) => x + (n.amount || 0), 0), n: mine.length, last: mine.map((n) => n.date).sort().pop() });
  }
  const m = (arr) => new Map(arr.map((x) => [String(x._id), x]));
  const B = m(bk); const A = m(ar); const O = m(ao); const W = m(wb);
  const data = users.map((u) => {
    const id = String(u._id);
    const b = B.get(id) || {}; const a = A.get(id) || {}; const o = O.get(id) || {}; const w = W.get(id) || {}; const nd = noidaBy.get(id) || {};
    const last = [b.last, a.last, u.last_visit, nd.last].filter(Boolean).map((d) => new Date(d)).sort((x, y) => y - x)[0] || null;
    return {
      _id: id, name: u.name, email: u.email, phone: u.phone, photo: u.profile || "", joined: u.createdAt, verified: !!u.is_verified,
      sessions: b.sessions || 0, completed: b.completed || 0, upcoming: b.upcoming || 0, assessments: a.n || 0, workshops: w.n || 0,
      noida: nd.n || 0, spent: Math.round((b.spent || 0) + (o.spent || 0) + (w.spent || 0) + (nd.spent || 0)), lastActivity: last,
      lastVisit: u.last_visit || null, online: !!onlineInfo(id), cycle: CY.get(id) || "",
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

  const [bookings, requests, selfResults, orders, workshops, referred, referredBy, reviews, favourites, noida, cycleProfile, cycleLogs, moods] = await Promise.all([
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
    CycleProfile.findOne({ user: uid }, { enabled: 1, dismissed: 1, menstruates: 1, consentAt: 1, createdAt: 1, updatedAt: 1 }).lean(),
    // only WHEN the client used the tracker — never what they logged (flow, symptoms, notes stay private to them)
    CycleLog.find({ user: uid }, { day: 1, createdAt: 1, updatedAt: 1 }).sort({ updatedAt: -1 }).limit(400).lean(),
    MoodEntry.find({ user: uid }, { day: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(400).lean(),
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
      // admin moved it to another therapist (Replace therapist) — and whether it can still be moved
      reassignments: (b.reassignments || []).map((r) => ({ fromName: r.fromName, toName: r.toName, reason: r.reason, by: r.by, at: r.at })),
      canReassign: !["Cancelled", "Completed", "Started"].includes(b.status) && !b.session_started_at && !b.session_completed_at && !b.payout_id,
      source: b.source || "",
      // a Noida centre appointment's mirror booking: ₹0 here, the client paid CYT at the Noida booking
      noida: b.source === "noida", noidaAmount: b.noida_amount || 0, noidaPaidVia: b.noida_paid_via || "",
    };
  });
  // every therapist change on this client's sessions, newest first (Client 360 history)
  const therapistChanges = sessions
    .flatMap((x) => x.reassignments.map((r) => ({ ...r, sessionId: x._id, sessionDate: x.date, service: x.service })))
    .sort((a, b) => new Date(b.at) - new Date(a.at));
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
    if (s.noida) continue; // paid at the Noida booking — that payment is listed once, under "Noida centre"
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

  /* Cycle & Mood Care — usage only. The client was promised CYT staff can't see their cycle, symptoms or
     notes, so admin gets the status and when they used it, nothing they entered. */
  const cp = cycleProfile;
  const cycle = {
    status: !cp ? "never" : cp.enabled ? "on" : cp.dismissed ? "not-for-me" : cp.consentAt ? "off" : "started",
    firstOpened: cp?.createdAt || null, turnedOnAt: cp?.consentAt || null, updatedAt: cp?.updatedAt || null,
    daysLogged: cycleLogs.length, lastLog: cycleLogs[0]?.updatedAt || null,
    loggedLast30: cycleLogs.filter((l) => Date.now() - new Date(l.updatedAt) < 30 * 864e5).length,
    moodCheckins: moods.length, lastMood: moods[0]?.createdAt || null,
    moodLast30: moods.filter((m) => Date.now() - new Date(m.createdAt) < 30 * 864e5).length,
  };

  // one timeline of what the client did, newest first
  const oidAt = (id) => { try { return new mongoose.Types.ObjectId(String(id)).getTimestamp(); } catch (e) { return null; } };
  const ev = [];
  const add = (at, kind, text, sub = "") => { if (at) ev.push({ at: new Date(at), kind, text, sub }); };
  add(user.createdAt, "account", "Created an account");
  for (const s of sessions) {
    if (!s.noida) add(oidAt(s._id), "session", `Booked a session with ${s.therapist?.name || "a therapist"}`, `for ${s.date ? new Date(s.date).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—"}${s.payment ? ` · ${s.payment}` : ""}`);
    if (s.completedAt) add(s.completedAt, "session", `Completed a session with ${s.therapist?.name || "therapist"}`);
    if (s.state === "cancelled") add(s.date, "cancel", `Session with ${s.therapist?.name || "therapist"} cancelled`);
  }
  for (const a of assessments) {
    add(a.sentAt, "assessment", a.selfOnly ? `Bought ${a.short}` : `${a.short} sent by ${a.by || "therapist"}`);
    if (a.doneAt) add(a.doneAt, "assessment", `Completed ${a.short}`);
    if (a.releasedAt) add(a.releasedAt, "assessment", `${a.short} report released`);
  }
  for (const r of freeTools) add(r.at, "tool", `Took the free ${r.name}`, r.level || "");
  for (const p of payments) if (p.status === "paid" && p.kind !== "Session") add(p.date, "payment", `Paid ${"\u20b9"}${Math.round(p.amount || 0).toLocaleString("en-IN")}`, `${p.kind} · ${p.title}`);
  for (const n of noida) add(n.createdAt || n.date, "noida", "Noida centre visit booked", `${n.date} ${n.slot || ""}${n.therapistName ? ` · ${n.therapistName}` : ""}`);
  for (const w of workshops) add(w.createdAt, "workshop", `Registered for ${w.workshop?.name || w.workshop?.title || "a workshop"}`);
  for (const r of reviews) add(r.createdAt, "review", `Reviewed ${r.therapist_id?.user?.name || "a therapist"} ${"\u2605".repeat(Math.round(r.rating || 0))}`);
  for (const r of referred) add(r.createdAt, "referral", `Referred ${r.friend?.name || "a friend"}`);
  if (cp) {
    add(cp.createdAt, "cycle", "Opened Cycle & Mood Care");
    if (cp.consentAt) add(cp.consentAt, "cycle", "Turned on Cycle & Mood Care", "Agreed to the privacy terms");
    if (cp.dismissed) add(cp.updatedAt, "cycle", "Said Cycle & Mood Care is not for them");
  }
  // cycle logs and mood check-ins: one line per day (not 30 separate rows)
  const perDay = new Map();
  for (const l of cycleLogs) { const k = l.day; const x = perDay.get(k) || { at: l.updatedAt, cyc: 0, mood: 0 }; x.cyc++; if (l.updatedAt > x.at) x.at = l.updatedAt; perDay.set(k, x); }
  for (const m of moods) { const k = m.day; const x = perDay.get(k) || { at: m.createdAt, cyc: 0, mood: 0 }; x.mood++; if (m.createdAt > x.at) x.at = m.createdAt; perDay.set(k, x); }
  for (const x of perDay.values()) add(x.at, x.cyc ? "cycle" : "mood", x.cyc && x.mood ? "Logged cycle day + mood check-in" : x.cyc ? "Logged a cycle day" : "Mood check-in", "Cycle & Mood Care · details private");
  const live = onlineInfo(uid);
  ev.sort((a, b) => b.at - a.at);
  const activity = ev.slice(0, 300);

  const paidTotal = payments.filter((p) => p.status === "paid").reduce((s, p) => s + (p.amount || 0), 0);

  res.json({
    status: true,
    data: {
      profile: {
        _id: String(uid), name: user.name, email: user.email, phone: user.phone, photo: user.profile || "", gender: user.gender || "", dob: user.dob || "", age: user.age || "",
        joined: user.createdAt, lastVisit: user.last_visit || null, verified: !!user.is_verified,
        online: live ? { since: new Date(live.since), path: live.path, device: live.device, app: live.app } : null, referralCode: user.referral_code || "", referralCredit: user.referral_credit || 0,
      },
      totals: {
        sessions: sessions.length, completed: sessions.filter((s) => s.state === "completed").length, upcoming: sessions.filter((s) => s.state === "upcoming").length,
        cancelled: sessions.filter((s) => s.state === "cancelled").length, assessments: assessments.length + freeTools.length, workshops: workshops.length,
        noida: noida.length, paid: Math.round(paidTotal), therapists: new Set(sessions.map((s) => s.therapist?.id).filter(Boolean)).size,
      },
      sessions, therapistChanges, assessments, freeTools, payments, cycle, activity,
      workshops: workshops.map((w) => ({ _id: String(w._id), name: w.workshop?.name || w.workshop?.title || "Workshop", date: w.workshop?.date || w.createdAt, amount: num(w.transaction?.amount ?? w.amount), paid: !!w.is_payment_success, student: !!w.is_student })),
      noida: noida.map((n) => ({ _id: String(n._id), code: n.clientCode || "", date: n.date, slot: n.slot, therapist: n.therapistName || "", type: n.type, mode: n.sessionMode, format: n.format, status: n.status, attendance: n.attendance || "", amount: n.amount || 0, payment: n.paymentStatus, package: n.packageName || "" })),
      referrals: { code: user.referral_code || "", credit: user.referral_credit || 0, friends: referred.map((r) => ({ name: r.friend?.name || "", email: r.friend?.email || "", amount: r.amount || 0, at: r.createdAt })), by: referredBy ? { name: referredBy.referrer?.name || "", email: referredBy.referrer?.email || "", at: referredBy.createdAt } : null },
      reviews: reviews.map((r) => ({ _id: String(r._id), therapist: r.therapist_id?.user?.name || "", rating: r.rating, text: r.description || "", at: r.createdAt })),
      favourites: favourites.map((f) => therapistOf(f.therapist)).filter(Boolean),
    },
  });
});
