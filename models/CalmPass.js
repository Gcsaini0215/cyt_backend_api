import mongoose from "mongoose";
const { Schema } = mongoose;

/* Calm corner pass (2026-11-20, owner): the client portal's Calm corner — guided breathing with nature scenes,
   grounding, calming sounds, SOS reset — is free for 7 days from the first time a client opens it, then
   ₹100 for 30 days, paid each month (no auto-renew). The public /breathe page keeps two techniques free. */
const calmPassSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    trialStartedAt: { type: Date, required: true },
    paidUntil: { type: Date, default: null },
    remindedFor: { type: Date, default: null }, // the paidUntil the "ending soon" reminder was sent for
  },
  { timestamps: true }
);

const calmPassOrderSchema = new Schema(
  {
    orderId: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amount: { type: Number, required: true }, // rupees
    days: { type: Number, required: true },
    status: { type: String, enum: ["pending", "paid"], default: "pending" },
    paymentId: { type: String, default: "" },
    paidAt: { type: Date, default: null },
    from: { type: Date, default: null },
    till: { type: Date, default: null },
  },
  { timestamps: true }
);

export const CalmPassOrder = mongoose.model("CalmPassOrder", calmPassOrderSchema);
export default mongoose.model("CalmPass", calmPassSchema);
