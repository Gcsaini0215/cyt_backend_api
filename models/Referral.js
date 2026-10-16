import mongoose from "mongoose";
const { Schema } = mongoose;

// A client's referral that turned into a paid first session: the friend got REFERRAL_AMOUNT off
// and the referrer was credited the same amount (helper/referral.js). One reward per friend.
const referralSchema = new Schema(
  {
    referrer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    friend: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    booking: { type: Schema.Types.ObjectId, ref: "Booking", required: true, unique: true },
    code: { type: String, default: "" },
    amount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

referralSchema.index({ referrer: 1, createdAt: -1 });

export default mongoose.model("Referral", referralSchema);
