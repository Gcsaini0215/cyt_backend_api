import mongoose from "mongoose";

const emailLogSchema = new mongoose.Schema({
  subject: { type: String, required: true },
  message: { type: String, required: true },
  sentCount: { type: Number, default: 0 },
  failCount: { type: Number, default: 0 },
  recipients: [{ name: String, email: String, status: { type: String, enum: ["sent", "failed"], default: "sent" }, error: String }],
  sentAt: { type: Date, default: Date.now },
});

export default mongoose.model("EmailLog", emailLogSchema);
