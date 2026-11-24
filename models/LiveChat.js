import mongoose from "mongoose";
const { Schema } = mongoose;

/* Live therapist ↔ client chat (2026-11-23, owner). Separate from the old models/ChatMessage.js (routes/chat.js). One thread per client–therapist pair.
   Message text is encrypted at rest (helper/googleMeet.js encrypt). Messages are never edited; a deleted one
   keeps its record with deletedAt (the admin record stays complete). Admins with page:/chat-monitor can read
   threads; every such opening is written to ChatAccessLog. */

const ChatThreadSchema = new Schema({
  client: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  // "therapist": client ↔ therapist. "support": client ↔ CYT Care Team (admins answer; no therapist) — 2026-11-23
  kind: { type: String, enum: ["therapist", "support"], default: "therapist", index: true },
  // support chats: who is talking to the CYT team — a client, or a therapist (owner, 2026-11-25). The person is always
  // stored in "client"; a therapist's own messages are saved as fromRole "therapist".
  audience: { type: String, enum: ["client", "therapist"], default: "client" },
  therapistUser: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  therapist: { type: Schema.Types.ObjectId, ref: "Therapists", default: null },
  unreadAdmin: { type: Number, default: 0 }, // (support)
  lastPage: { type: String, default: "" }, // support: the page of the client's latest message
  // "Clear chat" (2026-11-23): each side can clear for themselves; "for everyone" hides older messages for both.
  // Messages are never removed — the admin record keeps them.
  clientClearedAt: { type: Date, default: null },
  therapistClearedAt: { type: Date, default: null },
  adminClearedAt: { type: Date, default: null },
  adminHiddenAt: { type: Date, default: null },
  // who in the team is handling this chat, and is it done (Phase B, 2026-11-25)
  claimedBy: { type: Schema.Types.ObjectId, default: null },
  claimedName: { type: String, default: "" },
  claimedAt: { type: Date, default: null },
  status: { type: String, enum: ["open", "resolved"], default: "open" },
  resolvedAt: { type: Date, default: null },
  resolvedName: { type: String, default: "" },
  clientHiddenAt: { type: Date, default: null }, // client / therapist deleted the chat from their own list (CYT's record keeps it)
  therapistHiddenAt: { type: Date, default: null }, // admin deleted the chat from their Live Chats list; a newer message brings it back
  allClearedAt: { type: Date, default: null },
  // a therapist thread the CYT team opened from a support chat: open without a booking for 15 days
  assignedAt: { type: Date, default: null },
  assignedBy: { type: String, default: "" },
  assignedTherapist: { type: Schema.Types.ObjectId, ref: "Therapists", default: null },
  assignedThread: { type: Schema.Types.ObjectId, default: null }, // on the support thread: the chat with that therapist
  assignedName: { type: String, default: "" },
  assignedOn: { type: Date, default: null }, // when CYT connected them (the widget starts fresh from here) // on the support thread: who CYT connected them with
  lastMessageAt: { type: Date, default: null, index: true },
  lastFrom: { type: String, default: "" }, // client | therapist | system
  lastPreview: { type: String, default: "" }, // encrypted, short
  unreadClient: { type: Number, default: 0 },
  unreadTherapist: { type: Number, default: 0 },
  messageCount: { type: Number, default: 0 },
  crisisCount: { type: Number, default: 0 },
  contactCount: { type: Number, default: 0 }, // phone / email / links hidden
  lastCrisisAt: { type: Date, default: null },
  firstReplyMins: { type: Number, default: null }, // therapist's first reply, minutes after the client's first message
  autoReplyAt: { type: Date, default: null }, // last "outside office hours" auto-reply
}, { timestamps: true });
ChatThreadSchema.index({ client: 1, therapistUser: 1 }, { unique: true });

const ChatMessageSchema = new Schema({
  thread: { type: Schema.Types.ObjectId, ref: "LiveChatThread", required: true, index: true },
  from: { type: Schema.Types.ObjectId, ref: "User", default: null },
  fromRole: { type: String, enum: ["client", "therapist", "system", "admin"], required: true },
  fromName: { type: String, default: "" }, // admin replies: which team member wrote it (shown to admins only)
  page: { type: String, default: "" }, // Care Team chats: the website page the client wrote from (e.g. /therapy-for/anxiety)
  body: { type: String, required: true }, // encrypted (what was shown, after hiding contact details)
  kind: { type: String, default: "text" }, // text | auto-reply | crisis-help | pre-question | pre-answer
  masked: { type: Boolean, default: false },
  crisis: { type: Boolean, default: false },
  readAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });
ChatMessageSchema.index({ thread: 1, createdAt: -1 });

const ChatAccessLogSchema = new Schema({
  admin: { type: Schema.Types.ObjectId, ref: "Admin", required: true },
  adminName: { type: String, default: "" },
  thread: { type: Schema.Types.ObjectId, ref: "LiveChatThread", required: true, index: true },
  action: { type: String, default: "open" },
  ip: { type: String, default: "" },
}, { timestamps: true });

const ChatSettingsSchema = new Schema({
  therapistUser: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  enabled: { type: Boolean, default: true },
  start: { type: String, default: "10:00" }, // IST, HH:MM
  end: { type: String, default: "19:00" },
  days: { type: [Number], default: [1, 2, 3, 4, 5, 6] }, // 0 = Sunday
  autoReply: { type: String, default: "" },
}, { timestamps: true });

const ChatConsentSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  version: { type: Number, default: 1 },
  ip: { type: String, default: "" },
}, { timestamps: true });

// notes only the team sees, on a chat (never shown to the client / therapist)
const ChatNoteSchema = new Schema({
  thread: { type: Schema.Types.ObjectId, required: true, index: true },
  admin: { type: Schema.Types.ObjectId, default: null },
  adminName: { type: String, default: "" },
  body: { type: String, required: true }, // encrypted
}, { timestamps: true });
// saved replies the team inserts with one tap
const ChatCannedSchema = new Schema({
  title: { type: String, required: true, maxlength: 60 },
  body: { type: String, required: true, maxlength: 2000 },
  createdName: { type: String, default: "" },
  order: { type: Number, default: 0 },
}, { timestamps: true });

export const ChatThread = mongoose.model("LiveChatThread", ChatThreadSchema);
export const ChatNote = mongoose.model("LiveChatNote", ChatNoteSchema);
export const ChatCanned = mongoose.model("LiveChatCanned", ChatCannedSchema);
export const ChatMessage = mongoose.model("LiveChatMessage", ChatMessageSchema);
export const ChatAccessLog = mongoose.model("LiveChatAccessLog", ChatAccessLogSchema);
export const ChatSettings = mongoose.model("LiveChatSettings", ChatSettingsSchema);
export const ChatConsent = mongoose.model("LiveChatConsent", ChatConsentSchema);
