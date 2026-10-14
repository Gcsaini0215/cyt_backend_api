import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Therapists from "../models/Therapists.js";
import Users from "../models/Users.js";
import TherapistAnnouncement from "../models/TherapistAnnouncement.js";
import TherapistActionRequest from "../models/TherapistActionRequest.js";
import TherapistPayout from "../models/TherapistPayout.js";
import TherapistFeedback from "../models/TherapistFeedback.js";
import TherapistPrefs from "../models/TherapistPrefs.js";
import { sendMail } from "../helper/mailer.js";
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
      },
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
  const doc = await TherapistPayout.create({ ...f, user: req.body.user, paidAt: f.status === "paid" ? new Date() : null, createdBy: req.user?._id || null });
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
  if (f.status === "paid" && before.status !== "paid" && req.body?.email !== false) mailPayout({ ...doc, user: doc.user._id });
  res.json({ status: true, data: doc, message: "Payout updated" });
});

export const adminDeletePayout = expressAsyncHandler(async (req, res) => {
  if (!superOnly(req, res)) return;
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid id" });
  await TherapistPayout.deleteOne({ _id: req.params.id });
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
