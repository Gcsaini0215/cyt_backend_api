import mongoose from "mongoose";
import Coupon from "../models/Coupan.js";
import Booking from "../models/Booking.js";
import Therapists from "../models/Therapists.js";

// Therapist coupons are saved with the therapist's USER id (req.user._id when they create one), while
// the booking pages know the therapist PROFILE id (Therapists._id). Match either, so both work.
export const couponOwnerIds = async (therapistId) => {
  if (!mongoose.Types.ObjectId.isValid(therapistId)) return [];
  const th = await Therapists.findById(therapistId).select("user").lean();
  return th ? [th._id, th.user].filter(Boolean) : [new mongoose.Types.ObjectId(therapistId)];
};

// A coupon is "used" once per PAID booking that carries it — applying it on the booking page doesn't count.
export const usedCounts = async (couponIds) => {
  if (!couponIds.length) return {};
  const rows = await Booking.aggregate([
    { $match: { coupon_id: { $in: couponIds }, payment_status: "Paid" } },
    { $group: { _id: "$coupon_id", n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
};

// active | paused | scheduled | expired | used_up
export const couponState = (c, used, now = new Date()) => {
  if (!c.is_active) return "paused";
  if (c.valid_until && now > new Date(c.valid_until)) return "expired";
  if (c.valid_from && now < new Date(c.valid_from)) return "scheduled";
  if (used >= (c.max_usage || 1)) return "used_up";
  return "active";
};

export const discountOf = (type, value, amount) => {
  const a = Math.max(0, Number(amount) || 0);
  if (!a) return 0;
  return Math.min(a, type === "percentage" ? Math.round((a * value) / 100) : value);
};

const STATE_MESSAGE = {
  paused: "This coupon is not active right now",
  expired: "This coupon has expired",
  scheduled: "This coupon is not valid yet",
  used_up: "This coupon has been fully used",
};

// The coupon a client may use on this therapist's session, or { error } saying why not.
export const findUsableCoupon = async (therapistId, rawCode, applyFor = "Therapist") => {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code) return { error: "Please enter a coupon code" };
  const owners = await couponOwnerIds(therapistId);
  if (!owners.length) return { error: "Invalid coupon code" };
  const coupon = await Coupon.findOne({ therapist: { $in: owners }, code }).lean();
  if (!coupon) return { error: "Invalid coupon code" };
  if ((coupon.coupon_for || "Therapist") !== applyFor) return { error: "This coupon cannot be used here" };
  const used = (await usedCounts([coupon._id]))[String(coupon._id)] || 0;
  const state = couponState(coupon, used);
  if (state !== "active") return { error: STATE_MESSAGE[state] };
  return { coupon, used };
};
