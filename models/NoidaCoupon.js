import mongoose from "mongoose";
const { Schema } = mongoose;

/* A discount code for CYT Noida bookings. It takes money off the session or
   package price (never the platform fee). How often it has been used is
   counted from the confirmed appointments that carry its code — there is no
   separate counter to drift out of step. */
const noidaCouponSchema = new Schema({
  code:          { type: String, required: true, unique: true, uppercase: true, trim: true },
  discountType:  { type: String, enum: ["percent", "flat"], required: true },
  discountValue: { type: Number, required: true, min: 1 },   // percent (1-100) or rupees
  maxDiscount:   { type: Number, default: 0, min: 0 },       // cap in rupees for a percent coupon; 0 = no cap
  appliesTo:     { type: String, enum: ["all", "session", "package"], default: "all" },
  minAmount:     { type: Number, default: 0, min: 0 },       // smallest session/package price it works on
  usageLimit:    { type: Number, default: 0, min: 0 },       // total uses; 0 = unlimited
  perPhoneLimit: { type: Number, default: 1, min: 0 },       // uses per client phone; 0 = unlimited
  validFrom:     { type: String, default: "" },              // "YYYY-MM-DD" (IST), empty = from now
  validUntil:    { type: String, default: "" },              // "YYYY-MM-DD" (IST), empty = no end
  // only for sessions on these weekdays (0 = Sun … 6 = Sat, center time); empty = any day
  days:          { type: [Number], default: [] },
  // only for sessions starting in this window ("HH:MM", 24h, center time); empty = any time
  timeFrom:      { type: String, default: "" },
  timeTo:        { type: String, default: "" },
  // shown as an offer on the public booking page, where people claim a personal code
  isPublic:      { type: Boolean, default: false },
  publicTitle:   { type: String, default: "" },
  // when true the main code itself can't be typed in — only personal claimed codes work
  claimOnly:     { type: Boolean, default: true },
  active:        { type: Boolean, default: true },
  note:          { type: String, default: "" },
}, { timestamps: true });

export default mongoose.model("NoidaCoupon", noidaCouponSchema);
