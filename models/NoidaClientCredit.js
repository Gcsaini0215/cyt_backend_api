import mongoose from "mongoose";
const { Schema } = mongoose;

/* Tracks how many pre-paid sessions a client has left — created either
   automatically when someone buys a Package online, or manually by admin
   for existing/offline/legacy clients who have an arrangement but no
   online purchase on record. A follow-up booking checks this by phone:
   if sessions remain, the booking skips Razorpay entirely. */
const noidaClientCreditSchema = new Schema({
  phone: { type: String, required: true, index: true },
  name: { type: String, required: true },
  packageName: { type: String, default: "" },
  totalSessions: { type: Number, required: true, min: 1 },
  sessionsUsed: { type: Number, default: 0, min: 0 },
  active: { type: Boolean, default: true },
  source: { type: String, enum: ["online-purchase", "admin-manual"], default: "admin-manual" },
  notes: { type: String, default: "" },
}, { timestamps: true });

export default mongoose.model("NoidaClientCredit", noidaClientCreditSchema);
