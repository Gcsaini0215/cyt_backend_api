import mongoose from "mongoose";

const { Schema, model } = mongoose;

const couponSchema = new Schema(
  {
    therapist: {
      type: Schema.Types.ObjectId,
      ref: "Therapist", // assuming you have a Therapist model
      required: true,
    },
    code: {
      type: String,
      required: true,
      unique: true, // no duplicate codes
      trim: true,
    },
    discount_type: {
      type: String,
      enum: ["percentage", "flat"], // percentage discount or fixed amount
      required: true,
    },
    coupon_for: {
      type: String,
      enum: ["Therapist", "Workshop"],
      default: "Therapist",
    },
    discount_value: {
      type: Number,
      required: true,
    },
    max_usage: {
      type: Number,
      default: 1, // how many times coupon can be used
    },
    used_count: {
      type: Number,
      default: 0,
    },
    valid_from: {
      type: Date,
      default: Date.now,
    },
    valid_until: {
      type: Date,
      required: true,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    // short line clients see with the offer, e.g. "First session offer"
    title: {
      type: String,
      default: "",
      trim: true,
    },
    // shown in the offer pop-up on the therapist's public profile and in the booking page's offer list
    show_on_profile: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const Coupon = model("Coupon", couponSchema);

export default Coupon;
