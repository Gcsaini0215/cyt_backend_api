import mongoose from "mongoose";
const { Schema } = mongoose;

/* A Razorpay order for a therapist listing package. "pending" until the payment is confirmed —
   by the browser, the webhook or the reconcile job, whichever comes first; the pending → paid
   switch is the claim that makes sure the package is activated only once. */
const therapistSubscriptionOrderSchema = new Schema({
  orderId:      { type: String, required: true, unique: true },
  user:         { type: Schema.Types.ObjectId, ref: "User", required: true },
  email:        { type: String, default: "" },
  plan:         { type: String, required: true },
  amount:       { type: Number, required: true },        // rupees
  termsVersion: { type: String, default: "" },
  status:       { type: String, enum: ["pending", "paid", "expired"], default: "pending" },
  paymentId:    { type: String, default: "" },
  paidAt:       { type: Date, default: null },
  activatedBy:  { type: String, default: "" },            // browser | webhook | reconcile
}, { timestamps: true });

therapistSubscriptionOrderSchema.index({ status: 1, createdAt: 1 });

export default mongoose.model("TherapistSubscriptionOrder", therapistSubscriptionOrderSchema);
