import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Therapists from "../models/Therapists.js";
import Users from "../models/Users.js";
import TherapistAnnouncement from "../models/TherapistAnnouncement.js";
import TherapistActionRequest from "../models/TherapistActionRequest.js";
import TherapistPayout from "../models/TherapistPayout.js";
import Booking from "../models/Booking.js";
import Transaction from "../models/Transaction.js";
import NoidaAppointment from "../models/NoidaAppointment.js";
import { refundReceptionSession, refundNoidaCredit } from "../helper/receptionPackage.js";
import { deleteMeetEvent } from "../helper/googleMeet.js";
import { therapistBookingsChanged } from "../services/therapistNotify.js";
import { changed as clientBookingsChanged } from "../services/clientNotify.js";
import { THERAPIST_PCT, payoutSplit, bookingSplit } from "../helper/payoutSplit.js";
import { razorpayxReady, payoutDestination, sendRazorpayxPayout, fetchRazorpayxPayout } from "../helper/razorpayx.js";
import { generateQrCode } from "../helper/generate.js";
import TherapistFeedback from "../models/TherapistFeedback.js";
import TherapistPrefs from "../models/TherapistPrefs.js";
import { sendMail } from "../helper/mailer.js";
import { notifyTherapists } from "../services/therapistNotify.js";
import {
  therapistNoticeMail, therapistActionMail, therapistPayoutMail, therapistFeedbackReplyMail,
} from "../services/mailTemplates.js";

/* Admin ↔ therapist communication: announcements, action requests, payouts, reports/feedback
   and the therapist's email preferences. Therapist routes use the Users _id (req.user._id). */

// payouts are money: only the Super Admin (an admin without a role) manages them
const superOnly = (req, res) => {
  if (req.user?.roleId) { res.status(403).json({ status: false, message: "Only the Super Admin can manage payouts" }); return false; }
  return true;
};

const PREF_KEYS = ["notice_email", "action_email", "payout_email", "reply_email"];
const isId = (v) => mongoose.Types.ObjectId.isValid(v);
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");
const safeLink = (v) => {
  const s = str(v, 500);
  return /^https?:\/\//i.test(s) || s.startsWith("/") ? s : "";
};
const absLink = (l) => (l && l.startsWith("/") ? `https://www.chooseyourtherapist.in${l}` : l);

async function prefsOf(userId) {
  const p = await TherapistPrefs.findOne({ user: userId }).lean();
  return Object.fromEntries(PREF_KEYS.map((k) => [k, p ? p[k] !== false : true]));
}

// email a list of users (sequentially, in the background) when their preference allows it
function mailInBackground(userIds, prefKey, build) {
  (async () => {
    let sent = 0;
    for (const id of userIds) {
      try {
        const prefs = await prefsOf(id);
        if (!prefs[prefKey]) continue;
        const u = await Users.findById(id).select("name email").lean();
        if (!u?.email) continue;
        const { subject, text, html } = build(u);
        if (await sendMail(u.email, subject, text, html, "Choose Your Therapist")) sent++;
      } catch (err) {
        console.error(`[therapist-comms] mail to ${id} failed:`, err.message);
      }
    }
    return sent;
  })().catch((err) => console.error("[therapist-comms] mail batch failed:", err.message));
}

const myCity = async (userId) => {
  const t = await Therapists.findOne({ user: userId }).select("state").lean();
  return String(t?.state || "");
};

/* ───────────── Therapist side ───────────── */

// GET /therapist-comms/inbox — announcements + action requests + unread count
export const getInbox = expressAsyncHandler(async (req, res) => {
  const uid = req.user._id;
  const loc = (await myCity(uid)).toLowerCase();
  const since = new Date(Date.now() - 120 * 86400000);
  const raw = await TherapistAnnouncement.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(60).lean();
  const announcements = raw
    .filter((a) => !a.city || loc.includes(a.city.toLowerCase()))
    .slice(0, 25)
    .map((a) => ({
      _id: a._id, title: a.title, body: a.body, link: a.link, linkLabel: a.linkLabel, important: a.important,
      createdAt: a.createdAt, read: (a.readBy || []).some((r) => String(r.user) === String(uid)),
    }));
  const actions = await TherapistActionRequest.find({
    user: uid, $or: [{ status: "open" }, { status: "done", doneAt: { $gte: new Date(Date.now() - 30 * 86400000) } }],
  }).sort({ status: -1, dueDate: 1, createdAt: -1 }).select("title body link dueDate status doneAt createdAt").lean();
  const openFeedbackReplies = await TherapistFeedback.countDocuments({ user: uid, repliedAt: { $ne: null }, updatedAt: { $gte: new Date(Date.now() - 7 * 86400000) } });
  res.json({
    status: true,
    data: {
      announcements,
      actions,
      unread: announcements.filter((a) => !a.read).length + actions.filter((a) => a.status === "open").length,
      recentReplies: openFeedbackReplies,
    },
  });
});

// POST /therapist-comms/announcements/:id/read
export const readAnnouncement = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid id" });
  await TherapistAnnouncement.updateOne(
    { _id: req.params.id, "readBy.user": { $ne: req.user._id } },
    { $push: { readBy: { user: req.user._id, at: new Date() } } }
  );
  res.json({ status: true });
});

// POST /therapist-comms/actions/:id/done   body: { note? }
export const completeAction = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid id" });
  const doc = await TherapistActionRequest.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id, status: "open" },
    { $set: { status: "done", doneAt: new Date(), doneNote: str(req.body?.note, 1000) } },
    { new: true }
  ).lean();
  if (!doc) return res.status(404).json({ status: false, message: "Request not found or already done" });
  res.json({ status: true, data: doc, message: "Marked as done" });
});

// GET /therapist-comms/payouts
export const myPayouts = expressAsyncHandler(async (req, res) => {
  const payouts = await TherapistPayout.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(200)
    .select("amount periodFrom periodTo sessions method reference status paidAt note createdAt").lean();
  // earnings by session: every session a client has paid for (newest first) — the therapist's 70% and its payout
  const me = await Therapists.findOne({ user: req.user._id }).select("_id").lean();
  const sessions = me ? await Booking.find({ therapist: me._id, status: { $ne: "Cancelled" }, $or: [{ payment_status: "Paid" }, { transaction: { $ne: null } }] })
    .select("booking_date status source cname service format payment_status amount referral_discount credit_used noida_amount noida_fee noida_session_value assessment_fee assessment_therapist_share transaction payout_id client")
    .populate("transaction", "amount").populate("client", "name").populate("payout_id", "status amount paidAt createdAt")
    .sort({ booking_date: -1 }).limit(1000).lean() : [];
  const earnings = sessions.map((b) => {
    const sp = bookingSplit(b);
    return {
      _id: b._id, sessionAt: b.booking_date, client: b.client?.name || b.cname || "Client", service: b.service || "", format: b.format || "",
      source: b.source === "noida" ? "noida" : "online", status: b.status, paid: sp.paid, share: sp.therapist, platform: sp.platform, pct: sp.pct,
      payout: b.payout_id ? { status: b.payout_id.status, amount: b.payout_id.amount, at: b.payout_id.paidAt || b.payout_id.createdAt } : null,
    };
  }).filter((e) => e.paid > 0);
  const done = earnings.filter((e) => e.status === "Completed");
  const paid = payouts.filter((p) => p.status === "paid");
  const yearStart = new Date(new Date().getFullYear(), 3, 1); // financial year (Apr)
  if (yearStart > new Date()) yearStart.setFullYear(yearStart.getFullYear() - 1);
  res.json({
    status: true,
    data: {
      payouts,
      totals: {
        paid: paid.reduce((s, p) => s + p.amount, 0),
        pending: payouts.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount, 0),
        thisYear: paid.filter((p) => (p.paidAt || p.createdAt) >= yearStart).reduce((s, p) => s + p.amount, 0),
        lastPaidAt: paid[0]?.paidAt || null,
        earned: done.reduce((s, e) => s + e.share, 0),            // your share of every completed session
        awaiting: done.filter((e) => !e.payout).reduce((s, e) => s + e.share, 0), // completed, payout not started yet
        pct: THERAPIST_PCT,
      },
      earnings,
    },
  });
});

// GET / PUT /therapist-comms/prefs
export const getPrefs = expressAsyncHandler(async (req, res) => {
  res.json({ status: true, data: await prefsOf(req.user._id) });
});
export const savePrefs = expressAsyncHandler(async (req, res) => {
  const set = {};
  PREF_KEYS.forEach((k) => { if (typeof req.body?.[k] === "boolean") set[k] = req.body[k]; });
  await TherapistPrefs.updateOne({ user: req.user._id }, { $set: set }, { upsert: true });
  res.json({ status: true, data: await prefsOf(req.user._id), message: "Preferences saved" });
});

// POST /therapist-comms/feedback   body: { kind, message, page }
export const sendFeedback = expressAsyncHandler(async (req, res) => {
  const message = str(req.body?.message, 3000);
  if (message.length < 5) return res.status(400).json({ status: false, message: "Please write a few words about it" });
  const recent = await TherapistFeedback.countDocuments({ user: req.user._id, createdAt: { $gte: new Date(Date.now() - 3600000) } });
  if (recent >= 10) return res.status(429).json({ status: false, message: "Too many messages — please try again in a while" });
  const kind = ["problem", "feature", "question", "other"].includes(req.body?.kind) ? req.body.kind : "problem";
  const doc = await TherapistFeedback.create({ user: req.user._id, kind, message, page: str(req.body?.page, 300) });
  res.json({ status: true, data: doc, message: "Sent — the team will get back to you" });
});

// GET /therapist-comms/feedback — my reports and the team's replies
export const myFeedback = expressAsyncHandler(async (req, res) => {
  const data = await TherapistFeedback.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50)
    .select("kind message page status reply repliedAt createdAt").lean();
  res.json({ status: true, data });
});

/* ───────────── Admin side ───────────── */

// GET /admin/therapist-comms/therapists — picker list
export const adminTherapistOptions = expressAsyncHandler(async (req, res) => {
  const list = await Therapists.find({ user: { $ne: null } })
    .select("user state show_to_page verification_status profile_type")
    .populate("user", "name email")
    .lean();
  const data = list.filter((t) => t.user).map((t) => ({
    user: t.user._id, therapist: t._id, name: t.user.name, email: t.user.email, city: t.state || "",
    live: t.show_to_page === 1 || t.show_to_page === true, status: t.verification_status, type: t.profile_type || "",
  })).sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  res.json({ status: true, data });
});

// audience: { all: true } | { city } | { users: [ids] } -> Users ids
async function resolveAudience({ all, city, users }) {
  if (Array.isArray(users) && users.length) return users.filter(isId);
  const q = { user: { $ne: null } };
  if (city) q.state = { $regex: esc(city), $options: "i" };
  if (!all && !city) return [];
  return (await Therapists.find(q).select("user").lean()).map((t) => t.user);
}

export const adminListAnnouncements = expressAsyncHandler(async (req, res) => {
  const docs = await TherapistAnnouncement.find().sort({ createdAt: -1 }).limit(100).lean();
  const audience = await Therapists.find({ user: { $ne: null } }).select("user state").lean();
  const data = docs.map((a) => {
    const reach = a.city ? audience.filter((t) => String(t.state || "").toLowerCase().includes(a.city.toLowerCase())).length : audience.length;
    return { ...a, readCount: (a.readBy || []).length, reach, readBy: undefined };
  });
  res.json({ status: true, data });
});

export const adminCreateAnnouncement = expressAsyncHandler(async (req, res) => {
  const title = str(req.body?.title, 160);
  if (!title) return res.status(400).json({ status: false, message: "Title is required" });
  const doc = await TherapistAnnouncement.create({
    title, body: str(req.body?.body, 4000), link: safeLink(req.body?.link), linkLabel: str(req.body?.linkLabel, 60),
    city: str(req.body?.city, 80), important: !!req.body?.important, createdBy: req.user?._id || null,
  });
  resolveAudience({ all: !doc.city, city: doc.city }).then((ids) => notifyTherapists(ids, {
    type: "notice", title: `${doc.important ? "Important: " : ""}${doc.title}`, body: (doc.body || "").slice(0, 200),
    link: "/therapists/notifications", ref: `notice:${doc._id}`,
  })).catch(() => {});
  if (req.body?.email) {
    const ids = await resolveAudience({ all: !doc.city, city: doc.city });
    await TherapistAnnouncement.updateOne({ _id: doc._id }, { $set: { emailed: ids.length } });
    mailInBackground(ids, "notice_email", (u) => ({
      subject: `${doc.important ? "Important: " : ""}${doc.title}`,
      text: `${doc.title}\n\n${doc.body}`,
      html: therapistNoticeMail({ name: u.name, title: doc.title, body: doc.body, link: absLink(doc.link), linkLabel: doc.linkLabel, important: doc.important }),
    }));
  }
  res.json({ status: true, data: doc, message: req.body?.email ? "Posted — emails are going out" : "Posted" });
});

export const adminDeleteAnnouncement = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid id" });
  await TherapistAnnouncement.deleteOne({ _id: req.params.id });
  res.json({ status: true, message: "Deleted" });
});

// GET /admin/therapist-comms/announcements/:id/reads — who has read it
export const adminAnnouncementReads = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid id" });
  const a = await TherapistAnnouncement.findById(req.params.id).populate("readBy.user", "name email").lean();
  if (!a) return res.status(404).json({ status: false, message: "Not found" });
  res.json({ status: true, data: (a.readBy || []).filter((r) => r.user).map((r) => ({ name: r.user.name, email: r.user.email, at: r.at })) });
});

export const adminListActions = expressAsyncHandler(async (req, res) => {
  const q = {};
  if (["open", "done", "cancelled"].includes(req.query.status)) q.status = req.query.status;
  const data = await TherapistActionRequest.find(q).sort({ createdAt: -1 }).limit(500).populate("user", "name email").lean();
  res.json({ status: true, data });
});

// body: { title, body, link, dueDate, users: [ids] | all | city, email }
export const adminCreateActions = expressAsyncHandler(async (req, res) => {
  const title = str(req.body?.title, 160);
  if (!title) return res.status(400).json({ status: false, message: "Title is required" });
  const ids = await resolveAudience({ all: !!req.body?.all, city: str(req.body?.city, 80), users: req.body?.users });
  if (!ids.length) return res.status(400).json({ status: false, message: "Choose at least one therapist" });
  const due = req.body?.dueDate ? new Date(req.body.dueDate) : null;
  const batch = new mongoose.Types.ObjectId().toString();
  const base = { title, body: str(req.body?.body, 2000), link: safeLink(req.body?.link), dueDate: due && !isNaN(due) ? due : null, batch, createdBy: req.user?._id || null };
  await TherapistActionRequest.insertMany(ids.map((user) => ({ ...base, user })));
  notifyTherapists(ids, { type: "action", title: `Action needed: ${title}`, body: (base.body || "").slice(0, 200), link: "/therapists/notifications", ref: `action:${batch}` });
  if (req.body?.email) {
    mailInBackground(ids, "action_email", (u) => ({
      subject: `Action needed: ${title}`,
      text: `${title}\n\n${base.body}`,
      html: therapistActionMail({ name: u.name, title, body: base.body, link: absLink(base.link), due: fmtDay(base.dueDate) }),
    }));
  }
  res.json({ status: true, message: `Sent to ${ids.length} therapist${ids.length === 1 ? "" : "s"}` });
});

// PATCH /admin/therapist-comms/actions/:id  body: { status: "open" | "cancelled" | "done" }
export const adminUpdateAction = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid id" });
  const status = ["open", "done", "cancelled"].includes(req.body?.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ status: false, message: "Invalid status" });
  const doc = await TherapistActionRequest.findByIdAndUpdate(req.params.id,
    { $set: { status, doneAt: status === "done" ? new Date() : null } }, { new: true }).populate("user", "name email").lean();
  res.json({ status: true, data: doc });
});

export const adminListPayouts = expressAsyncHandler(async (req, res) => {
  if (!superOnly(req, res)) return;
  const q = {};
  if (req.query.user && isId(req.query.user)) q.user = req.query.user;
  const data = await TherapistPayout.find(q).sort({ createdAt: -1 }).limit(500).populate("user", "name email").lean();
  res.json({ status: true, data });
});

const payoutFields = (b) => {
  const out = {};
  if (b.amount !== undefined) out.amount = Math.max(0, Math.round(Number(b.amount) || 0));
  if (b.sessions !== undefined) out.sessions = Math.max(0, Math.round(Number(b.sessions) || 0));
  ["periodFrom", "periodTo"].forEach((k) => { if (b[k] !== undefined) { const d = b[k] ? new Date(b[k]) : null; out[k] = d && !isNaN(d) ? d : null; } });
  if (["bank", "upi", "other"].includes(b.method)) out.method = b.method;
  if (b.reference !== undefined) out.reference = str(b.reference, 120);
  if (b.note !== undefined) out.note = str(b.note, 1000);
  if (["pending", "paid"].includes(b.status)) out.status = b.status;
  return out;
};

// the therapist's open dashboard re-reads its payouts + earnings at once (live "bookings" event)
const payoutsChanged = (p) => therapistBookingsChanged(p?.user?._id || p?.user);

function notifyPayout(p) {
  payoutsChanged(p);
  notifyTherapists([p.user?._id || p.user], {
    type: "payout", title: `Payout sent: ${inr(p.amount)}`,
    body: p.reference ? `Reference: ${p.reference}` : "It's on its way to your account.", link: "/therapists/payouts", ref: `payout:${p._id}`,
  });
}

function mailPayout(p) {
  const period = p.periodFrom && p.periodTo ? `${fmtDay(p.periodFrom)} – ${fmtDay(p.periodTo)}` : "";
  mailInBackground([p.user], "payout_email", (u) => ({
    subject: `Payout sent: ${inr(p.amount)}`,
    text: `Your payout of ${inr(p.amount)} has been sent.${p.reference ? ` Reference: ${p.reference}` : ""}`,
    html: therapistPayoutMail({ name: u.name, amount: inr(p.amount), method: { bank: "Bank account", upi: "UPI" }[p.method] || "Other", reference: p.reference, period }),
  }));
}

export const adminCreatePayout = expressAsyncHandler(async (req, res) => {
  if (!superOnly(req, res)) return;
  if (!isId(req.body?.user)) return res.status(400).json({ status: false, message: "Choose a therapist" });
  const f = payoutFields(req.body || {});
  if (!f.amount) return res.status(400).json({ status: false, message: "Enter the amount" });
  // sessions this payout covers: only that therapist's, and only ones not paid out already
  let bookingIds = [];
  if (Array.isArray(req.body.bookings) && req.body.bookings.length) {
    const ids = [...new Set(req.body.bookings.map(String))].filter(isId).slice(0, 500);
    const found = await Booking.find({ _id: { $in: ids }, payout_id: null }).populate("therapist", "user").select("_id therapist").lean();
    bookingIds = found.filter((b) => String(b.therapist?.user) === String(req.body.user)).map((b) => b._id);
    if (bookingIds.length !== ids.length) return res.status(400).json({ status: false, message: "Some of these sessions are already paid out or belong to another therapist — refresh and try again." });
  }
  const doc = await TherapistPayout.create({ ...f, user: req.body.user, bookings: bookingIds, paidAt: f.status === "paid" ? new Date() : null, createdBy: req.user?._id || null });
  if (bookingIds.length) await Booking.updateMany({ _id: { $in: bookingIds }, payout_id: null }, { $set: { payout_id: doc._id } });
  if (doc.status === "paid") notifyPayout(doc);
  if (doc.status === "paid" && req.body?.email !== false) mailPayout(doc);
  res.json({ status: true, data: await TherapistPayout.findById(doc._id).populate("user", "name email").lean(), message: "Payout saved" });
});

export const adminUpdatePayout = expressAsyncHandler(async (req, res) => {
  if (!superOnly(req, res)) return;
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid id" });
  const before = await TherapistPayout.findById(req.params.id).lean();
  if (!before) return res.status(404).json({ status: false, message: "Not found" });
  const f = payoutFields(req.body || {});
  if (f.status === "paid" && before.status !== "paid") f.paidAt = new Date();
  if (f.status === "pending") f.paidAt = null;
  const doc = await TherapistPayout.findByIdAndUpdate(req.params.id, { $set: f }, { new: true }).populate("user", "name email").lean();
  if (f.status === "paid" && before.status !== "paid") notifyPayout(doc);
  if (f.status === "paid" && before.status !== "paid" && req.body?.email !== false) mailPayout({ ...doc, user: doc.user._id });
  payoutsChanged(doc);
  res.json({ status: true, data: doc, message: "Payout updated" });
});

export const adminDeletePayout = expressAsyncHandler(async (req, res) => {
  if (!superOnly(req, res)) return;
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid id" });
  const gone = await TherapistPayout.findByIdAndDelete(req.params.id).select("user").lean();
  await Booking.updateMany({ payout_id: req.params.id }, { $set: { payout_id: null } }); // its sessions are "to pay" again
  if (gone) payoutsChanged(gone);
  res.json({ status: true, message: "Deleted" });
});

export const adminListFeedback = expressAsyncHandler(async (req, res) => {
  const q = {};
  if (["open", "resolved"].includes(req.query.status)) q.status = req.query.status;
  const data = await TherapistFeedback.find(q).sort({ status: 1, createdAt: -1 }).limit(500).populate("user", "name email phone").lean();
  res.json({ status: true, data });
});

// PATCH /admin/therapist-comms/feedback/:id  body: { reply?, status? }
export const adminReplyFeedback = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid id" });
  const set = {};
  const reply = str(req.body?.reply, 3000);
  if (reply) Object.assign(set, { reply, repliedAt: new Date(), repliedBy: req.user?._id || null, status: "resolved" });
  if (["open", "resolved"].includes(req.body?.status)) set.status = req.body.status;
  if (!Object.keys(set).length) return res.status(400).json({ status: false, message: "Nothing to update" });
  const doc = await TherapistFeedback.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).populate("user", "name email phone").lean();
  if (!doc) return res.status(404).json({ status: false, message: "Not found" });
  if (reply && doc.user?._id) {
    notifyTherapists([doc.user._id], { type: "reply", title: "The CYT team replied to your message", body: reply.slice(0, 200), link: "/therapists/help", ref: `reply:${doc._id}:${Date.now()}` });
    mailInBackground([doc.user._id], "reply_email", (u) => ({
      subject: "The CYT team replied to your message",
      text: reply,
      html: therapistFeedbackReplyMail({ name: u.name, message: doc.message, reply }),
    }));
  }
  res.json({ status: true, data: doc, message: reply ? "Reply sent" : "Updated" });
});

// GET /admin/therapist-comms/summary — counts for the admin sidebar badge
export const adminCommsSummary = expressAsyncHandler(async (req, res) => {
  const [openFeedback, pendingPayouts, openActions] = await Promise.all([
    TherapistFeedback.countDocuments({ status: "open" }),
    req.user?.roleId ? 0 : TherapistPayout.countDocuments({ status: "pending" }),
    TherapistActionRequest.countDocuments({ status: "open" }),
  ]);
  res.json({ status: true, data: { openFeedback, pendingPayouts, openActions } });
});

/* Admin → Payouts: every session booking as one flat row — who booked which therapist, when, what was
   paid and how. A CYT Noida session shows what the client paid CYT (its Booking itself is ₹0). */
const dec = (v) => Number(v?.$numberDecimal ?? v?.toString?.() ?? v) || 0;

// the 70 / 30 split lives in helper/payoutSplit.js (the therapist dashboard counts earnings with it too)
export { THERAPIST_PCT, payoutSplit };
export const adminPayoutBookings = expressAsyncHandler(async (req, res) => {
  if (!superOnly(req, res)) return;
  const q = {};
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;
  if ((from && !isNaN(from)) || (to && !isNaN(to))) {
    q.booking_date = {};
    if (from && !isNaN(from)) q.booking_date.$gte = from;
    if (to && !isNaN(to)) q.booking_date.$lte = new Date(to.getTime() + 86400000 - 1);
  }
  if (isId(req.query.therapist)) q.therapist = req.query.therapist;
  const rows = await Booking.find(q).select("-otp")
    .populate("client", "name email phone")
    .populate({ path: "therapist", select: "_id user profile_code profile_type", populate: { path: "user", select: "name email phone" } })
    .populate({ path: "transaction", select: "amount transaction_id payment_method createdAt is_payment_success" })
    .populate({ path: "payout_id", select: "amount status paidAt createdAt method reference sessions rzp_payout_id rzp_status rzp_error rzp_mode" })
    .sort({ booking_date: -1 }).limit(3000).lean();
  const data = rows.map((b) => {
    const noida = b.source === "noida";
    const tx = b.transaction || null;
    const paid = noida ? Number(b.noida_amount) || 0 : (tx ? Number(tx.amount) || 0 : 0);
    const forOther = b.whom && !/self|whom/i.test(b.whom) && b.cname;
    return {
      _id: b._id,
      bookedAt: b._id.getTimestamp ? b._id.getTimestamp() : null,
      sessionAt: b.booking_date,
      therapist: { _id: b.therapist?._id, user: b.therapist?.user?._id, name: b.therapist?.user?.name || "—", email: b.therapist?.user?.email || "", code: b.therapist?.profile_code || "" },
      client: { name: b.client?.name || b.cname || "—", email: b.client?.email || "", phone: b.client?.phone || b.noida_phone || "" },
      bookedFor: forOther ? { name: b.cname, relation: b.relation_with_client || "" } : null,
      service: b.service || "", format: b.format || "", sessionType: b.session_type || "",
      source: noida ? "noida" : "online", noidaCode: b.noida_client_code || "",
      status: b.status || "New",
      paymentStatus: b.payment_status || (tx ? "Paid" : "Pending Payment"),
      fee: noida ? paid + (Number(b.noida_discount) || 0) : dec(b.amount),
      paid,
      platformFee: noida ? Number(b.noida_fee) || 0 : 0,
      discount: noida ? Number(b.noida_discount) || 0 : (Number(b.referral_discount) || 0) + (Number(b.credit_used) || 0),
      coupon: b.coupon_code || b.referral_code || "",
      assessmentFee: Number(b.assessment_fee) || 0,
      method: noida ? `CYT Noida · ${b.noida_paid_via || "—"}` : tx?.payment_method || "",
      txnId: tx?.transaction_id || "",
      paidAt: tx?.createdAt || null,
      startedAt: b.session_started_at || null, completedAt: b.session_completed_at || null,
      split: bookingSplit(b),
      packageSession: noida && !paid && b.noida_session_value > 0,
      payout: b.payout_id ? { _id: b.payout_id._id, status: b.payout_id.status, amount: b.payout_id.amount, sessions: b.payout_id.sessions, paidAt: b.payout_id.paidAt || b.payout_id.createdAt, method: b.payout_id.method, reference: b.payout_id.reference, rzpId: b.payout_id.rzp_payout_id || "", rzpStatus: b.payout_id.rzp_status || "", rzpError: b.payout_id.rzp_error || "", rzpMode: b.payout_id.rzp_mode || "" } : null,
    };
  });
  res.json({ status: true, data });
});

/* Admin → Payouts → "Initiate payout" for one session: allowed once the client has paid and the therapist
   has ended the session. Records a "processing" payout of the therapist's 70% (worked out here, never
   taken from the browser), linked to the booking; "Mark paid" (with the UTR) later tells the therapist. */
export const adminInitiateBookingPayout = expressAsyncHandler(async (req, res) => {
  if (!superOnly(req, res)) return;
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid booking" });
  const b = await Booking.findById(req.params.id).populate({ path: "therapist", select: "user", populate: { path: "user", select: "name" } })
    .populate("client", "name").populate("transaction", "amount").lean();
  if (!b) return res.status(404).json({ status: false, message: "Booking not found" });
  if (b.payout_id) return res.status(409).json({ status: false, message: "This session's payout has already been initiated." });
  const noida = b.source === "noida";
  const sp = bookingSplit(b);
  const paid = sp.paid;
  if (!/paid/i.test(b.payment_status || "") && !b.transaction) return res.status(400).json({ status: false, message: "The client hasn't paid for this session yet." });
  if (b.status === "Cancelled") return res.status(400).json({ status: false, message: "This session was cancelled." });
  if (!b.therapist?.user) return res.status(400).json({ status: false, message: "This booking has no therapist account." });
  if (!(sp.therapist > 0)) return res.status(400).json({ status: false, message: "Nothing to pay out — this session is worth ₹0 (free or fully discounted)." });
  if (b.status !== "Completed") {
    // the therapist never ended it: the admin can confirm it took place (only once its time has passed)
    const started = b.booking_date ? new Date(b.booking_date).getTime() : Infinity;
    if (!req.body?.confirmHeld) return res.status(400).json({ status: false, message: "The payout can start once the therapist has ended the session." });
    if (started > Date.now()) return res.status(400).json({ status: false, message: "This session hasn't happened yet." });
    const now = new Date();
    await Booking.updateOne({ _id: b._id, status: { $in: ["New", "Started"] } }, { $set: { status: "Completed", session_completed_at: now, ...(b.session_started_at ? {} : { session_started_at: b.booking_date }), auto_completed: true } });
    if (b.noida_appointment) await NoidaAppointment.updateOne({ _id: b.noida_appointment, attendance: { $in: ["", "arrived"] } }, { $set: { attendance: "completed", attendanceAt: now } });
    therapistBookingsChanged(b.therapist.user._id);
    clientBookingsChanged(b.client?._id || b.client);
  }
  const when = b.booking_date || new Date();
  const method = ["bank", "upi", "other"].includes(req.body?.method) ? req.body.method : "bank";
  const doc = await TherapistPayout.create({
    user: b.therapist.user._id, amount: sp.therapist, sessions: 1, periodFrom: when, periodTo: when, method,
    status: "pending", bookings: [b._id], gross: paid, platformShare: sp.platform, therapistPct: sp.pct, createdBy: req.user?._id || null,
    note: str(`Session with ${b.client?.name || b.cname || "client"} on ${fmtDay(when)}${noida ? " (CYT Noida)" : ""} — ${sp.pct}% of ${inr(sp.base)}`, 1000),
  });
  const linked = await Booking.updateOne({ _id: b._id, payout_id: null }, { $set: { payout_id: doc._id } });
  if (!linked.modifiedCount) { await TherapistPayout.deleteOne({ _id: doc._id }); return res.status(409).json({ status: false, message: "This session's payout was just initiated elsewhere." }); }
  payoutsChanged(doc);
  notifyTherapists([doc.user], {
    type: "payout", title: `Payout processing: ${inr(doc.amount)}`,
    body: `For your session on ${fmtDay(when)} — ${sp.pct}% of ${inr(sp.base)}. You'll be told when it's sent.`, link: "/therapists/payouts", ref: `payout-init:${doc._id}`,
  });
  res.json({ status: true, data: doc, message: `Payout of ${inr(sp.therapist)} initiated` });
});

/* ── Paying an initiated payout through RazorpayX ── */
const RZP_DONE = ["processed"], RZP_FAILED = ["reversed", "failed", "rejected", "cancelled"];

// a RazorpayX payout entity (webhook or fetched) → our payout. Processed = paid (with the UTR); a failed one
// stays "processing" with the reason, so the admin can send it again. Returns the payout, or null.
export async function applyRazorpayxPayout(entity) {
  if (!entity?.id) return null;
  const p = await TherapistPayout.findOne({ $or: [{ rzp_payout_id: entity.id }, ...(isId(entity.reference_id) ? [{ _id: entity.reference_id }] : [])] });
  if (!p) return null;
  if (p.rzp_payout_id && p.rzp_payout_id !== entity.id) return p; // an older attempt — ignore
  const set = { rzp_payout_id: entity.id, rzp_status: entity.status || "", rzp_mode: entity.mode || p.rzp_mode };
  if (RZP_DONE.includes(entity.status)) {
    set.rzp_error = "";
    if (p.status !== "paid") { set.status = "paid"; set.paidAt = new Date(); }
    if (entity.utr) set.reference = str(entity.utr, 120);
  } else if (RZP_FAILED.includes(entity.status)) {
    set.rzp_error = str(entity.status_details?.description || entity.failure_reason || `Payout ${entity.status}`, 300);
  }
  const before = p.status;
  p.set(set);
  await p.save();
  payoutsChanged(p);
  if (before !== "paid" && p.status === "paid") { notifyPayout(p); mailPayout(p); }
  return p;
}

// GET …/payouts/:id/pay-info — where the money goes (prefilled in the Pay dialog)
export const adminPayoutPayInfo = expressAsyncHandler(async (req, res) => {
  if (!superOnly(req, res)) return;
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid id" });
  const p = await TherapistPayout.findById(req.params.id).lean();
  if (!p) return res.status(404).json({ status: false, message: "Not found" });
  const dest = await payoutDestination(p.user);
  // paying by hand from CYT's own account: a UPI QR for the exact amount, scanned with any UPI app
  const upiQr = dest.upi ? await generateQrCode({ upiID: dest.upi, name: dest.name || "Therapist", amount: p.amount, note: "CYT payout" }).catch(() => "") : "";
  res.json({ status: true, data: { amount: p.amount, status: p.status, dest, upiQr, razorpayx: razorpayxReady(), rzpStatus: p.rzp_status, rzpError: p.rzp_error, rzpId: p.rzp_payout_id } });
});

// POST …/payouts/:id/send { to: "bank" | "upi", mode: "IMPS" | "NEFT" } — send it now through RazorpayX
export const adminSendPayout = expressAsyncHandler(async (req, res) => {
  if (!superOnly(req, res)) return;
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid id" });
  const p = await TherapistPayout.findById(req.params.id);
  if (!p) return res.status(404).json({ status: false, message: "Not found" });
  if (p.status === "paid") return res.status(409).json({ status: false, message: "This payout is already paid." });
  if (p.rzp_payout_id && !RZP_FAILED.includes(p.rzp_status)) return res.status(409).json({ status: false, message: "This payout is already on its way through RazorpayX — use Check status." });
  const to = req.body?.to === "upi" ? "upi" : "bank";
  let fields;
  try { fields = await sendRazorpayxPayout(p, { to, mode: req.body?.mode }); }
  catch (e) {
    await TherapistPayout.updateOne({ _id: p._id }, { $set: { rzp_error: str(e.message, 300) } });
    return res.status(400).json({ status: false, message: e.message });
  }
  p.set(fields);
  await p.save();
  if (RZP_DONE.includes(fields.rzp_status)) await applyRazorpayxPayout({ id: fields.rzp_payout_id, status: fields.rzp_status, utr: fields.reference, reference_id: String(p._id) });
  res.json({ status: true, data: await TherapistPayout.findById(p._id).lean(), message: `${inr(p.amount)} sent through RazorpayX — it shows as paid once the bank confirms` });
});

// POST …/payouts/:id/sync — ask RazorpayX where the transfer is (when the webhook hasn't said yet)
export const adminSyncPayout = expressAsyncHandler(async (req, res) => {
  if (!superOnly(req, res)) return;
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid id" });
  const p = await TherapistPayout.findById(req.params.id).lean();
  if (!p?.rzp_payout_id) return res.status(400).json({ status: false, message: "This payout hasn't been sent through RazorpayX." });
  try {
    const entity = await fetchRazorpayxPayout(p.rzp_payout_id);
    const out = await applyRazorpayxPayout(entity);
    res.json({ status: true, data: out, message: `RazorpayX: ${entity.status}` });
  } catch (e) {
    res.status(400).json({ status: false, message: e?.response?.data?.error?.description || e.message });
  }
});

/* DELETE …/payout-bookings/:id — Admin → Payouts → Delete (Super Admin, after a typed confirmation):
   the session goes everywhere — the client's dashboard, the therapist's dashboard and admin. Removes the
   booking, its payment record, its Google Meet event, the therapist payout made for it (a payout covering
   other sessions too just drops this one and its share) and, for a CYT Noida session, the Noida
   appointment (a package session goes back to the package). Razorpay itself is not touched — no refund. */
export const adminDeleteSessionBooking = expressAsyncHandler(async (req, res) => {
  if (!superOnly(req, res)) return;
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid booking" });
  const b = await Booking.findById(req.params.id).populate({ path: "therapist", select: "user" }).lean();
  if (!b) return res.status(404).json({ status: false, message: "Booking not found" });
  const removed = { booking: 1, payment: 0, payout: 0, noida: 0 };

  if (b.payout_id) {
    const p = await TherapistPayout.findById(b.payout_id).lean();
    if (p) {
      const others = (p.bookings || []).filter((x) => String(x) !== String(b._id));
      if (!others.length) { await TherapistPayout.deleteOne({ _id: p._id }); removed.payout = 1; }
      else {
        const share = bookingSplit({ ...b, transaction: b.transaction ? await Transaction.findById(b.transaction).select("amount").lean() : null }).therapist;
        await TherapistPayout.updateOne({ _id: p._id }, { $set: { bookings: others, sessions: Math.max(0, (p.sessions || 1) - 1), amount: Math.max(0, (p.amount || 0) - share) } });
      }
    }
  }
  if (b.transaction) { removed.payment = (await Transaction.deleteOne({ _id: b.transaction })).deletedCount; }
  if (b.calendar_event_id) await deleteMeetEvent(b).catch(() => {});

  if (b.noida_appointment) {
    const a = await NoidaAppointment.findByIdAndDelete(b.noida_appointment).lean();
    if (a) {
      removed.noida = 1;
      if (a.status !== "cancelled" && !a.creditRefunded && !["arrived", "completed"].includes(a.attendance)) {
        if (a.receptionCreditClientId) await refundReceptionSession(a.receptionCreditClientId, { kind: "delete-refund", ref: String(a._id), date: a.date, slot: a.slot, by: req.user?.name || "admin" }).catch(() => {});
        else if (a.creditUsed) await refundNoidaCredit(a.creditUsed).catch(() => {});
      }
    }
  }
  await Booking.deleteOne({ _id: b._id });
  clientBookingsChanged(b.client);
  therapistBookingsChanged(b.therapist?.user);
  res.json({ status: true, data: removed, message: "Session deleted everywhere" });
});
