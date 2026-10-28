import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Users from "../models/Users.js";
import Therapists from "../models/Therapists.js";
import Lead from "../models/Lead.js";
import Review from "../models/Review.js";
import SessionBundle from "../models/SessionBundle.js";
import NoidaLastMinuteRequest from "../models/NoidaLastMinuteRequest.js";
import AssessmentRequest from "../models/AssessmentRequest.js";
import TherapistPayout from "../models/TherapistPayout.js";
import Trainee from "../models/Trainee.js";
import TraineeAccount from "../models/TraineeAccount.js";
import CollabApplication from "../models/CollabApplication.js";
import TherapistActionRequest from "../models/TherapistActionRequest.js";
import Role from "../models/Role.js";

/* GET /api/admin/todo — everything waiting on the team, in one list for the admin Home / To-do page:
   [{ key, n, label, hint, to, tone, amount? }]. The page shows each item only to admins who can open its
   page (`to`); payout money only to the super admin. Counts only — nothing heavy is loaded. */
const DAY = 86400000;
const idAt = (ms) => mongoose.Types.ObjectId.createFromTime(Math.floor(ms / 1000));
const safe = (p) => p.catch(() => 0);

export const adminTodo = expressAsyncHandler(async (req, res) => {
  const now = Date.now();
  const isSuper = !req.user?.roleId;
  const [
    therapistsPending, leadsNew, leadsToday, reviewsWeek, lastMinute, assessReview, payouts, internPending,
    traineeWaiting, collabNew, therapistReqs, unpaid, missed, packsEnding,
  ] = await Promise.all([
    // signed-up therapists not approved yet
    safe(Therapists.aggregate([
      { $lookup: { from: Users.collection.name, localField: "user", foreignField: "_id", as: "u" } },
      { $match: { "u.0": { $exists: true }, "u.is_verified": { $ne: 1 } } }, { $count: "n" },
    ]).then((r) => r[0]?.n || 0)),
    safe(Lead.countDocuments({ status: "new" })),
    safe(Lead.countDocuments({ status: "new", created_at: { $gte: new Date(now - DAY) } })), // Lead keeps created_at (no timestamps)
    safe(Review.countDocuments({ createdAt: { $gte: new Date(now - 7 * DAY) } })),
    safe(NoidaLastMinuteRequest.countDocuments({ status: "pending" })),
    safe(AssessmentRequest.countDocuments({ status: "done" })),
    TherapistPayout.aggregate([{ $match: { status: "pending" } }, { $group: { _id: null, n: { $sum: 1 }, t: { $sum: { $toDouble: { $ifNull: ["$amount", 0] } } } } }]).then((r) => r[0] || { n: 0, t: 0 }).catch(() => ({ n: 0, t: 0 })),
    safe(Trainee.countDocuments({ status: "pending" })),
    safe(TraineeAccount.countDocuments({ approval: "pending", verified: true })),
    safe(CollabApplication.countDocuments({ status: "new" })),
    safe(TherapistActionRequest.countDocuments({ status: "open" })),
    // a client left at the payment step in the last 2 days, for a session still ahead
    safe(Booking.countDocuments({ payment_status: "Pending Payment", status: { $ne: "Cancelled" }, booking_date: { $gt: new Date(now) }, _id: { $gte: idAt(now - 2 * DAY) } })),
    // paid sessions whose time passed in the last week but were never started or ended
    safe(Booking.countDocuments({ status: "New", payment_status: "Paid", source: { $ne: "noida" }, booking_date: { $gte: new Date(now - 7 * DAY), $lt: new Date(now - 90 * 60000) } })),
    // session packs with sessions left that end within a week
    safe(SessionBundle.countDocuments({ status: "active", expires_at: { $gt: new Date(now), $lte: new Date(now + 7 * DAY) }, $expr: { $lt: ["$used", "$size"] } })),
  ]);

  const items = [
    lastMinute > 0 && { key: "lastMinute", n: lastMinute, label: "Last-minute Noida requests", hint: "Answer within 10 minutes", to: "/noida-appointments?view=lastMinute", tone: "red" },
    therapistsPending > 0 && { key: "therapists", n: therapistsPending, label: "Therapists to verify", hint: "New sign-ups waiting for approval", to: "/therapists", tone: "amber" },
    isSuper && payouts.n > 0 && { key: "payouts", n: payouts.n, label: "Payouts to send", hint: `₹${Math.round(payouts.t).toLocaleString("en-IN")} due to therapists`, to: "/therapist-payouts", tone: "amber", amount: Math.round(payouts.t) },
    leadsNew > 0 && { key: "leads", n: leadsNew, label: "Leads not contacted", hint: leadsToday ? `${leadsToday} came in today` : "Call or message them", to: "/leads", tone: leadsToday ? "red" : "amber" },
    missed > 0 && { key: "missed", n: missed, label: "Sessions not marked done", hint: "Paid, time passed, never started — check with therapist / client", to: "/appointments", tone: "amber" },
    unpaid > 0 && { key: "unpaid", n: unpaid, label: "Bookings left unpaid", hint: "Started checkout in the last 2 days — follow up", to: "/appointments", tone: "blue" },
    packsEnding > 0 && { key: "packs", n: packsEnding, label: "Session packs ending this week", hint: "Remind clients to book the rest", to: "/session-packs", tone: "blue" },
    therapistReqs > 0 && { key: "therapistReqs", n: therapistReqs, label: "Open therapist requests", hint: "Help / payout / profile requests", to: "/therapist-comms", tone: "blue" },
    collabNew > 0 && { key: "collab", n: collabNew, label: "New collaboration applications", hint: "Noida centre", to: "/collaborations", tone: "blue" },
    assessReview > 0 && { key: "assess", n: assessReview, label: "Assessments awaiting review", hint: "Client submitted — therapist to release", to: "/assessment-pricing", tone: "grey" },
    internPending > 0 && { key: "interns", n: internPending, label: "Internship applications", hint: "", to: "/internship-applications", tone: "grey" },
    traineeWaiting > 0 && { key: "trainees", n: traineeWaiting, label: "Trainee accounts to approve", hint: "", to: "/internship-applications", tone: "grey" },
    reviewsWeek > 0 && { key: "reviews", n: reviewsWeek, label: "New reviews this week", hint: "Read and reply", to: "/reviews", tone: "grey" },
  ].filter(Boolean);

  res.json({ status: true, data: { items, at: new Date().toISOString() } });
});

// GET /api/admin/search?q= — the admin's Ctrl+K search: clients and therapists by name / email / phone,
// and a booking by its id. Only what this admin's role can open.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const adminSearch = expressAsyncHandler(async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 60);
  if (q.length < 2) return res.json({ status: true, data: { clients: [], therapists: [], bookings: [] } });
  const perms = req.user?.roleId ? ((await Role.findById(req.user.roleId).select("permissions").lean())?.permissions || []) : null; // null = super admin
  const can = (k) => !perms || perms.includes(k);
  const digits = q.replace(/\D/g, "");
  const rx = new RegExp(esc(q), "i");
  const who = { $or: [{ name: rx }, { email: rx }, ...(digits.length >= 4 ? [{ phone: new RegExp(digits) }] : [])] };
  const [clients, therapistUsers, booking] = await Promise.all([
    can("clients") ? Users.find({ role: 0, ...who }).select("name email phone").limit(6).lean() : [],
    can("therapists") ? Users.find({ role: 1, ...who }).select("_id name email phone").limit(6).lean() : [],
    can("bookings") && mongoose.Types.ObjectId.isValid(q) ? Booking.findById(q).select("_id client therapist booking_date status").populate("client", "name").lean() : null,
  ]);
  const ther = therapistUsers.length ? await Therapists.find({ user: { $in: therapistUsers.map((u) => u._id) } }).select("_id user profile_type").lean() : [];
  const byUser = new Map(ther.map((t) => [String(t.user), t]));
  res.json({
    status: true,
    data: {
      clients: clients.map((c) => ({ id: String(c._id), name: c.name || c.email, sub: [c.phone, c.email].filter(Boolean).join(" · "), to: `/client-360/${c._id}` })),
      therapists: therapistUsers.filter((u) => byUser.has(String(u._id))).map((u) => ({ id: String(byUser.get(String(u._id))._id), name: u.name || u.email, sub: [byUser.get(String(u._id)).profile_type, u.phone].filter(Boolean).join(" · "), to: `/therapists/${byUser.get(String(u._id))._id}` })),
      bookings: booking ? [{ id: String(booking._id), name: `Booking · ${booking.client?.name || "client"}`, sub: `${booking.status} · ${new Date(booking.booking_date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}`, to: "/appointments" }] : [],
    },
  });
});
