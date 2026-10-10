import mongoose from "mongoose";
const { Schema } = mongoose;

/* One row per therapist listing payment (Razorpay), so the admin Subscriptions page has a history,
   not just the current plan stored on the Therapists document. */
const therapistSubscriptionPaymentSchema = new Schema({
  user:        { type: Schema.Types.ObjectId, ref: "User", required: true },
  name:        { type: String, default: "" },
  email:       { type: String, default: "" },
  plan:        { type: String, required: true },          // 1_month | 6_month | annual | free (3_month on old orders)
  months:      { type: Number, required: true },
  amount:      { type: Number, required: true },           // rupees
  startedAt:   { type: Date, required: true },
  expiresAt:   { type: Date, required: true },
  orderId:     { type: String, default: "" },
  paymentId:   { type: String, required: true, unique: true },   // "free_<id>" for admin grants
  status:      { type: String, enum: ["paid", "free"], default: "paid" },   // free = granted by an admin
  grantedBy:   { type: String, default: "" },
  termsVersion: { type: String, default: "" },
}, { timestamps: true });

therapistSubscriptionPaymentSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("TherapistSubscriptionPayment", therapistSubscriptionPaymentSchema);
