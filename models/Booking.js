import mongoose from "mongoose";
const { Schema } = mongoose;

const bookingSchema = new Schema({
  client: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  therapist: {
    type: Schema.Types.ObjectId,
    ref: "Therapists",
    required: true,
  },
  transaction: {
    type: Schema.Types.ObjectId,
    ref: "Transaction"
  },
  service: {
    type: String,
    required: true,
  },
  notes: {
    type: String,
    default: "",
  },
  file: {
    type: String,
    default: "",
  },
  format: {
    type: String,
    required: true,
  },
  session_type: {
    type: String,
    default: "",
  },
  whom: {
    type: String,
    default:"Whom"
  },
  cname: {
    type: String,
    default: "",
  },
  amount: {
    type: Schema.Types.Decimal128,
    required: true,
  },
  relation_with_client: {
    type: String,
    default: "",
  },
  guest_email_verified: {
    type: Boolean,
    default: false,
  },
  otp: {
    type: Number,
    required: true
  },
  age: {
    type: Number,
    default: null,
  },
  booking_date: {
    type: Date,
    required: true,
    default: Date.now,
  },

  session_started_at: {
    type: Date,
    default: null,
  },

  session_completed_at: {
    type: Date,
    default: null,
  },
  status: {
    type: String,
    default: "New",
  },
  payment_status: {
    type: String,
    enum: ["Pending Payment", "Paid", "Payment Failed"],
    default: "Pending Payment",
  },
  // Google Meet on the therapist's own calendar (helper/googleMeet.js)
  // clinical assessments booked with the session (fixed CYT fee each; therapist gets 30%)
  assessments: { type: [{ tool: String, fee: Number, _id: false }], default: [] },
  assessment_fee: { type: Number, default: 0 },
  assessment_therapist_share: { type: Number, default: 0 },
  otp_sent_at: { type: Date, default: null }, // in-person: when the start code was last emailed to the client
  meet_link: { type: String, default: "" },
  calendar_event_id: { type: String, default: "" },
  // who clicked Join (through CYT) and when — both joined = session started
  therapist_joined_at: { type: Date, default: null },
  client_joined_at: { type: Date, default: null },
  auto_completed: { type: Boolean, default: false }, // closed by the system because End wasn't tapped
  pending_mail_sent_at: { type: Date, default: null }, // "complete your payment" reminder (sent once, if still unpaid)
  slot_released_at: { type: Date, default: null }, // client closed Razorpay without paying → the slot is free again
  // referrals (helper/referral.js): a friend's code used on this booking, and the client's own credit spent on it
  referral_code: { type: String, default: "" },
  referral_discount: { type: Number, default: 0 },
  credit_used: { type: Number, default: 0 },
  credit_settled: { type: Boolean, default: false },
});

// the therapist / client portals list bookings newest-first by these fields
bookingSchema.index({ therapist: 1, _id: -1 });
bookingSchema.index({ client: 1, _id: -1 });

export default mongoose.model("Booking", bookingSchema);
