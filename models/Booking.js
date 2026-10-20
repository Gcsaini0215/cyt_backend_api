import mongoose from "mongoose";
const { Schema } = mongoose;

const bookingSchema = new Schema({
  client: {
    type: Schema.Types.ObjectId,
    ref: "User",
    // a CYT Noida booking made without any email has no client account (the therapist still sees it)
    required: function () { return this.source !== "noida"; },
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
  reminder_1h_sent_at: { type: Date, default: null }, // "your session starts in an hour" email to the client (sent once)
  pending_mail_sent_at: { type: Date, default: null }, // "complete your payment" reminder (sent once, if still unpaid)
  slot_released_at: { type: Date, default: null }, // client closed Razorpay without paying → the slot is free again
  // referrals (helper/referral.js): a friend's code used on this booking, and the client's own credit spent on it
  referral_code: { type: String, default: "" },
  referral_discount: { type: Number, default: 0 },
  credit_used: { type: Number, default: 0 },
  credit_settled: { type: Boolean, default: false },
  // the therapist's own coupon used on this booking (helper/coupon.js counts paid bookings as its uses)
  coupon_id: { type: Schema.Types.ObjectId, ref: "Coupon", default: null },
  coupon_code: { type: String, default: "" },
  // a CYT Noida centre appointment shown here too (helper/noidaBookingSync.js) — ₹0, the client paid CYT
  source: { type: String, default: "" }, // "noida"
  noida_appointment: { type: Schema.Types.ObjectId, ref: "NoidaAppointment", default: undefined },
  noida_client_code: { type: String, default: "" },
  noida_phone: { type: String, default: "" }, // the client's phone, for a Noida booking without a client account
  // an earlier Noida session (before the payouts system, 21 Oct 2026): shown as a record only — no earning, no payout
  noida_legacy: { type: Boolean, default: false },
  // what the client actually paid CYT for it — shown on the dashboards + invoice, never counted as therapist earning
  noida_amount: { type: Number, default: undefined },
  noida_fee: { type: Number, default: 0 },       // platform fee inside noida_amount
  noida_discount: { type: Number, default: 0 },
  noida_paid_via: { type: String, default: "" },
  // what this one session is worth for the therapist's 70% (no platform fee): the session fee, or one session's
  // share of a package — a package session is ₹0 at booking, and a package's first booking carries the whole package
  noida_session_value: { type: Number, default: undefined },
  // the therapist payout that covered this session (Admin → Payouts); null = not paid out yet
  payout_id: { type: Schema.Types.ObjectId, ref: "TherapistPayout", default: null }, // "Online (Razorpay)" / "UPI QR" / "Cash" / "Package session"
});

// the therapist / client portals list bookings newest-first by these fields
bookingSchema.index({ therapist: 1, _id: -1 });
bookingSchema.index({ client: 1, _id: -1 });
bookingSchema.index({ coupon_id: 1 });
bookingSchema.index({ noida_appointment: 1 }, { unique: true, sparse: true });

export default mongoose.model("Booking", bookingSchema);
