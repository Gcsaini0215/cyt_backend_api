import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Jwt from "jsonwebtoken";
import Users from "../models/Users.js";
import Admin from "../models/Admin.js";
import Role from "../models/Role.js";
import Therapists from "../models/Therapists.js";
import { ChatThread, ChatMessage, ChatAccessLog, ChatSettings, ChatConsent } from "../models/LiveChat.js";
import { encrypt, decrypt } from "../helper/googleMeet.js";
import { CRISIS, maskContacts, chatState, inOfficeHours, hoursText, OPEN_DAYS } from "../helper/chatRules.js";
import { addChatClient, addChatAdmin, toUser, toAdmins, isOnline } from "../services/chatHub.js";
import { notifyTherapists } from "../services/therapistNotify.js";
import { notifyClient } from "../services/clientNotify.js";
import PushSubscription from "../models/PushSubscription.js";
import { pushToUsers } from "./PushController.js";

/* Live therapist ↔ client chat (2026-11-23). Routes: routes/liveChat.js (/api/live-chat/*, /api/admin/live-chat/*).
   Rules in helper/chatRules.js, live events in services/chatHub.js. The old chat (routes/chat.js) is untouched.
   Admin: page:/chat-monitor permission (or super admin) reads every thread; each opening is logged. */

const isId = (x) => mongoose.Types.ObjectId.isValid(String(x || ""));
const dec = (b) => { try { return b ? decrypt(b) : ""; } catch { return ""; } };
const MAX_LEN = 2000;
const CRISIS_HELP = "If you're in danger or thinking about ending your life, please call 112 now, or India's free 24×7 Tele-MANAS helpline 14416. This chat is not watched round the clock — your therapist has been told.";
// page-level roles get "page:/chat-monitor"; module roles get "chatMonitor" (admin helpers/permissions.js)
export const ADMIN_PERM = ["page:/chat-monitor", "chatMonitor"];

const roleOf = (req) => (req.user?.role === 1 ? "therapist" : "client");
const otherOf = (t, role) => (role === "therapist" ? t.client : t.therapistUser);
const hourRef = () => new Date().toISOString().slice(0, 13);

/* phone notification (web push) when the person isn't in the app right now. The message text is never put on
   the lock screen — only who wrote, so a client's words stay private on a shared phone. */
function phonePush(userId, title, url) {
  if (!userId || isOnline(userId)) return;
  pushToUsers({ userId }, title, "Tap to read your message on CYT", url).catch(() => {});
}

const msgRow = (m, forAdmin = false) => ({
  _id: String(m._id), thread: String(m.thread), fromRole: m.fromRole, kind: m.kind || "text",
  body: m.deletedAt && !forAdmin ? "" : dec(m.body), deleted: !!m.deletedAt, masked: !!m.masked, crisis: !!m.crisis,
  readAt: m.readAt, createdAt: m.createdAt,
});

async function settingsFor(therapistUser) {
  return (await ChatSettings.findOne({ therapistUser }).lean()) || { enabled: true, start: "10:00", end: "19:00", days: [1, 2, 3, 4, 5, 6], autoReply: "" };
}

// what the viewer may do in this thread right now
async function stateFor(t, role) {
  const st = await chatState(t.client, t.therapist);
  const set = await settingsFor(t.therapistUser);
  const out = { mode: st.mode, openUntil: st.openUntil || null, closedAt: st.closedAt || null, enabled: set.enabled !== false, hours: hoursText(set), inHours: inOfficeHours(set), canSend: false, note: "" };
  if (st.mode === "open") {
    out.canSend = role === "therapist" || set.enabled !== false;
    if (!out.canSend) out.note = "Your therapist has turned off messages for now. You can still book or reschedule a session.";
  } else if (st.mode === "pre") {
    const asked = await ChatMessage.exists({ thread: t._id, fromRole: "client", deletedAt: null });
    const answered = await ChatMessage.exists({ thread: t._id, fromRole: "therapist", deletedAt: null });
    if (role === "client") {
      out.canSend = !asked && set.enabled !== false;
      out.note = asked
        ? (answered ? "To keep talking, book a session — messages open fully after your first booking." : "Your question has been sent. You can ask more after booking a session.")
        : set.enabled === false ? "This therapist isn't taking messages right now." : "Ask one quick question before you book. Messages open fully once your first session is booked.";
    } else {
      out.canSend = !!asked && !answered;
      out.note = !asked ? "" : answered ? "You've answered their question. The chat opens fully once they book a session." : "This person hasn't booked yet — you can send one reply.";
    }
  } else {
    out.note = role === "client"
      ? `Messages close ${OPEN_DAYS} days after your last session. Book a session to continue the conversation.`
      : `This chat closed ${OPEN_DAYS} days after the last session. It opens again when they book.`;
  }
  return out;
}

async function threadRow(t, role) {
  const otherId = otherOf(t, role);
  const other = await Users.findById(otherId, { name: 1, profile: 1 }).lean();
  const th = role === "client" ? await Therapists.findById(t.therapist, { profile_type: 1 }).lean() : null;
  return {
    _id: String(t._id),
    other: { id: String(otherId), name: other?.name || (role === "client" ? "Therapist" : "Client"), photo: other?.profile || "", title: th?.profile_type || "", online: isOnline(otherId) },
    therapistId: String(t.therapist), lastMessageAt: t.lastMessageAt, lastFrom: t.lastFrom, preview: dec(t.lastPreview),
    unread: role === "therapist" ? t.unreadTherapist : t.unreadClient,
  };
}

/* ── consent ── */
export const getConsent = expressAsyncHandler(async (req, res) => {
  res.json({ status: true, data: { agreed: !!(await ChatConsent.exists({ user: req.user._id })) } });
});
export const giveConsent = expressAsyncHandler(async (req, res) => {
  await ChatConsent.updateOne({ user: req.user._id }, { $setOnInsert: { user: req.user._id, version: 1, ip: String(req.ip || "").slice(0, 60) } }, { upsert: true });
  res.json({ status: true });
});

/* ── threads ── */
export const listThreads = expressAsyncHandler(async (req, res) => {
  const role = roleOf(req);
  const q = role === "therapist" ? { therapistUser: req.user._id } : { client: req.user._id };
  const list = await ChatThread.find({ ...q, lastMessageAt: { $ne: null } }).sort({ lastMessageAt: -1 }).limit(200).lean();
  res.json({ status: true, data: { role, threads: await Promise.all(list.map((t) => threadRow(t, role))) } });
});

export const unreadCount = expressAsyncHandler(async (req, res) => {
  const role = roleOf(req);
  const field = role === "therapist" ? "unreadTherapist" : "unreadClient";
  const q = role === "therapist" ? { therapistUser: req.user._id } : { client: req.user._id };
  const r = await ChatThread.aggregate([{ $match: { ...q, [field]: { $gt: 0 } } }, { $group: { _id: null, n: { $sum: `$${field}` }, threads: { $sum: 1 } } }]);
  res.json({ status: true, data: { count: r[0]?.n || 0, threads: r[0]?.threads || 0 } });
});

// POST /api/live-chat/start { therapistId } — a client opens (or finds) the thread with a therapist
export const startThread = expressAsyncHandler(async (req, res) => {
  if (req.user.role !== 0) return res.status(403).json({ status: false, message: "Only clients can start a chat" });
  const tid = req.body?.therapistId;
  if (!isId(tid)) return res.status(400).json({ status: false, message: "Invalid therapist" });
  const th = await Therapists.findById(tid, { user: 1 }).lean();
  if (!th?.user) return res.status(404).json({ status: false, message: "Therapist not found" });
  if (String(th.user) === String(req.user._id)) return res.status(400).json({ status: false, message: "You can't message yourself" });
  const t = await ChatThread.findOneAndUpdate(
    { client: req.user._id, therapistUser: th.user },
    { $setOnInsert: { client: req.user._id, therapistUser: th.user, therapist: th._id } },
    { upsert: true, new: true },
  ).lean();
  res.json({ status: true, data: { id: String(t._id) } });
});

async function myThread(req, id) {
  if (!isId(id)) return null;
  const t = await ChatThread.findById(id).lean();
  if (!t) return null;
  const me = String(req.user._id);
  if (String(t.client) !== me && String(t.therapistUser) !== me) return null;
  return t;
}
const myRole = (t, req) => (String(t.therapistUser) === String(req.user._id) ? "therapist" : "client");

export const getThread = expressAsyncHandler(async (req, res) => {
  const t = await myThread(req, req.params.id);
  if (!t) return res.status(404).json({ status: false, message: "Chat not found" });
  const role = myRole(t, req);
  const q = { thread: t._id };
  if (req.query.before) { const d = new Date(String(req.query.before)); if (!Number.isNaN(d.getTime())) q.createdAt = { $lt: d }; }
  const msgs = await ChatMessage.find(q).sort({ createdAt: -1 }).limit(60).lean();
  res.json({ status: true, data: { thread: await threadRow(t, role), role, state: await stateFor(t, role), messages: msgs.reverse().map((m) => msgRow(m)), more: msgs.length === 60 } });
});

const adminMeta = (t) => (t ? {
  _id: String(t._id), lastMessageAt: t.lastMessageAt, lastFrom: t.lastFrom, messageCount: t.messageCount || 0,
  crisisCount: t.crisisCount || 0, contactCount: t.contactCount || 0, lastCrisisAt: t.lastCrisisAt, firstReplyMins: t.firstReplyMins,
  unreadTherapist: t.unreadTherapist || 0, createdAt: t.createdAt,
} : null);

async function addMessage(t, fromRole, from, body, extra = {}) {
  const m = await ChatMessage.create({ thread: t._id, from, fromRole, body: encrypt(body), ...extra });
  const inc = { messageCount: 1 };
  if (fromRole !== "therapist") inc.unreadTherapist = 1;
  if (fromRole !== "client") inc.unreadClient = 1;
  if (extra.crisis) inc.crisisCount = 1;
  if (extra.masked) inc.contactCount = 1;
  const set = { lastMessageAt: m.createdAt, lastFrom: fromRole, lastPreview: encrypt(body.slice(0, 90)) };
  if (extra.crisis) set.lastCrisisAt = m.createdAt;
  const nt = await ChatThread.findByIdAndUpdate(t._id, { $inc: inc, $set: set }, { new: true }).lean();
  const row = msgRow(m);
  if (from) row.fromName = (await Users.findById(from, { name: 1 }).lean())?.name || ""; // for the pop-up banner
  toUser(t.client, "message", { threadId: String(t._id), message: row });
  toUser(t.therapistUser, "message", { threadId: String(t._id), message: row });
  const [named] = await withNames([nt]);
  toAdmins("message", { threadId: String(t._id), message: msgRow(m, true), thread: named });
  return { m, nt };
}

// POST /api/live-chat/threads/:id/messages { text }
export const sendMessage = expressAsyncHandler(async (req, res) => {
  const t = await myThread(req, req.params.id);
  if (!t) return res.status(404).json({ status: false, message: "Chat not found" });
  const role = myRole(t, req);
  if (!(await ChatConsent.exists({ user: req.user._id }))) return res.status(403).json({ status: false, message: "Please accept the chat terms first", code: "consent" });
  const raw = String(req.body?.text || "").trim().slice(0, MAX_LEN);
  if (!raw) return res.status(400).json({ status: false, message: "Write a message first" });
  const st = await stateFor(t, role);
  if (!st.canSend) return res.status(403).json({ status: false, message: st.note || "You can't send messages here right now", state: st });

  const { text, masked } = maskContacts(raw);
  const crisis = CRISIS.test(raw);
  const kind = st.mode === "pre" ? (role === "client" ? "pre-question" : "pre-answer") : "text";
  const { m } = await addMessage(t, role, req.user._id, text, { masked, crisis, kind });

  if (role === "therapist" && t.firstReplyMins == null) {
    const first = await ChatMessage.findOne({ thread: t._id, fromRole: "client" }).sort({ createdAt: 1 }).lean();
    if (first) await ChatThread.updateOne({ _id: t._id }, { $set: { firstReplyMins: Math.round((m.createdAt - first.createdAt) / 60000) } });
  }

  if (role === "client") {
    if (crisis) {
      await addMessage(t, "system", null, CRISIS_HELP, { kind: "crisis-help" });
      notifyTherapists([t.therapistUser], { type: "action", title: `⚠ ${req.user.name || "A client"} may be at risk — please check the chat`, body: "Their message mentions self-harm. They were shown 112 and Tele-MANAS 14416.", link: `/therapists/messages?t=${t._id}`, ref: `chat-crisis:${m._id}` });
    } else {
      notifyTherapists([t.therapistUser], { type: "notice", title: `New message from ${req.user.name || "a client"}`, body: text.slice(0, 140), link: `/therapists/messages?t=${t._id}`, ref: `chat:${t._id}:${hourRef()}` });
    }
    phonePush(t.therapistUser, crisis ? `⚠ Urgent message from ${req.user.name || "a client"}` : `New message from ${req.user.name || "a client"}`, `/therapists/messages?t=${t._id}`);
    const set = await settingsFor(t.therapistUser);
    if (!inOfficeHours(set) && (!t.autoReplyAt || Date.now() - new Date(t.autoReplyAt).getTime() > 6 * 36e5)) {
      const msg = (set.autoReply || "").trim() || `Thanks for your message. I reply during my working hours (${hoursText(set)}). For an emergency, please call 112 or Tele-MANAS 14416.`;
      await ChatThread.updateOne({ _id: t._id }, { $set: { autoReplyAt: new Date() } });
      await addMessage(t, "system", null, msg, { kind: "auto-reply" });
    }
  } else {
    notifyClient(t.client, { type: "message", title: `${req.user.name || "Your therapist"} replied`, body: text.slice(0, 140), link: `/client/messages?t=${t._id}`, ref: `chat:${t._id}:${hourRef()}` });
    phonePush(t.client, `New message from ${req.user.name || "your therapist"}`, `/client/messages?t=${t._id}`);
  }
  res.json({ status: true, data: { message: msgRow(m), masked, crisis } });
});

export const markRead = expressAsyncHandler(async (req, res) => {
  const t = await myThread(req, req.params.id);
  if (!t) return res.status(404).json({ status: false, message: "Chat not found" });
  const role = myRole(t, req);
  const otherRoles = role === "therapist" ? ["client", "system"] : ["therapist", "system"];
  const now = new Date();
  await ChatMessage.updateMany({ thread: t._id, fromRole: { $in: otherRoles }, readAt: null }, { $set: { readAt: now } });
  await ChatThread.updateOne({ _id: t._id }, { $set: { [role === "therapist" ? "unreadTherapist" : "unreadClient"]: 0 } });
  toUser(otherOf(t, role), "read", { threadId: String(t._id), by: role, at: now });
  toUser(req.user._id, "read", { threadId: String(t._id), by: role, at: now });
  res.json({ status: true });
});

// "delete for everyone" within 10 minutes; the admin record keeps the text
export const deleteMessage = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid message" });
  const m = await ChatMessage.findOne({ _id: req.params.id, from: req.user._id, deletedAt: null });
  if (!m) return res.status(404).json({ status: false, message: "Message not found" });
  if (Date.now() - m.createdAt.getTime() > 10 * 60000) return res.status(400).json({ status: false, message: "Messages can only be deleted within 10 minutes" });
  m.deletedAt = new Date(); await m.save();
  const t = await ChatThread.findById(m.thread).lean();
  for (const u of [t.client, t.therapistUser]) toUser(u, "deleted", { threadId: String(t._id), id: String(m._id) });
  toAdmins("deleted", { threadId: String(t._id), id: String(m._id) });
  res.json({ status: true });
});

/* ── phone notifications: POST /api/live-chat/push-subscribe { subscription } — saved against the signed-in user ── */
export const pushSubscribe = expressAsyncHandler(async (req, res) => {
  const sub = req.body?.subscription || req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return res.status(400).json({ status: false, message: "Invalid subscription" });
  await PushSubscription.updateOne({ "subscription.endpoint": String(sub.endpoint) }, { $set: { userId: req.user._id, subscription: { endpoint: String(sub.endpoint), expirationTime: sub.expirationTime || null, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } } } }, { upsert: true });
  res.json({ status: true });
});

/* ── therapist settings ── */
export const getSettings = expressAsyncHandler(async (req, res) => {
  if (req.user.role !== 1) return res.status(403).json({ status: false, message: "Therapists only" });
  res.json({ status: true, data: await settingsFor(req.user._id) });
});
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const saveSettings = expressAsyncHandler(async (req, res) => {
  if (req.user.role !== 1) return res.status(403).json({ status: false, message: "Therapists only" });
  const b = req.body || {};
  const set = {};
  if (typeof b.enabled === "boolean") set.enabled = b.enabled;
  if (HHMM.test(String(b.start || ""))) set.start = b.start;
  if (HHMM.test(String(b.end || ""))) set.end = b.end;
  if (Array.isArray(b.days)) set.days = [...new Set(b.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  if (typeof b.autoReply === "string") set.autoReply = maskContacts(b.autoReply.slice(0, 400)).text;
  const d = await ChatSettings.findOneAndUpdate({ therapistUser: req.user._id }, { $set: set, $setOnInsert: { therapistUser: req.user._id } }, { upsert: true, new: true }).lean();
  res.json({ status: true, data: d });
});

// GET /api/live-chat/therapist/:therapistId — is this therapist taking messages? (profile button; public)
export const therapistChatInfo = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.therapistId)) return res.status(400).json({ status: false, message: "Invalid therapist" });
  const th = await Therapists.findById(req.params.therapistId, { user: 1 }).lean();
  if (!th?.user) return res.status(404).json({ status: false, message: "Therapist not found" });
  const set = await settingsFor(th.user);
  res.json({ status: true, data: { enabled: set.enabled !== false, hours: hoursText(set), inHours: inOfficeHours(set) } });
});

/* ── live stream: /api/live-chat/stream?token=  (admins: &admin=1) ── */
async function adminAllowed(decoded) {
  if (decoded.role !== 2) return false;
  const admin = await Admin.findById(decoded.userId, { roleId: 1 }).lean();
  if (!admin) return false;
  if (!admin.roleId) return true;
  const role = await Role.findById(admin.roleId, { permissions: 1 }).lean();
  return ADMIN_PERM.some((k) => role?.permissions?.includes(k));
}
export const stream = async (req, res) => {
  let decoded;
  try { decoded = Jwt.verify(String(req.query.token || ""), process.env.JWT_SECRET, { algorithms: ["HS256"] }); }
  catch { return res.status(401).json({ status: false, message: "Not authorized" }); }
  const asAdmin = req.query.admin === "1";
  const ok = asAdmin ? await adminAllowed(decoded) : !!(decoded.userId && (decoded.role === 0 || decoded.role === 1));
  if (!ok) return res.status(403).json({ status: false, message: "Not allowed" });
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders?.();
  res.write("retry: 3000\n\n");
  res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  const remove = asAdmin ? addChatAdmin(res) : addChatClient(res, decoded.userId);
  req.on("close", remove);
};

/* ── admin: the complete record ── */
async function withNames(list) {
  const ids = [...new Set(list.filter(Boolean).flatMap((t) => [String(t.client), String(t.therapistUser)]))];
  const users = await Users.find({ _id: { $in: ids } }, { name: 1, email: 1, profile: 1 }).lean();
  const by = Object.fromEntries(users.map((u) => [String(u._id), u]));
  return list.filter(Boolean).map((t) => ({
    ...adminMeta(t), preview: dec(t.lastPreview), therapistId: String(t.therapist),
    client: { id: String(t.client), name: by[String(t.client)]?.name || "Client", email: by[String(t.client)]?.email || "", photo: by[String(t.client)]?.profile || "" },
    therapist: { id: String(t.therapistUser), name: by[String(t.therapistUser)]?.name || "Therapist", photo: by[String(t.therapistUser)]?.profile || "" },
  }));
}

export const adminThreads = expressAsyncHandler(async (req, res) => {
  const q = { lastMessageAt: { $ne: null } };
  if (req.query.filter === "crisis") q.crisisCount = { $gt: 0 };
  if (req.query.filter === "contact") q.contactCount = { $gt: 0 };
  if (req.query.filter === "waiting") { q.unreadTherapist = { $gt: 0 }; q.lastFrom = "client"; }
  const search = String(req.query.q || "").trim().slice(0, 60);
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const us = await Users.find({ $or: [{ name: rx }, { email: rx }] }, { _id: 1 }).limit(200).lean();
    const ids = us.map((u) => u._id);
    q.$or = [{ client: { $in: ids } }, { therapistUser: { $in: ids } }];
  }
  const list = await ChatThread.find(q).sort({ lastMessageAt: -1 }).limit(300).lean();
  res.json({ status: true, data: await withNames(list) });
});

export const adminThread = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid chat" });
  const t = await ChatThread.findById(req.params.id).lean();
  if (!t) return res.status(404).json({ status: false, message: "Chat not found" });
  if (!req.query.before) await ChatAccessLog.create({ admin: req.user._id, adminName: req.user.name || req.user.email || "", thread: t._id, ip: String(req.ip || "").slice(0, 60) });
  const q = { thread: t._id };
  if (req.query.before) { const d = new Date(String(req.query.before)); if (!Number.isNaN(d.getTime())) q.createdAt = { $lt: d }; }
  const msgs = await ChatMessage.find(q).sort({ createdAt: -1 }).limit(200).lean();
  const [row] = await withNames([t]);
  const st = await chatState(t.client, t.therapist);
  const opened = await ChatAccessLog.find({ thread: t._id }).sort({ createdAt: -1 }).limit(20).lean();
  res.json({ status: true, data: { thread: row, mode: st.mode, messages: msgs.reverse().map((m) => msgRow(m, true)), more: msgs.length === 200, accessLog: opened.map((a) => ({ name: a.adminName, at: a.createdAt })) } });
});

export const adminStats = expressAsyncHandler(async (req, res) => {
  const week = new Date(Date.now() - 7 * 864e5);
  const [threads, today, waiting, crisis7, contact7, avg] = await Promise.all([
    ChatThread.countDocuments({ lastMessageAt: { $ne: null } }),
    ChatMessage.countDocuments({ createdAt: { $gte: new Date(Date.now() - 864e5) }, fromRole: { $ne: "system" } }),
    ChatThread.countDocuments({ unreadTherapist: { $gt: 0 }, lastFrom: "client" }),
    ChatThread.countDocuments({ lastCrisisAt: { $gte: week } }),
    ChatThread.countDocuments({ contactCount: { $gt: 0 }, updatedAt: { $gte: week } }),
    ChatThread.aggregate([{ $match: { firstReplyMins: { $ne: null } } }, { $group: { _id: null, m: { $avg: "$firstReplyMins" } } }]),
  ]);
  res.json({ status: true, data: { threads, messagesToday: today, waiting, crisis7, contact7, avgFirstReplyMins: avg[0] ? Math.round(avg[0].m) : null } });
});

export const adminAccessLog = expressAsyncHandler(async (req, res) => {
  const list = await ChatAccessLog.find({}).sort({ createdAt: -1 }).limit(300).lean();
  const tids = [...new Set(list.map((a) => String(a.thread)))];
  const ts = await withNames(await ChatThread.find({ _id: { $in: tids } }).lean());
  const by = Object.fromEntries(ts.map((t) => [t._id, t]));
  res.json({ status: true, data: list.map((a) => ({ at: a.createdAt, admin: a.adminName, thread: String(a.thread), client: by[String(a.thread)]?.client?.name || "", therapist: by[String(a.thread)]?.therapist?.name || "" })) });
});
