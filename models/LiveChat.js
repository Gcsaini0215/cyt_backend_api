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
  therapistUser: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  therapist: { type: Schema.Types.ObjectId, ref: "Therapists", default: null },
  unreadAdmin: { type: Number, default: 0 }, // (support)
  lastPage: { type: String, default: "" }, // support: the page of the client's latest message // support chats: client messages the team hasn't opened yet
  // a therapist thread the CYT team opened from a support chat: open without a booking for 15 days
  assignedAt: { type: Date, default: null },
  assignedBy: { type: String, default: "" },
  assignedTherapist: { type: Schema.Types.ObjectId, ref: "Therapists", default: null }, // on the support thread: who CYT connected them with
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

export const ChatThread = mongoose.model("LiveChatThread", ChatThreadSchema);
export const ChatMessage = mongoose.model("LiveChatMessage", ChatMessageSchema);
export const ChatAccessLog = mongoose.model("LiveChatAccessLog", ChatAccessLogSchema);
export const ChatSettings = mongoose.model("LiveChatSettings", ChatSettingsSchema);
export const ChatConsent = mongoose.model("LiveChatConsent", ChatConsentSchema);
