import mongoose from "mongoose";
const { Schema } = mongoose;

// A session pack (helper/sessionBundle.js): 4 or 6 sessions with one therapist, paid together at a
// discount with the first booking. Each session booked from it is a Booking worth `per_session`, so the
// therapist's 70% is counted per session when it happens. Valid 90 days from payment; unused sessions
// aren't refunded (admin can extend).
const sessionBundleSchema = new Schema(
  {
    client: { type: Schema.Types.ObjectId, ref: "User", required: true },
    therapist: { type: Schema.Types.ObjectId, ref: "Therapists", required: true },
    service: { type: String, default: "" },
    format: { type: String, default: "" },
    size: { type: Number, required: true },        // 4 | 6
    discount_pct: { type: Number, default: 0 },
    fee: { type: Number, default: 0 },             // the therapist's single-session fee when bought
    total: { type: Number, required: true },       // what the client paid for the pack
    per_session: { type: Number, required: true }, // total / size — each pack booking's amount
    used: { type: Number, default: 0 },
    status: { type: String, enum: ["active", "cancelled"], default: "active" },
    paid_at: { type: Date, default: null },
    expires_at: { type: Date, default: null },
    first_booking: { type: Schema.Types.ObjectId, ref: "Booking", default: null },
    razorpay_payment_id: { type: String, default: "" },
    extensions: { type: [{ days: Number, by: String, at: Date }], default: [] }, // admin "extend validity"
  },
  { timestamps: true }
);

sessionBundleSchema.index({ client: 1, status: 1, expires_at: -1 });

export default mongoose.model("SessionBundle", sessionBundleSchema);
