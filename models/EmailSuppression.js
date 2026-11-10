import mongoose from "mongoose";
const { Schema } = mongoose;

// Email addresses we must not send to (bounced / wrong address / asked to stop). helper/mailer.js drops
// these from every outgoing mail. Managed in admin → Content → Blocked emails.
const emailSuppressionSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    reason: { type: String, enum: ["bounced", "wrong-address", "unsubscribed", "other"], default: "bounced" },
    note: { type: String, default: "" },
    addedBy: { type: String, default: "" }, // admin name
  },
  { timestamps: true }
);

export default mongoose.model("EmailSuppression", emailSuppressionSchema);
