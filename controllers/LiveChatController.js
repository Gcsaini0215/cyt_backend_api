import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Jwt from "jsonwebtoken";
import Users from "../models/Users.js";
import Admin from "../models/Admin.js";
import Role from "../models/Role.js";
import Therapists from "../models/Therapists.js";
import { ChatThread, ChatMessage, ChatAccessLog, ChatSettings, ChatConsent, ChatNote, ChatCanned } from "../models/LiveChat.js";
import Booking from "../models/Booking.js";
import Review from "../models/Review.js";
import { therapistUserId } from "../services/therapistNotify.js";
import { WorksheetLink } from "../models/Worksheet.js";
import { TOOLS as WORKSHEETS } from "./WorksheetController.js";
import { FREE_TESTS } from "../helper/assessmentTests.js";
import { getPricing } from "../helper/assessmentPricing.js";
import { encrypt, decrypt } from "../helper/googleMeet.js";
import { CRISIS, maskContacts, chatState, inOfficeHours, hoursText, OPEN_DAYS } from "../helper/chatRules.js";
import { addChatClient, addChatAdmin, toUser, toAdmins, isOnline, liveAdminIds } from "../services/chatHub.js";
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
/* admin phones (owner, 2026-11-25): a new Care Team message / a crisis rings the phones of admins who have Live Chats
   access and turned alerts on — except those with Live Chats open right now (they hear the chime there). */
async function adminAllowedId(id) {
  const admin = await Admin.findById(id, { roleId: 1 }).lean();
  if (!admin) return false;
  if (!admin.roleId) return true;
  const role = await Role.findById(admin.roleId, { permissions: 1 }).lean();
  return ADMIN_PERM.some((k) => role?.permissions?.includes(k));
}
async function pushAdmins(title, url, body = "New message · Tap to open Live Chats") {
  try {
    const live = liveAdminIds();
    const ids = [...new Set((await PushSubscription.find({ scope: "admin" }, { userId: 1 }).lean()).map((x) => String(x.userId)).filter((x) => x && !live.has(x)))];
    const ok = [];
    for (const id of ids) if (await adminAllowedId(id)) ok.push(id);
    if (ok.length) await pushToUsers({ scope: "admin", userId: { $in: ok } }, title, body, url);
  } catch { /* alerts are best-effort */ }
}

function phonePush(userId, title, url, body = "New message") {
  if (!userId || isOnline(userId)) return;
  pushToUsers({ userId }, title, body, url).catch(() => {});
}

const SUPPORT_NAME = "CYT Care Team";
const SUPPORT_HOURS = "every day, 9 AM – 9 PM";
const ASSIGN_DAYS = 15;
const msgRow = (m, forAdmin = false) => ({
  _id: String(m._id), thread: String(m.thread), fromRole: m.fromRole, kind: m.kind || "text",
  ...(m.fromRole === "admin" ? { fromName: forAdmin ? (m.fromName || SUPPORT_NAME) : SUPPORT_NAME } : {}),
  ...(forAdmin && m.page ? { page: m.page } : {}),
  body: m.deletedAt && !forAdmin ? "" : dec(m.body), deleted: !!m.deletedAt, masked: !!m.masked, crisis: !!m.crisis,
  readAt: m.readAt, createdAt: m.createdAt,
  ...(m.replyTo && m.replyTo.id ? { replyTo: { id: String(m.replyTo.id), body: dec(m.replyTo.body), fromRole: m.replyTo.fromRole } } : {}),
  ...(m.reactions && m.reactions.length ? { reactions: m.reactions.map((r) => ({ emoji: r.emoji, role: r.role, by: r.by })) } : {}),
  ...(m.editedAt ? { editedAt: m.editedAt } : {}),
  ...(m.meta ? { meta: m.meta } : {}),
  ...(forAdmin && m.history && m.history.length ? { history: m.history.map((h) => ({ body: dec(h.body), at: h.at })) } : {}),
});
// a reply quotes a message from the same chat (a short snippet is kept with it)
async function quoteOf(t, id) {
  if (!id || !isId(id)) return undefined;
  const q = await ChatMessage.findOne({ _id: id, thread: t._id }, { body: 1, fromRole: 1, deletedAt: 1 }).lean();
  if (!q || q.deletedAt || q.fromRole === "system") return undefined;
  return { id: q._id, body: encrypt(dec(q.body).slice(0, 140)), fromRole: q.fromRole };
}

async function settingsFor(therapistUser) {
  return (await ChatSettings.findOne({ therapistUser }).lean()) || { enabled: true, start: "10:00", end: "19:00", days: [1, 2, 3, 4, 5, 6], autoReply: "" };
}

// what the viewer may do in this thread right now
async function stateFor(t, role) {
  if (t.kind === "support") return { mode: "open", support: true, openUntil: null, closedAt: null, enabled: true, hours: SUPPORT_HOURS, inHours: true, canSend: true, note: "" };
  const st = await chatState(t.client, t.therapist);
  if (st.mode !== "open" && t.assignedAt && Date.now() - new Date(t.assignedAt).getTime() < ASSIGN_DAYS * 864e5) {
    st.mode = "open"; st.openUntil = new Date(new Date(t.assignedAt).getTime() + ASSIGN_DAYS * 864e5);
  }
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

const supFrom = (t) => (t.audience === "therapist" ? "therapist" : "client");

async function threadRow(t, role) {
  if (t.kind === "support") {
    const th = t.audience === "therapist";
    return {
      _id: String(t._id), support: true, audience: t.audience || "client",
      other: { id: "cyt", name: SUPPORT_NAME, photo: "", title: th ? "Profile, sessions, payouts — ask us anything" : "We'll help you find the right therapist", online: false, support: true },
      therapistId: null, lastMessageAt: t.lastMessageAt, lastFrom: t.lastFrom === "admin" ? (th ? "client" : "therapist") : t.lastFrom, preview: (clearedFor(t, "client") && t.lastMessageAt && new Date(t.lastMessageAt) <= clearedFor(t, "client") ? "" : dec(t.lastPreview)) || (th ? "Need help from the CYT team? Message us here." : "Not sure who to see? Message us — we'll help you choose."),
      unread: t.unreadClient,
      assigned: t.assignedThread ? { thread: String(t.assignedThread), name: t.assignedName || "your therapist", at: t.assignedOn || null } : null,
      rating: t.rating?.stars || null,
    };
  }
  const otherId = otherOf(t, role);
  const other = await Users.findById(otherId, { name: 1, profile: 1 }).lean();
  const th = role === "client" ? await Therapists.findById(t.therapist, { profile_type: 1 }).lean() : null;
  return {
    _id: String(t._id),
    other: { id: String(otherId), name: other?.name || (role === "client" ? "Therapist" : "Client"), photo: other?.profile || "", title: th?.profile_type || "", online: isOnline(otherId) },
    therapistId: String(t.therapist), lastMessageAt: t.lastMessageAt, lastFrom: t.lastFrom, preview: clearedFor(t, role) && t.lastMessageAt && new Date(t.lastMessageAt) <= clearedFor(t, role) ? "Chat cleared" : dec(t.lastPreview),
    unread: role === "therapist" ? t.unreadTherapist : t.unreadClient, assigned: !!t.assignedAt,
  };
}

// every client has a CYT Care Team chat (made on first use)
// therapists get one too — their line to the CYT team (owner, 2026-11-25)
async function supportThreadFor(clientId, audience = "client") {
  return ChatThread.findOneAndUpdate({ client: clientId, kind: "support" }, { $setOnInsert: { client: clientId, kind: "support", audience, therapistUser: null, therapist: null } }, { upsert: true, new: true }).lean();
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
  if (role === "client") {
    const sup = await supportThreadFor(req.user._id);
    const list = await ChatThread.find({ client: req.user._id, kind: { $ne: "support" }, lastMessageAt: { $ne: null }, $expr: { $gt: ["$lastMessageAt", { $ifNull: ["$clientHiddenAt", new Date(0)] }] } }).sort({ lastMessageAt: -1 }).limit(200).lean();
    // the Care Team chat stays pinned unless the client deleted it (then it comes back with the next message) — owner, 2026-11-24
    const supGone = sup && sup.clientHiddenAt && (!sup.lastMessageAt || new Date(sup.lastMessageAt) <= new Date(sup.clientHiddenAt));
    return res.json({ status: true, data: { role, threads: await Promise.all([...(supGone ? [] : [sup]), ...list].map((t) => threadRow(t, role))) } });
  }
  const list = await ChatThread.find({ therapistUser: req.user._id, lastMessageAt: { $ne: null }, $expr: { $gt: ["$lastMessageAt", { $ifNull: ["$therapistHiddenAt", new Date(0)] }] } }).sort({ lastMessageAt: -1 }).limit(200).lean();
  // the therapist's chat with the CYT team, pinned on top (unless they deleted it — it comes back with the next message)
  const sup = await supportThreadFor(req.user._id, "therapist");
  const supGone = sup && sup.clientHiddenAt && (!sup.lastMessageAt || new Date(sup.lastMessageAt) <= new Date(sup.clientHiddenAt));
  res.json({ status: true, data: { role, threads: await Promise.all([...(supGone ? [] : [sup]), ...list].map((t) => threadRow(t, t.kind === "support" ? "client" : role))) } });
});

export const unreadCount = expressAsyncHandler(async (req, res) => {
  const role = roleOf(req);
  const field = role === "therapist" ? "unreadTherapist" : "unreadClient";
  const q = role === "therapist" ? { therapistUser: req.user._id } : { client: req.user._id };
  // a chat this person deleted doesn't count (until a newer message brings it back)
  const hidden = role === "therapist" ? "$therapistHiddenAt" : "$clientHiddenAt";
  const r = await ChatThread.aggregate([{ $match: { ...q, kind: { $ne: "support" }, [field]: { $gt: 0 }, $expr: { $gt: ["$lastMessageAt", { $ifNull: [hidden, new Date(0)] }] } } }, { $group: { _id: null, n: { $sum: "$" + field }, threads: { $sum: 1 } } }]);
  let n = r[0]?.n || 0, threads = r[0]?.threads || 0;
  // the CYT Care Team chat (clients and therapists each have one)
  const sup = await ChatThread.findOne({ client: req.user._id, kind: "support", unreadClient: { $gt: 0 } }, { unreadClient: 1, lastMessageAt: 1, clientHiddenAt: 1 }).lean();
  if (sup && !(sup.clientHiddenAt && new Date(sup.lastMessageAt) <= new Date(sup.clientHiddenAt))) { n += sup.unreadClient; threads += 1; }
  res.json({ status: true, data: { count: n, threads } });
});

export const supportThread = expressAsyncHandler(async (req, res) => {
  if (req.user.role !== 0 && req.user.role !== 1) return res.status(403).json({ status: false, message: "Clients and therapists only" });
  const t = await supportThreadFor(req.user._id, req.user.role === 1 ? "therapist" : "client");
  res.json({ status: true, data: { id: String(t._id) } });
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

// the moment a side's view of a chat starts (after "Clear chat")
const clearedFor = (t, role) => {
  const mine = role === "therapist" ? t.therapistClearedAt : role === "admin" ? t.adminClearedAt : t.clientClearedAt;
  const all = role === "admin" ? null : t.allClearedAt;
  const ds = [mine, all].filter(Boolean).map((d) => new Date(d).getTime());
  return ds.length ? new Date(Math.max(...ds)) : null;
};

export const getThread = expressAsyncHandler(async (req, res) => {
  const t = await myThread(req, req.params.id);
  if (!t) return res.status(404).json({ status: false, message: "Chat not found" });
  const role = myRole(t, req);
  const q = { thread: t._id };
  if (req.query.before) { const d = new Date(String(req.query.before)); if (!Number.isNaN(d.getTime())) q.createdAt = { $lt: d }; }
  const since = clearedFor(t, role);
  if (since) q.createdAt = { ...(q.createdAt || {}), $gt: since };
  const msgs = await ChatMessage.find(q).sort({ createdAt: -1 }).limit(60).lean();
  res.json({ status: true, data: { thread: await threadRow(t, role), role, state: await stateFor(t, role), messages: msgs.reverse().map((m) => msgRow(m)), more: msgs.length === 60 } });
});

const adminMeta = (t) => (t ? {
  claimedBy: t.claimedBy ? String(t.claimedBy) : null, claimedName: t.claimedName || "", status: t.status || "open", resolvedName: t.resolvedName || "", rating: t.rating?.stars || null,
  _id: String(t._id), kind: t.kind || "therapist", audience: t.kind === "support" ? (t.audience || "client") : undefined, unreadAdmin: t.unreadAdmin || 0, lastPage: t.lastPage || "", assignedAt: t.assignedAt || null, lastMessageAt: t.lastMessageAt, lastFrom: t.lastFrom, messageCount: t.messageCount || 0,
  crisisCount: t.crisisCount || 0, contactCount: t.contactCount || 0, lastCrisisAt: t.lastCrisisAt, firstReplyMins: t.firstReplyMins,
  unreadTherapist: t.unreadTherapist || 0, createdAt: t.createdAt,
} : null);

async function addMessage(t, fromRole, from, body, extra = {}) {
  const m = await ChatMessage.create({ thread: t._id, from, fromRole, body: encrypt(body), ...extra });
  const inc = { messageCount: 1 };
  const reopen = t.kind === "support" && (fromRole === "client" || fromRole === "therapist") && t.status === "resolved";
  if (t.kind === "support") { if (fromRole === "client" || fromRole === "therapist") inc.unreadAdmin = 1; else inc.unreadClient = 1; }
  else { if (fromRole !== "therapist") inc.unreadTherapist = 1; if (fromRole !== "client") inc.unreadClient = 1; }
  if (extra.crisis) inc.crisisCount = 1;
  if (extra.masked) inc.contactCount = 1;
  const set = { lastMessageAt: m.createdAt, lastFrom: fromRole, lastPreview: encrypt(body.slice(0, 90)) };
  if (reopen) { set.status = "open"; set.resolvedAt = null; set.resolvedName = ""; }
  if (extra.crisis) set.lastCrisisAt = m.createdAt;
  const nt = await ChatThread.findByIdAndUpdate(t._id, { $inc: inc, $set: set }, { new: true }).lean();
  const row = msgRow(m);
  if (fromRole === "admin") row.fromName = SUPPORT_NAME;
  else if (from) row.fromName = (await Users.findById(from, { name: 1 }).lean())?.name || ""; // for the pop-up banner
  toUser(t.client, "message", { threadId: String(t._id), message: row });
  if (t.therapistUser) toUser(t.therapistUser, "message", { threadId: String(t._id), message: row });
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

  const crisis = CRISIS.test(raw);
  if (t.kind === "support") {
    // which page of the website they wrote from (the floating chat on every page sends it)
    const page = /^\/(?!\/)[\w\-./?=&%]{0,180}$/.test(String(req.body?.page || "")) ? String(req.body.page) : "";
    if (page) await ChatThread.updateOne({ _id: t._id }, { $set: { lastPage: page } });
    const th = t.audience === "therapist";
    // a therapist writing about a client's risk isn't in crisis themselves — no crisis banner on their own line to CYT
    const flag = crisis && !th;
    const { m } = await addMessage(t, supFrom(t), req.user._id, raw, { crisis: flag, kind: "text", page, replyTo: await quoteOf(t, req.body?.replyTo) });
    pushAdmins(`${flag ? "⚠ " : ""}${req.user.name || (th ? "A therapist" : "A client")}${th ? " · Therapist" : ""}`, `/chat-monitor?t=${t._id}`, flag ? "Urgent — may be at risk · Open Live Chats" : "New Care Team message");
    if (flag) await addMessage(t, "system", null, CRISIS_HELP.replace("your therapist has been told", "our team has been alerted"), { kind: "crisis-help" });
    if (!t.autoReplyAt || Date.now() - new Date(t.autoReplyAt).getTime() > 6 * 36e5) {
      await ChatThread.updateOne({ _id: t._id }, { $set: { autoReplyAt: new Date() } });
      await addMessage(t, "system", null, th
        ? "Thanks for writing to the CYT team. We'll reply soon (every day, 9 AM – 9 PM)."
        : "Thanks for writing to CYT. Someone from our care team will reply soon (every day, 9 AM – 9 PM) and help you find the right therapist.", { kind: "auto-reply" });
    }
    return res.json({ status: true, data: { message: msgRow(m), masked: false, crisis: flag } });
  }
  const { text, masked } = maskContacts(raw);
  const kind = st.mode === "pre" ? (role === "client" ? "pre-question" : "pre-answer") : "text";
  const { m } = await addMessage(t, role, req.user._id, text, { masked, crisis, kind, replyTo: await quoteOf(t, req.body?.replyTo) });

  if (role === "therapist" && t.firstReplyMins == null) {
    const first = await ChatMessage.findOne({ thread: t._id, fromRole: "client" }).sort({ createdAt: 1 }).lean();
    if (first) await ChatThread.updateOne({ _id: t._id }, { $set: { firstReplyMins: Math.round((m.createdAt - first.createdAt) / 60000) } });
  }

  if (role === "client") {
    if (crisis) {
      await addMessage(t, "system", null, CRISIS_HELP, { kind: "crisis-help" });
      pushAdmins(`⚠ ${req.user.name || "A client"}`, `/chat-monitor?t=${t._id}`, "Crisis words in a chat · Open Live Chats");
      notifyTherapists([t.therapistUser], { type: "action", title: `⚠ ${req.user.name || "A client"} may be at risk — please check the chat`, body: "Their message mentions self-harm. They were shown 112 and Tele-MANAS 14416.", link: `/therapists/messages?t=${t._id}`, ref: `chat-crisis:${m._id}` });
    } // ordinary messages: no bell notification — Messages + the chat button + phone push show them (owner, 2026-11-24)
    phonePush(t.therapistUser, `${crisis ? "⚠ " : ""}${req.user.name || "Your client"}`, `/therapists/messages?t=${t._id}`, crisis ? "Urgent message — please check the chat" : "New message");
    const set = await settingsFor(t.therapistUser);
    if (!inOfficeHours(set) && (!t.autoReplyAt || Date.now() - new Date(t.autoReplyAt).getTime() > 6 * 36e5)) {
      const msg = (set.autoReply || "").trim() || `Thanks for your message. I reply during my working hours (${hoursText(set)}). For an emergency, please call 112 or Tele-MANAS 14416.`;
      await ChatThread.updateOne({ _id: t._id }, { $set: { autoReplyAt: new Date() } });
      await addMessage(t, "system", null, msg, { kind: "auto-reply" });
    }
  } else {
    phonePush(t.client, req.user.name || "Your therapist", `/client/messages?t=${t._id}`);
  }
  res.json({ status: true, data: { message: msgRow(m), masked, crisis } });
});

export const markRead = expressAsyncHandler(async (req, res) => {
  const t = await myThread(req, req.params.id);
  if (!t) return res.status(404).json({ status: false, message: "Chat not found" });
  const role = myRole(t, req);
  const otherRoles = t.kind === "support" ? ["system", "admin"] : role === "therapist" ? ["client", "system"] : ["therapist", "system", "admin"];
  const now = new Date();
  await ChatMessage.updateMany({ thread: t._id, fromRole: { $in: otherRoles }, readAt: null }, { $set: { readAt: now } });
  await ChatThread.updateOne({ _id: t._id }, { $set: { [role === "therapist" ? "unreadTherapist" : "unreadClient"]: 0 } });
  if (otherOf(t, role)) toUser(otherOf(t, role), "read", { threadId: String(t._id), by: role, at: now });
  if (t.kind === "support") toAdmins("read", { threadId: String(t._id), by: role, at: now });
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
  for (const u of [t.client, t.therapistUser].filter(Boolean)) toUser(u, "deleted", { threadId: String(t._id), id: String(m._id) });
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

/* ── Phase C (owner, 2026-11-25): edit, reactions, booking card, search, rating ── */
const EMOJI = ["👍", "❤️", "😂", "🙏", "😮", "😢"];
const tellThread = (t, event, data) => {
  for (const u of [t.client, t.therapistUser].filter(Boolean)) toUser(u, event, data);
  toAdmins(event, data);
};
// PUT /api/live-chat/messages/:id { text } — change your own message within 10 minutes (the admin record keeps the earlier text)
export const editMessage = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid message" });
  const m = await ChatMessage.findOne({ _id: req.params.id, from: req.user._id, deletedAt: null });
  if (!m || !["client", "therapist"].includes(m.fromRole) || !["text", "pre-question", "pre-answer"].includes(m.kind || "text")) return res.status(404).json({ status: false, message: "Message not found" });
  if (Date.now() - m.createdAt.getTime() > 10 * 60000) return res.status(400).json({ status: false, message: "Messages can only be edited within 10 minutes" });
  const raw = String(req.body?.text || "").trim().slice(0, MAX_LEN);
  if (!raw) return res.status(400).json({ status: false, message: "Write a message first" });
  const t = await ChatThread.findById(m.thread).lean();
  const { text, masked } = t.kind === "support" ? { text: raw, masked: false } : maskContacts(raw);
  if (text === dec(m.body)) return res.json({ status: true, data: { message: msgRow(m) } });
  const newCrisis = !m.crisis && CRISIS.test(raw) && (m.fromRole === "client" || (t.kind === "support" && t.audience !== "therapist"));
  m.history = [...(m.history || []), { body: m.body, at: m.editedAt || m.createdAt }];
  m.body = encrypt(text); m.editedAt = new Date(); m.masked = m.masked || masked;
  if (newCrisis) m.crisis = true;
  await m.save();
  const row = msgRow(m);
  for (const u of [t.client, t.therapistUser].filter(Boolean)) toUser(u, "edited", { threadId: String(t._id), message: row });
  toAdmins("edited", { threadId: String(t._id), message: msgRow(m, true) });
  if (newCrisis) {
    // edited into words about self-harm: the same help + alerts as a new message
    await ChatThread.updateOne({ _id: t._id }, { $inc: { crisisCount: 1 }, $set: { lastCrisisAt: new Date() } });
    await addMessage(t, "system", null, t.kind === "support" ? CRISIS_HELP.replace("your therapist has been told", "our team has been alerted") : CRISIS_HELP, { kind: "crisis-help" });
    pushAdmins(`⚠ ${req.user.name || "A client"}`, `/chat-monitor?t=${t._id}`, "Crisis words in a chat · Open Live Chats");
    if (t.therapistUser) notifyTherapists([t.therapistUser], { type: "action", title: `⚠ ${req.user.name || "A client"} may be at risk — please check the chat`, body: "Their message mentions self-harm. They were shown 112 and Tele-MANAS 14416.", link: `/therapists/messages?t=${t._id}`, ref: `chat-crisis:${m._id}` });
  }
  res.json({ status: true, data: { message: row, masked } });
});
// POST /api/live-chat/messages/:id/react { emoji } — one reaction per person; the same emoji again takes it off
export const reactMessage = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid message" });
  const emoji = String(req.body?.emoji || "");
  if (!EMOJI.includes(emoji)) return res.status(400).json({ status: false, message: "Pick one of the reactions" });
  const m = await ChatMessage.findById(req.params.id);
  if (!m || m.deletedAt || m.fromRole === "system") return res.status(404).json({ status: false, message: "Message not found" });
  const t = await myThread(req, m.thread);
  if (!t) return res.status(404).json({ status: false, message: "Message not found" });
  const by = String(req.user._id);
  const had = (m.reactions || []).find((r) => r.by === by);
  m.reactions = (m.reactions || []).filter((r) => r.by !== by);
  if (!had || had.emoji !== emoji) m.reactions.push({ by, role: t.kind === "support" ? supFrom(t) : myRole(t, req), emoji });
  await m.save();
  const reactions = m.reactions.map((r) => ({ emoji: r.emoji, role: r.role, by: r.by }));
  tellThread(t, "react", { threadId: String(t._id), id: String(m._id), reactions });
  res.json({ status: true, data: { reactions } });
});
// POST /api/live-chat/threads/:id/booking-card — the therapist sends a "Book a slot" card (one an hour)
export const bookingCard = expressAsyncHandler(async (req, res) => {
  const t = await myThread(req, req.params.id);
  if (!t || t.kind === "support" || myRole(t, req) !== "therapist") return res.status(404).json({ status: false, message: "Chat not found" });
  if (t.bookingCardAt && Date.now() - new Date(t.bookingCardAt).getTime() < 36e5) return res.status(400).json({ status: false, message: "You sent a booking card less than an hour ago" });
  await ChatThread.updateOne({ _id: t._id }, { $set: { bookingCardAt: new Date() } });
  const name = req.user.name || "your therapist";
  const { m } = await addMessage(t, "therapist", req.user._id, `Book a session with ${name}`, { kind: "booking", meta: { therapistId: String(t.therapist), name, ...(await myCardFace(req, t)) } });
  phonePush(t.client, name, `/client/messages?t=${t._id}`, "Sent you a booking link");
  res.json({ status: true, data: { message: msgRow(m) } });
});
// GET /api/live-chat/threads/:id/search?q= (and the admin version) — messages are encrypted, so they're read and matched here
async function searchIn(t, q, since, forAdmin) {
  const needle = String(q || "").trim().toLowerCase().slice(0, 60);
  if (needle.length < 2) return [];
  const find = { thread: t._id, fromRole: { $ne: "system" }, ...(forAdmin ? {} : { deletedAt: null }) };
  if (since) find.createdAt = { $gt: since };
  const all = await ChatMessage.find(find, { body: 1, fromRole: 1, fromName: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(3000).lean();
  const out = [];
  for (const m of all) { const b = dec(m.body); if (b.toLowerCase().includes(needle)) { out.push({ _id: String(m._id), body: b.slice(0, 200), fromRole: m.fromRole, createdAt: m.createdAt }); if (out.length >= 50) break; } }
  return out;
}
export const searchThread = expressAsyncHandler(async (req, res) => {
  const t = await myThread(req, req.params.id);
  if (!t) return res.status(404).json({ status: false, message: "Chat not found" });
  res.json({ status: true, data: await searchIn(t, req.query.q, clearedFor(t, myRole(t, req)), false) });
});
export const adminSearchThread = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid chat" });
  const t = await ChatThread.findById(req.params.id).lean();
  if (!t) return res.status(404).json({ status: false, message: "Chat not found" });
  res.json({ status: true, data: await searchIn(t, req.query.q, null, true) });
});
// POST /api/live-chat/threads/:id/rate { stars } — the person rates the CYT team after a chat was resolved
export const rateThread = expressAsyncHandler(async (req, res) => {
  const t = await myThread(req, req.params.id);
  if (!t || t.kind !== "support") return res.status(404).json({ status: false, message: "Chat not found" });
  const stars = Math.round(Number(req.body?.stars));
  if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ status: false, message: "Pick 1 to 5 stars" });
  const ask = await ChatMessage.findOne({ thread: t._id, kind: "rate" }).sort({ createdAt: -1 });
  if (!ask) return res.status(400).json({ status: false, message: "Nothing to rate yet" });
  await ChatThread.updateOne({ _id: t._id }, { $set: { rating: { stars, at: new Date(), resolvedName: t.resolvedName || t.claimedName || "" } } });
  ask.meta = { ...(ask.meta || {}), stars }; ask.markModified("meta"); await ask.save();
  tellThread(t, "rated", { threadId: String(t._id), id: String(ask._id), stars });
  res.json({ status: true, data: { stars } });
});

/* ── Therapist's chat kit (owner, 2026-11-25): from the chat the therapist can ask for a review, send a booking link,
   a worksheet from their Toolkit, or a clinical assessment — the assessment at the price CYT has set (no change). ── */
// GET /api/live-chat/therapist-kit — what the "+" menu offers
// a placeholder picture (the sign-up default) is not a photo — cards show the initials instead
const realPhoto = (p) => (p && !/pngegg|default/i.test(p) ? p : "");
async function myCardFace(req, t) {
  const [u, th] = await Promise.all([Users.findById(req.user._id, { profile: 1 }).lean(), Therapists.findById(t.therapist, { profile_type: 1 }).lean()]);
  return { photo: realPhoto(u?.profile), title: th?.profile_type || "" };
}
export const therapistKit = expressAsyncHandler(async (req, res) => {
  if (req.user.role !== 1) return res.status(403).json({ status: false, message: "Therapists only" });
  const p = await getPricing();
  res.json({ status: true, data: {
    tools: Object.entries(WORKSHEETS).map(([key, name]) => ({ key, name })),
    tests: FREE_TESTS.filter((t) => p.tests[t.key]?.active !== false).map((t) => ({ key: t.key, short: t.short, title: t.title, price: p.tests[t.key]?.price ?? null, offer: !!p.tests[t.key]?.offer })),
  } });
});
// POST /api/live-chat/threads/:id/card { type: "review" | "tool" | "assessment", path?, tool? }
export const sendCard = expressAsyncHandler(async (req, res) => {
  const t = await myThread(req, req.params.id);
  if (!t || t.kind === "support" || myRole(t, req) !== "therapist") return res.status(404).json({ status: false, message: "Chat not found" });
  const name = req.user.name || "your therapist";
  const type = String(req.body?.type || "");
  let kind, body, meta, push;
  if (type === "review") {
    kind = "review"; body = `${name} would love a short review`; meta = { therapistId: String(t.therapist), name, ...(await myCardFace(req, t)) }; push = "Asked you for a short review";
  } else if (type === "tool") {
    const code = String(req.body?.path || "").match(/^\/worksheet\/([A-Za-z0-9_-]{4,40})$/)?.[1];
    const link = code ? await WorksheetLink.findOne({ code, therapistUser: req.user._id }, { tool: 1, note: 1, code: 1 }).lean() : null;
    if (!link) return res.status(400).json({ status: false, message: "Worksheet link not found" });
    kind = "tool"; body = `Worksheet: ${WORKSHEETS[link.tool] || "Worksheet"}`; meta = { path: `/worksheet/${link.code}`, name: WORKSHEETS[link.tool] || "Worksheet", note: link.note || "" }; push = "Sent you a worksheet";
  } else if (type === "assessment") {
    const test = FREE_TESTS.find((x) => x.key === req.body?.tool);
    const p = await getPricing();
    if (!test || p.tests[test.key]?.active === false) return res.status(400).json({ status: false, message: "Assessment not available" });
    kind = "assessment"; body = `Assessment: ${test.title} (${test.short})`; meta = { tool: test.key, short: test.short, title: test.title, price: p.tests[test.key]?.price ?? null }; push = "Sent you an assessment";
  } else return res.status(400).json({ status: false, message: "Unknown card" });
  const { m } = await addMessage(t, "therapist", req.user._id, body, { kind, meta });
  phonePush(t.client, name, `/client/messages?t=${t._id}`, push);
  res.json({ status: true, data: { message: msgRow(m) } });
});

// POST /api/live-chat/messages/:id/review { stars, text } — answer a review card from inside the chat (client)
export const reviewFromCard = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid card" });
  const m = await ChatMessage.findOne({ _id: req.params.id, kind: "review", deletedAt: null });
  if (!m) return res.status(404).json({ status: false, message: "Review card not found" });
  const t = await myThread(req, m.thread);
  if (!t || t.kind === "support" || myRole(t, req) !== "client") return res.status(404).json({ status: false, message: "Review card not found" });
  if (m.meta?.reviewed) return res.status(400).json({ status: false, message: "You've already reviewed from this card" });
  const stars = Math.round(Number(req.body?.stars));
  const text = String(req.body?.text || "").trim().slice(0, 1000);
  if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ status: false, message: "Pick 1 to 5 stars" });
  if (text.length < 3) return res.status(400).json({ status: false, message: "Write a few words about your sessions" });
  const u = await Users.findById(req.user._id, { name: 1, email: 1 }).lean();
  const review = await Review.create({ therapist_id: t.therapist, name: u?.name || "CYT client", email: u?.email || "client@chooseyourtherapist.in", rating: stars, description: text });
  m.meta = { ...(m.meta || {}), reviewed: stars, reviewText: text.slice(0, 300) }; m.markModified("meta"); await m.save();
  tellThread(t, "reviewed", { threadId: String(t._id), id: String(m._id), stars, text: text.slice(0, 300) });
  notifyTherapists([await therapistUserId(t.therapist).catch(() => null)], { type: "review", title: `New ${stars}★ review from ${u?.name || "a client"}`, body: text.slice(0, 160), link: "/therapists/reviews", ref: `review:${review._id}` });
  res.json({ status: true, data: { stars, text: text.slice(0, 300) } });
});

/* ── CYT Care Team's kit (owner, 2026-11-25): from a Care Team chat the team sends a therapist's card (photo, name,
   title — not a bare link), a clinical assessment at CYT's price, or the Noida centre. ── */
// GET /api/admin/live-chat/kit — the assessments with today's price
export const adminKit = expressAsyncHandler(async (req, res) => {
  const p = await getPricing();
  res.json({ status: true, data: { tests: FREE_TESTS.filter((t) => p.tests[t.key]?.active !== false).map((t) => ({ key: t.key, short: t.short, title: t.title, price: p.tests[t.key]?.price ?? null })) } });
});
// POST /api/admin/live-chat/threads/:id/card { type: "therapist" | "assessment" | "noida", therapistId?, tool? }
export const adminCard = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid chat" });
  const t = await ChatThread.findById(req.params.id).lean();
  if (!t || t.kind !== "support") return res.status(404).json({ status: false, message: "Cards go in Care Team chats" });
  const type = String(req.body?.type || "");
  let kind, body, meta, push;
  if (type === "therapist") {
    if (!isId(req.body?.therapistId)) return res.status(400).json({ status: false, message: "Choose a therapist" });
    const th = await Therapists.findOne({ _id: req.body.therapistId, show_to_page: { $in: [1, true] } }, { user: 1, profile_type: 1, state: 1 }).populate({ path: "user", select: "name profile" }).lean();
    if (!th?.user) return res.status(404).json({ status: false, message: "Therapist not found or not live" });
    kind = "therapist"; body = `${th.user.name}${th.profile_type ? ` — ${th.profile_type}` : ""}`;
    meta = { therapistId: String(th._id), name: th.user.name, title: th.profile_type || "", place: th.state || "", photo: realPhoto(th.user.profile) };
    push = `Suggested for you: ${th.user.name}`;
  } else if (type === "assessment") {
    const test = FREE_TESTS.find((x) => x.key === req.body?.tool);
    const p = await getPricing();
    if (!test || p.tests[test.key]?.active === false) return res.status(400).json({ status: false, message: "Assessment not available" });
    kind = "assessment"; body = `Assessment: ${test.title} (${test.short})`; meta = { tool: test.key, short: test.short, title: test.title, price: p.tests[test.key]?.price ?? null }; push = "Sent you an assessment";
  } else if (type === "noida") {
    kind = "noida"; body = "Meet a psychologist in person at the CYT Noida centre, Sector 51"; meta = {}; push = "The CYT Noida centre — book a time";
  } else return res.status(400).json({ status: false, message: "Unknown card" });
  const { m } = await addMessage(t, "admin", req.user._id, body, { kind, meta, fromName: req.user.name || req.user.email || "" });
  await ChatThread.updateOne({ _id: t._id }, { $set: { unreadAdmin: 0 } });
  if (!t.claimedBy) await setClaim(t._id, req.user);
  phonePush(t.client, SUPPORT_NAME, `${t.audience === "therapist" ? "/therapists/messages" : "/client/messages"}?t=${t._id}`, push);
  res.json({ status: true, data: { message: msgRow(m, true) } });
});

/* ── Phase B (owner, 2026-11-25): who's handling a chat, open / resolved, team notes, saved replies, context, team report ── */
const noteRow = (n) => ({ _id: String(n._id), body: dec(n.body), adminName: n.adminName || "Admin", admin: n.admin ? String(n.admin) : null, createdAt: n.createdAt });
const claimEvent = (t) => toAdmins("claim", { threadId: String(t._id), claimedBy: t.claimedBy ? String(t.claimedBy) : null, claimedName: t.claimedName || "", status: t.status || "open", resolvedName: t.resolvedName || "" });
async function setClaim(id, admin) {
  const t = await ChatThread.findByIdAndUpdate(id, { $set: admin ? { claimedBy: admin._id, claimedName: admin.name || admin.email || "Admin", claimedAt: new Date() } : { claimedBy: null, claimedName: "", claimedAt: null } }, { new: true }).lean();
  if (t) claimEvent(t);
  return t;
}
// POST /admin/live-chat/threads/:id/claim { on: true | false } — "I'm handling this" / let it go
export const adminClaim = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid chat" });
  const t = await setClaim(req.params.id, req.body?.on === false ? null : req.user);
  if (!t) return res.status(404).json({ status: false, message: "Chat not found" });
  res.json({ status: true, data: { claimedBy: t.claimedBy ? String(t.claimedBy) : null, claimedName: t.claimedName || "" } });
});
// POST /admin/live-chat/threads/:id/status { status: "open" | "resolved" }
export const adminStatus = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid chat" });
  const resolved = req.body?.status === "resolved";
  const t = await ChatThread.findByIdAndUpdate(req.params.id, { $set: resolved ? { status: "resolved", resolvedAt: new Date(), resolvedName: req.user.name || req.user.email || "Admin", unreadAdmin: 0 } : { status: "open", resolvedAt: null, resolvedName: "" } }, { new: true }).lean();
  if (!t) return res.status(404).json({ status: false, message: "Chat not found" });
  claimEvent(t);
  if (resolved && t.kind === "support" && (!t.rating?.at || Date.now() - new Date(t.rating.at).getTime() > 30 * 864e5)) {
    const asked = await ChatMessage.findOne({ thread: t._id, kind: "rate", createdAt: { $gte: new Date(Date.now() - 30 * 864e5) } }, { _id: 1 }).lean();
    if (!asked) await addMessage(t, "system", null, "How did the CYT Care Team do? Tap a star to let us know.", { kind: "rate", meta: { stars: null } });
  }
  res.json({ status: true, data: { status: t.status, resolvedName: t.resolvedName || "" } });
});
// POST /admin/live-chat/threads/:id/notes { body } · DELETE /admin/live-chat/notes/:id
export const adminAddNote = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid chat" });
  const body = String(req.body?.body || "").trim().slice(0, 1000);
  if (!body) return res.status(400).json({ status: false, message: "Write the note first" });
  if (!(await ChatThread.exists({ _id: req.params.id }))) return res.status(404).json({ status: false, message: "Chat not found" });
  const n = await ChatNote.create({ thread: req.params.id, admin: req.user._id, adminName: req.user.name || req.user.email || "Admin", body: encrypt(body) });
  const row = noteRow(n);
  toAdmins("note", { threadId: String(req.params.id), note: row });
  res.json({ status: true, data: row });
});
export const adminDeleteNote = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid note" });
  const n = await ChatNote.findByIdAndDelete(req.params.id).lean();
  if (!n) return res.status(404).json({ status: false, message: "Note not found" });
  toAdmins("note", { threadId: String(n.thread), deleted: String(n._id) });
  res.json({ status: true });
});
// saved replies: GET / POST /admin/live-chat/canned · PUT / DELETE /admin/live-chat/canned/:id
const cannedRow = (c) => ({ _id: String(c._id), title: c.title, body: c.body, order: c.order || 0 });
export const adminCannedList = expressAsyncHandler(async (req, res) => {
  res.json({ status: true, data: (await ChatCanned.find({}).sort({ order: 1, createdAt: 1 }).limit(100).lean()).map(cannedRow) });
});
const cannedIn = (b) => ({ title: String(b?.title || "").trim().slice(0, 60), body: String(b?.body || "").trim().slice(0, 2000) });
export const adminCannedSave = expressAsyncHandler(async (req, res) => {
  const v = cannedIn(req.body);
  if (!v.title || !v.body) return res.status(400).json({ status: false, message: "Add a short title and the reply" });
  if (req.params.id) {
    if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid reply" });
    const c = await ChatCanned.findByIdAndUpdate(req.params.id, { $set: v }, { new: true }).lean();
    if (!c) return res.status(404).json({ status: false, message: "Saved reply not found" });
    return res.json({ status: true, data: cannedRow(c) });
  }
  if ((await ChatCanned.countDocuments({})) >= 100) return res.status(400).json({ status: false, message: "Up to 100 saved replies" });
  const c = await ChatCanned.create({ ...v, createdName: req.user.name || "", order: Date.now() });
  res.json({ status: true, data: cannedRow(c) });
});
export const adminCannedDelete = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid reply" });
  await ChatCanned.deleteOne({ _id: req.params.id });
  res.json({ status: true });
});
// GET /admin/live-chat/threads/:id/context — who this is, at a glance (bookings), with links to Client / Therapist 360
export const adminContext = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid chat" });
  const t = await ChatThread.findById(req.params.id).lean();
  if (!t) return res.status(404).json({ status: false, message: "Chat not found" });
  const now = new Date();
  const person = await Users.findById(t.client, { name: 1, email: 1, phone: 1, createdAt: 1, role: 1 }).lean();
  const out = { person: person ? { id: String(person._id), name: person.name || "", email: person.email || "", phone: person.phone || "", since: person.createdAt || null } : null, kind: t.kind, audience: t.kind === "support" ? (t.audience || "client") : null };
  if (t.kind === "support" && t.audience === "therapist") {
    const th = await Therapists.findOne({ user: t.client }, { profile_type: 1, state: 1 }).lean();
    const [total, upcoming] = th ? await Promise.all([
      Booking.countDocuments({ therapist: th._id, payment_status: "Paid" }),
      Booking.countDocuments({ therapist: th._id, payment_status: "Paid", booking_date: { $gte: now } }),
    ]) : [0, 0];
    out.therapist = th ? { id: String(th._id), title: th.profile_type || "", place: th.state || "", paidSessions: total, upcoming } : null;
  } else {
    const list = await Booking.find({ client: t.client, payment_status: "Paid" }, { booking_date: 1, therapist: 1, status: 1 }).sort({ booking_date: -1 }).limit(200).populate({ path: "therapist", select: "user", populate: { path: "user", select: "name" } }).lean();
    const next = [...list].reverse().find((b) => new Date(b.booking_date) >= now);
    const last = list.find((b) => new Date(b.booking_date) < now);
    const names = [...new Set(list.map((b) => b.therapist?.user?.name).filter(Boolean))].slice(0, 5);
    out.client = {
      paidSessions: list.length,
      next: next ? { at: next.booking_date, with: next.therapist?.user?.name || "" } : null,
      last: last ? { at: last.booking_date, with: last.therapist?.user?.name || "" } : null,
      therapists: names,
    };
    if (t.kind === "therapist") {
      const th = await Therapists.findById(t.therapist, { user: 1 }).populate({ path: "user", select: "name" }).lean();
      out.chatTherapist = th ? { id: String(th._id), name: th.user?.name || "" } : null;
    }
  }
  res.json({ status: true, data: out });
});
// GET /admin/live-chat/team?days=7|30 — per admin: replies, chats, how fast the first reply came, chats resolved
export const adminTeam = expressAsyncHandler(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  const since = new Date(Date.now() - days * 864e5);
  const threads = await ChatThread.find({ kind: "support", lastMessageAt: { $gte: since } }, { _id: 1, audience: 1 }).limit(3000).lean();
  const ids = threads.map((t) => t._id);
  const msgs = await ChatMessage.find({ thread: { $in: ids }, createdAt: { $gte: since }, fromRole: { $in: ["client", "therapist", "admin"] } }, { thread: 1, fromRole: 1, fromName: 1, createdAt: 1 }).sort({ thread: 1, createdAt: 1 }).limit(50000).lean();
  const by = {}; // name -> { replies, chats:Set, waits:[] }
  const row = (n) => (by[n] = by[n] || { replies: 0, chats: new Set(), waits: [], resolved: 0 });
  let waiting = null, cur = null;
  for (const m of msgs) {
    const tid = String(m.thread);
    if (tid !== cur) { cur = tid; waiting = null; }
    if (m.fromRole === "admin") {
      const r = row(m.fromName || "Admin");
      r.replies += 1; r.chats.add(tid);
      if (waiting) { r.waits.push((new Date(m.createdAt) - new Date(waiting)) / 60000); waiting = null; }
    } else if (!waiting) waiting = m.createdAt; // the person wrote; the clock runs until the team replies
  }
  const resolved = await ChatThread.aggregate([{ $match: { kind: "support", status: "resolved", resolvedAt: { $gte: since } } }, { $group: { _id: "$resolvedName", n: { $sum: 1 } } }]);
  for (const x of resolved) row(x._id || "Admin").resolved = x.n;
  const rated = await ChatThread.aggregate([{ $match: { kind: "support", "rating.at": { $gte: since } } }, { $group: { _id: "$rating.resolvedName", avg: { $avg: "$rating.stars" }, n: { $sum: 1 } } }]);
  for (const x of rated) { const r = row(x._id || "Admin"); r.rating = Math.round(x.avg * 10) / 10; r.ratings = x.n; }
  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const h = Math.floor(s.length / 2); return Math.round(s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2); };
  const data = Object.entries(by).map(([name, r]) => ({ name, replies: r.replies, chats: r.chats.size, resolved: r.resolved, medianReplyMins: median(r.waits), answered: r.waits.length, rating: r.rating || null, ratings: r.ratings || 0 })).sort((a, b) => b.replies - a.replies);
  const unanswered = await ChatThread.countDocuments({ kind: "support", unreadAdmin: { $gt: 0 } });
  res.json({ status: true, data: { days, team: data, waitingNow: unanswered } });
});

/* ── "typing…" (owner, 2026-11-25): POST /api/live-chat/threads/:id/typing — sent every few seconds while typing ── */
export const typing = expressAsyncHandler(async (req, res) => {
  const t = await myThread(req, req.params.id);
  if (!t) return res.status(404).json({ status: false });
  if (t.kind === "support") toAdmins("typing", { threadId: String(t._id), by: supFrom(t) });
  else { const role = myRole(t, req); const o = otherOf(t, role); if (o) toUser(o, "typing", { threadId: String(t._id), by: role }); }
  res.json({ status: true });
});
// POST /api/admin/live-chat/threads/:id/typing — the team is writing a reply (Care Team chats)
export const adminTyping = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false });
  const t = await ChatThread.findById(req.params.id, { client: 1, kind: 1 }).lean();
  if (t?.kind === "support") {
    toUser(t.client, "typing", { threadId: String(t._id), by: "admin" });
    toAdmins("typing", { threadId: String(t._id), by: "admin", adminId: String(req.user._id), name: req.user.name || "" });
  }
  res.json({ status: true });
});
// POST /api/admin/live-chat/push-subscribe { subscription } — this admin's phone gets Live Chats alerts
export const adminPushSubscribe = expressAsyncHandler(async (req, res) => {
  const sub = req.body?.subscription || req.body;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return res.status(400).json({ status: false, message: "Invalid subscription" });
  await PushSubscription.updateOne({ "subscription.endpoint": String(sub.endpoint) }, { $set: { userId: req.user._id, scope: "admin", subscription: { endpoint: String(sub.endpoint), expirationTime: sub.expirationTime || null, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) } } } }, { upsert: true });
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
  const remove = asAdmin ? addChatAdmin(res, decoded.userId) : addChatClient(res, decoded.userId);
  req.on("close", remove);
};

/* ── admin: the complete record ── */
async function withNames(list) {
  const ids = [...new Set(list.filter(Boolean).flatMap((t) => [String(t.client), t.therapistUser ? String(t.therapistUser) : null]).filter(Boolean))];
  const users = await Users.find({ _id: { $in: ids } }, { name: 1, email: 1, profile: 1 }).lean();
  const by = Object.fromEntries(users.map((u) => [String(u._id), u]));
  return list.filter(Boolean).map((t) => ({
    ...adminMeta(t), preview: dec(t.lastPreview), therapistId: String(t.therapist),
    client: { id: String(t.client), name: by[String(t.client)]?.name || "Client", email: by[String(t.client)]?.email || "", photo: by[String(t.client)]?.profile || "" },
    therapist: t.kind === "support" ? { id: "cyt", name: SUPPORT_NAME, photo: "", support: true } : { id: String(t.therapistUser), name: by[String(t.therapistUser)]?.name || "Therapist", photo: by[String(t.therapistUser)]?.profile || "" },
  }));
}

export const adminThreads = expressAsyncHandler(async (req, res) => {
  // a chat the admin deleted "for me" stays out of the list until a newer message arrives
  const q = { lastMessageAt: { $ne: null }, $expr: { $gt: ["$lastMessageAt", { $ifNull: ["$adminHiddenAt", new Date(0)] }] } };
  if (req.query.filter === "crisis") q.crisisCount = { $gt: 0 };
  if (req.query.filter === "contact") q.contactCount = { $gt: 0 };
  if (req.query.filter === "waiting") { q.$and = [{ $or: [{ kind: "support", unreadAdmin: { $gt: 0 } }, { kind: { $ne: "support" }, unreadTherapist: { $gt: 0 }, lastFrom: { $in: ["client", "system"] } }] }]; } // after an auto-reply lastFrom is "system"
  if (req.query.filter === "support") { q.kind = "support"; q.audience = { $ne: "therapist" }; }
  if (req.query.filter === "therapists") { q.kind = "support"; q.audience = "therapist"; }
  if (req.query.filter === "open") { q.kind = "support"; q.status = { $ne: "resolved" }; }
  if (req.query.filter === "resolved") { q.kind = "support"; q.status = "resolved"; }
  if (req.query.filter === "mine") q.claimedBy = req.user._id;
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
  if (t.kind === "support" && t.unreadAdmin) await ChatThread.updateOne({ _id: t._id }, { $set: { unreadAdmin: 0 } });
  if (!req.query.before) await ChatAccessLog.create({ admin: req.user._id, adminName: req.user.name || req.user.email || "", thread: t._id, ip: String(req.ip || "").slice(0, 60) });
  const q = { thread: t._id };
  if (req.query.before) { const d = new Date(String(req.query.before)); if (!Number.isNaN(d.getTime())) q.createdAt = { $lt: d }; }
  if (t.adminClearedAt && req.query.all !== "1") q.createdAt = { ...(q.createdAt || {}), $gt: t.adminClearedAt };
  const hiddenCount = t.adminClearedAt && req.query.all !== "1" ? await ChatMessage.countDocuments({ thread: t._id, createdAt: { $lte: t.adminClearedAt } }) : 0;
  const msgs = await ChatMessage.find(q).sort({ createdAt: -1 }).limit(200).lean();
  const [row] = await withNames([t]);
  const st = t.kind === "support" ? { mode: "support" } : await chatState(t.client, t.therapist);
  let assigned = null;
  if (t.kind === "support" && t.assignedTherapist) {
    const th = await Therapists.findById(t.assignedTherapist, { user: 1, profile_type: 1 }).populate({ path: "user", select: "name" }).lean();
    if (th) assigned = { id: String(th._id), name: th.user?.name || "Therapist", title: th.profile_type || "" };
  }
  const opened = await ChatAccessLog.find({ thread: t._id }).sort({ createdAt: -1 }).limit(20).lean();
  const notes = await ChatNote.find({ thread: t._id }).sort({ createdAt: 1 }).limit(200).lean();
  res.json({ status: true, data: { thread: row, mode: st.mode, messages: msgs.reverse().map((m) => msgRow(m, true)), more: msgs.length === 200, hiddenCount, allClearedAt: t.allClearedAt || null, assigned, notes: notes.map(noteRow), accessLog: opened.map((a) => ({ name: a.adminName, at: a.createdAt })) } });
});

export const adminStats = expressAsyncHandler(async (req, res) => {
  const week = new Date(Date.now() - 7 * 864e5);
  const [threads, today, waiting, crisis7, contact7, avg] = await Promise.all([
    ChatThread.countDocuments({ lastMessageAt: { $ne: null } }),
    ChatMessage.countDocuments({ createdAt: { $gte: new Date(Date.now() - 864e5) }, fromRole: { $ne: "system" } }),
    ChatThread.countDocuments({ $or: [{ kind: "support", unreadAdmin: { $gt: 0 } }, { kind: { $ne: "support" }, unreadTherapist: { $gt: 0 }, lastFrom: { $in: ["client", "system"] } }] }),
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


/* ── admin: CYT Care Team replies + connecting a client with a therapist (2026-11-23, owner) ── */
// POST /api/admin/live-chat/threads/:id/messages { text } — Care Team chats only
export const adminReply = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid chat" });
  const t = await ChatThread.findById(req.params.id).lean();
  if (!t || t.kind !== "support") return res.status(404).json({ status: false, message: "Only Care Team chats can be answered here" });
  const text = String(req.body?.text || "").trim().slice(0, MAX_LEN);
  if (!text) return res.status(400).json({ status: false, message: "Write a message first" });
  const { m } = await addMessage(t, "admin", req.user._id, text, { kind: "text", fromName: req.user.name || req.user.email || "", replyTo: await quoteOf(t, req.body?.replyTo) });
  await ChatThread.updateOne({ _id: t._id }, { $set: { unreadAdmin: 0 } });
  if (!t.claimedBy) await setClaim(t._id, req.user);
  phonePush(t.client, SUPPORT_NAME, `${t.audience === "therapist" ? "/therapists/messages" : "/client/messages"}?t=${t._id}`);
  res.json({ status: true, data: { message: msgRow(m, true) } });
});

// GET /api/admin/live-chat/therapists?q= — live therapists to connect a client with
export const adminTherapists = expressAsyncHandler(async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 60);
  let userIds = null;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    userIds = (await Users.find({ role: 1, $or: [{ name: rx }, { email: rx }] }, { _id: 1 }).limit(100).lean()).map((u) => u._id);
  }
  const list = await Therapists.find({ ...(userIds ? { user: { $in: userIds } } : {}), show_to_page: { $in: [1, true] } }, { user: 1, profile_type: 1, state: 1 })
    .populate({ path: "user", select: "name profile" }).limit(30).lean();
  res.json({ status: true, data: list.filter((t) => t.user).map((t) => ({ id: String(t._id), name: t.user.name, photo: t.user.profile || "", title: t.profile_type || "", place: t.state || "" })) });
});

// POST /api/admin/live-chat/threads/:id/assign { therapistId } — opens a therapist chat for this client
// (no booking needed for ${ASSIGN_DAYS} days), tells both of them, and notes it in the Care Team chat
export const adminAssign = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id) || !isId(req.body?.therapistId)) return res.status(400).json({ status: false, message: "Invalid request" });
  const sup = await ChatThread.findById(req.params.id).lean();
  if (!sup || sup.kind !== "support") return res.status(404).json({ status: false, message: "Care Team chat not found" });
  if (sup.audience === "therapist") return res.status(400).json({ status: false, message: "This is a therapist's chat with the CYT team" });
  const th = await Therapists.findById(req.body.therapistId, { user: 1, profile_type: 1 }).populate({ path: "user", select: "name" }).lean();
  if (!th?.user) return res.status(404).json({ status: false, message: "Therapist not found" });
  const client = await Users.findById(sup.client, { name: 1 }).lean();
  const by = req.user.name || req.user.email || "CYT";
  const t = await ChatThread.findOneAndUpdate(
    { client: sup.client, therapistUser: th.user._id },
    { $set: { assignedAt: new Date(), assignedBy: by, kind: "therapist" }, $setOnInsert: { client: sup.client, therapistUser: th.user._id, therapist: th._id } },
    { upsert: true, new: true },
  ).lean();
  const tname = th.user.name || "your therapist";
  await ChatThread.updateOne({ _id: sup._id }, { $set: { assignedTherapist: th._id, assignedThread: t._id, assignedName: tname, assignedOn: new Date() } });
  await addMessage(sup, "admin", null, `We've connected you with ${tname}${th.profile_type ? ` (${th.profile_type})` : ""}. You can message them now from your Messages — and book a session when you're ready.`, { kind: "text", fromName: by });
  await addMessage(t, "system", null, `CYT Care Team connected ${client?.name || "this client"} with ${tname}. Messages are open for ${ASSIGN_DAYS} days, and stay open once a session is booked.`, { kind: "assigned" });
  notifyTherapists([th.user._id], { type: "action", title: `CYT connected you with ${client?.name || "a new client"}`, body: "Please say hello in Messages — they're looking for support.", link: `/therapists/messages?t=${t._id}`, ref: `chat-assign:${t._id}:${Date.now()}` });
  phonePush(th.user._id, client?.name || "New client", `/therapists/messages?t=${t._id}`, "New client from CYT — say hello");
  notifyClient(sup.client, { type: "message", title: `You're connected with ${tname}`, body: "Open Messages to say hello.", link: `/client/messages?t=${t._id}`, ref: `chat-assign:${t._id}:${Date.now()}` });
  phonePush(sup.client, tname, `/client/messages?t=${t._id}`, "You're connected — say hello");
  toUser(sup.client, "assigned", { supportId: String(sup._id), threadId: String(t._id), name: tname });
  res.json({ status: true, data: { thread: String(t._id), therapist: { id: String(th._id), name: tname, title: th.profile_type || "" } } });
});


/* ── Clear chat (2026-11-23, owner): "for me" or "for everyone". Messages stay in the admin record. ── */
async function clearThread(t, role, scope, byName) {
  const now = new Date();
  if (scope === "all") {
    await ChatThread.updateOne({ _id: t._id }, { $set: { allClearedAt: now, [role === "admin" ? "adminClearedAt" : role === "therapist" ? "therapistClearedAt" : "clientClearedAt"]: now, unreadClient: 0, unreadTherapist: 0 } });
    const who = role === "admin" ? SUPPORT_NAME : role === "therapist" ? "your therapist" : "the client";
    // a marker both sides see, written just after the clear so it shows
    await new Promise((r) => setTimeout(r, 5));
    await addMessage(t, "system", null, `Chat cleared for everyone by ${who}.`, { kind: "cleared", fromName: byName || "" });
    for (const u of [t.client, t.therapistUser].filter(Boolean)) toUser(u, "cleared", { threadId: String(t._id), scope: "all" });
    toAdmins("cleared", { threadId: String(t._id), scope: "all" });
  } else {
    const field = role === "admin" ? "adminClearedAt" : role === "therapist" ? "therapistClearedAt" : "clientClearedAt";
    await ChatThread.updateOne({ _id: t._id }, { $set: { [field]: now, ...(role === "therapist" ? { unreadTherapist: 0 } : role === "client" ? { unreadClient: 0 } : { unreadAdmin: 0 }) } });
  }
  return now;
}

// POST /api/live-chat/threads/:id/clear { scope: "me" | "all" }
export const clearChat = expressAsyncHandler(async (req, res) => {
  const t = await myThread(req, req.params.id);
  if (!t) return res.status(404).json({ status: false, message: "Chat not found" });
  const scope = req.body?.scope === "all" ? "all" : "me";
  const role = myRole(t, req);
  const at = await clearThread(t, role, scope, req.user.name || "");
  if (req.body?.remove) {
    const now = new Date(Date.now() + 1000); // after the "cleared" note clearThread may have added
    const set = scope === "all" ? { clientHiddenAt: now, therapistHiddenAt: now } : { [`${role}HiddenAt`]: now };
    await ChatThread.updateOne({ _id: t._id }, { $set: set });
    const who = scope === "all" ? [t.client, t.therapistUser] : [req.user._id];
    for (const u of who.filter(Boolean)) toUser(u, "cleared", { threadId: String(t._id), scope: "removed" });
  }
  res.json({ status: true, data: { scope, at, removed: !!req.body?.remove } });
});

// POST /api/admin/live-chat/threads/:id/clear { scope: "me" | "all" }
/* Delete a whole chat from Live Chats (owner, 2026-11-24).
   scope "me"  — gone from the admin's list only; the client / therapist keep it; a new message brings it back.
   scope "all" — the chat and all its messages are removed for good, for everyone. Only the access-log line remains. */
export const adminDelete = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid chat" });
  const t = await ChatThread.findById(req.params.id).lean();
  if (!t) return res.status(404).json({ status: false, message: "Chat not found" });
  const scope = req.body?.scope === "all" ? "all" : "me";
  const by = req.user.name || req.user.email || "";
  if (scope === "all") {
    await ChatMessage.deleteMany({ thread: t._id });
    await ChatThread.deleteOne({ _id: t._id });
    for (const u of [t.client, t.therapistUser].filter(Boolean)) toUser(u, "cleared", { threadId: String(t._id), scope: "deleted" });
  } else {
    await ChatThread.updateOne({ _id: t._id }, { $set: { adminHiddenAt: new Date() } });
  }
  toAdmins("cleared", { threadId: String(t._id), scope: scope === "all" ? "deleted" : "hidden" });
  await ChatAccessLog.create({ admin: req.user._id, adminName: by, thread: t._id, action: scope === "all" ? "delete-all" : "delete-me", ip: String(req.ip || "").slice(0, 60) });
  res.json({ status: true, data: { scope } });
});

export const adminClear = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid chat" });
  const t = await ChatThread.findById(req.params.id).lean();
  if (!t) return res.status(404).json({ status: false, message: "Chat not found" });
  const scope = req.body?.scope === "all" ? "all" : "me";
  const at = await clearThread(t, "admin", scope, req.user.name || req.user.email || "");
  await ChatAccessLog.create({ admin: req.user._id, adminName: req.user.name || req.user.email || "", thread: t._id, action: scope === "all" ? "clear-all" : "clear-me", ip: String(req.ip || "").slice(0, 60) });
  res.json({ status: true, data: { scope, at } });
});
