import mongoose from "mongoose";
const { Schema } = mongoose;

// A payout to a therapist, recorded by the accounts team.
const TherapistPayoutSchema = new Schema({
  user:       { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  amount:     { type: Number, required: true, min: 0 },
  periodFrom: { type: Date, default: null },
  periodTo:   { type: Date, default: null },
  sessions:   { type: Number, default: 0, min: 0 },
  method:     { type: String, enum: ["bank", "upi", "other"], default: "bank" },
  reference:  { type: String, default: "", trim: true, maxlength: 120 }, // UTR / UPI ref
  status:     { type: String, enum: ["pending", "paid"], default: "pending", index: true },
  paidAt:     { type: Date, default: null },
  note:       { type: String, default: "", maxlength: 1000 },
  createdBy:  { type: Schema.Types.ObjectId, ref: "Admin", default: null },
  // the session bookings this payout covers (Admin → Payouts); each of them points back via Booking.payout_id
  bookings:   [{ type: Schema.Types.ObjectId, ref: "Booking" }],
  // the split it was worked out from (one session's payout): what the client paid, CYT's part, the therapist's %
  gross:         { type: Number, default: 0 },
  platformShare: { type: Number, default: 0 },
  therapistPct:  { type: Number, default: 0 },
  // sent through RazorpayX (helper/razorpayx.js): its payout id and last known status
  rzp_payout_id:       { type: String, default: "" },
  rzp_status:          { type: String, default: "" },   // queued / pending / processing / processed / reversed / failed / rejected / cancelled
  rzp_mode:            { type: String, default: "" },   // IMPS / NEFT / UPI
  rzp_error:           { type: String, default: "" },
  rzp_attempts:        { type: Number, default: 0 },
  rzp_contact_id:      { type: String, default: "" },
  rzp_fund_account_id: { type: String, default: "" },
}, { timestamps: true });

export default mongoose.model("TherapistPayout", TherapistPayoutSchema);
