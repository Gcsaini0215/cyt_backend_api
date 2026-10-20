import mongoose from "mongoose";
const { Schema, model } = mongoose;

// a therapist's "come back for a session" nudge to a past client (email sent by CYT, or WhatsApp opened)
const FollowupNudgeSchema = new Schema({
  therapist: { type: Schema.Types.ObjectId, ref: "Therapists", required: true },
  client: { type: Schema.Types.ObjectId, ref: "User", required: true },
  channel: { type: String, enum: ["email", "whatsapp"], required: true },
  at: { type: Date, default: Date.now },
});
FollowupNudgeSchema.index({ therapist: 1, client: 1, at: -1 });

export default model("FollowupNudge", FollowupNudgeSchema);
