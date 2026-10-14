import mongoose from "mongoose";
const { model, Schema } = mongoose;

// One row per alert shown in the therapist portal's bell (new booking, client joined, review, notice…).
// Written by services/therapistNotify.js, which also pushes it live to any open portal tab.
const TherapistNotificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "Users", required: true }, // the therapist's Users _id
    type: { type: String, required: true }, // booking | joined | cancelled | review | session | notice | action | payout | reply
    title: { type: String, required: true },
    body: { type: String, default: "" },
    link: { type: String, default: "" },
    ref: { type: String, default: "" }, // e.g. "booking:<id>" — the same event is never stored twice
    read_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
TherapistNotificationSchema.index({ user: 1, createdAt: -1 });
TherapistNotificationSchema.index({ user: 1, ref: 1, type: 1 });

export default model("TherapistNotification", TherapistNotificationSchema);
