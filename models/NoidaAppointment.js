import mongoose from "mongoose";
const { Schema } = mongoose;

/* Standalone Calendly-style booking for the physical Noida therapy
   center — deliberately not linked to Lead/Therapist records, this is
   just "who's coming in, on what date, at what slot." */
const noidaAppointmentSchema = new Schema({
  name:     { type: String, required: true },
  age:      { type: String, default: "" },
  phone:    { type: String, required: true },
  therapist:     { type: Schema.Types.ObjectId, ref: "Therapists", default: null }, // the therapist the client asked for, if any
  therapistName: { type: String, default: "" },                                     // snapshot — survives the therapist later going off-air
  clientCode: { type: String, default: "" },   // the client's permanent number, e.g. CYTN-0007 (same for every booking of this phone)
  email:    { type: String, default: "" },
  concern:  { type: String, default: "" },
  date:     { type: String, required: true },   // "YYYY-MM-DD", center-local day, not a Date object — avoids TZ drift
  slot:     { type: String, required: true },    // e.g. "11:00 AM - 11:45 AM"
  type:     { type: String, enum: ["new", "followup"], default: "new" },
  status:   { type: String, enum: ["confirmed", "cancelled"], default: "confirmed" },
  adminNote: { type: String, default: "" },

  // Cancelled bookings can be tucked away instead of deleted.
  archived:   { type: Boolean, default: false },
  archivedAt: { type: Date, default: null },

  // Front-desk tracking on the day: "" (not yet) → arrived → completed, or no_show.
  attendance:   { type: String, enum: ["", "arrived", "completed", "no_show"], default: "" },
  attendanceAt: { type: Date, default: null },

  sessionMode: { type: String, enum: ["individual", "couple", "package"], default: "individual" },
  format:      { type: String, enum: ["in-person", "online", "home-visit"], default: "in-person" },
  address:     { type: String, default: "" }, // only meaningful when format === "home-visit"

  packageId:   { type: Schema.Types.ObjectId, ref: "NoidaPackage", default: null },
  packageName: { type: String, default: "" }, // snapshotted at booking time — survives the package later being edited/deleted

  couponCode:     { type: String, default: "" },   // discount code used, if any
  discountAmount: { type: Number, default: 0 },    // rupees taken off the session/package price

  amount:      { type: Number, default: 0 },  // total charged, in rupees (base + platform fee) — 0 when paid via credit
  platformFee: { type: Number, default: 0 },
  paymentStatus: { type: String, enum: ["pending", "paid", "failed", "package-credit"], default: "pending" },
  paymentMethod: { type: String, enum: ["razorpay", "qr", "cash", "credit"], default: "razorpay" },
  razorpayOrderId:   { type: String, default: "" },
  razorpayPaymentId: { type: String, default: "" },
  creditUsed:  { type: Schema.Types.ObjectId, ref: "NoidaClientCredit", default: null }, // which credit record this session was deducted from, if any
  receptionCreditClientId: { type: String, default: "" }, // set instead of creditUsed when the free session came from a walk-in Reception client's package (ReceptionClient.id, not an ObjectId)

  assignedTo:  { type: Schema.Types.ObjectId, ref: "Admin", default: null }, // team member handling this booking
  bookedByAdmin: { type: Schema.Types.ObjectId, ref: "Admin", default: null }, // set when reception/staff booked this on the client's behalf

  previousDate:    { type: String, default: "" }, // set on reschedule — the slot this booking moved FROM
  previousSlot:    { type: String, default: "" },
  rescheduleCount: { type: Number, default: 0 },
}, { timestamps: true });

noidaAppointmentSchema.index({ date: 1, slot: 1 });

export default mongoose.model("NoidaAppointment", noidaAppointmentSchema);
