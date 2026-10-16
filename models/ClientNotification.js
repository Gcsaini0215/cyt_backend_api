import mongoose from "mongoose";
const { model, Schema } = mongoose;

// One row per alert shown in the client portal's bell (session confirmed, therapist joined, starting
// soon, rescheduled, completed, cancelled, referral credit). Written by services/clientNotify.js,
// which also pushes it live to any open portal tab of that client.
const ClientNotificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true }, // the client's Users _id
    type: { type: String, required: true }, // booking | joined | soon | rescheduled | completed | cancelled | referral
    title: { type: String, required: true },
    body: { type: String, default: "" },
    link: { type: String, default: "" },
    ref: { type: String, default: "" }, // e.g. "booking:<id>" — the same event is never stored twice
    read_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
ClientNotificationSchema.index({ user: 1, createdAt: -1 });
ClientNotificationSchema.index({ user: 1, ref: 1, type: 1 });

export default model("ClientNotification", ClientNotificationSchema);
