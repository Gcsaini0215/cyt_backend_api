import mongoose from "mongoose";
const { Schema } = mongoose;

/* A personal code handed out when someone claims a public offer on the booking page
   (name + phone + email). It carries its parent coupon's rules, works once, and only for
   the phone that claimed it — so sharing it is pointless and every claim is a real lead. */
const noidaCouponClaimSchema = new Schema({
  coupon: { type: Schema.Types.ObjectId, ref: "NoidaCoupon", required: true },
  code:   { type: String, required: true, unique: true, uppercase: true, trim: true },
  name:   { type: String, required: true, trim: true },
  phone:  { type: String, required: true, trim: true },
  email:  { type: String, required: true, trim: true, lowercase: true },
  emailed: { type: Boolean, default: false },
  ip:     { type: String, default: "" },
}, { timestamps: true });

noidaCouponClaimSchema.index({ coupon: 1, phone: 1 });

export default mongoose.model("NoidaCouponClaim", noidaCouponClaimSchema);
