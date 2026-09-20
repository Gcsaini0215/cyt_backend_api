import mongoose from "mongoose";
const { Schema } = mongoose;

/* What a public client was trying to book when they were sent to Razorpay.
   Saved at order-creation time so that a payment which succeeds but whose
   browser callback never arrives (closed tab, dropped connection) can still
   be turned into a booking by the Razorpay webhook — and so that a payment
   which can't become a booking (slot taken meanwhile) can be refunded
   instead of leaving the client charged for nothing. */
const noidaPendingBookingSchema = new Schema({
  orderId: { type: String, required: true, unique: true },
  amount:  { type: Number, default: 0 }, // rupees, as charged

  payload: {
    name:  { type: String, default: "" },
    age:   { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    concern: { type: String, default: "" },
    date:  { type: String, default: "" },
    slot:  { type: String, default: "" },
    type:  { type: String, enum: ["new", "followup"], default: "new" },
    sessionMode: { type: String, default: "individual" },
    format:      { type: String, default: "in-person" },
    address:     { type: String, default: "" },
    packageId:   { type: Schema.Types.ObjectId, ref: "NoidaPackage", default: null },
    customSessions: { type: Number, default: 0 }, // set instead of packageId for a custom package
  },

  // pending → processing (someone is working on it) → completed | refunded | refund_failed
  status: { type: String, enum: ["pending", "processing", "completed", "refunded", "refund_failed"], default: "pending" },
  paymentId: { type: String, default: "" },
  appointment: { type: Schema.Types.ObjectId, ref: "NoidaAppointment", default: null },
  failureReason: { type: String, default: "" },
  refundId: { type: String, default: "" },

  // Staff marks a refund_failed / stuck order as dealt with (e.g. refunded by
  // hand from the Razorpay dashboard) so it leaves the "needs action" list.
  resolved: { type: Boolean, default: false },
  resolvedNote: { type: String, default: "" },
  resolvedAt: { type: Date, default: null },
}, { timestamps: true });

// Abandoned checkouts (never paid) and settled ones clean themselves up.
noidaPendingBookingSchema.index({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });

export default mongoose.model("NoidaPendingBooking", noidaPendingBookingSchema);
