import NoidaCoupon from "../models/NoidaCoupon.js";
import NoidaAppointment from "../models/NoidaAppointment.js";

export const normalizeCouponCode = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);

function istTodayStr() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Rupees off a given price — whole rupees, never more than the price itself.
export function calcDiscount(coupon, baseAmount) {
  let d = coupon.discountType === "percent"
    ? Math.floor((baseAmount * coupon.discountValue) / 100)
    : Math.floor(coupon.discountValue);
  if (coupon.discountType === "percent" && coupon.maxDiscount > 0) d = Math.min(d, coupon.maxDiscount);
  return Math.max(0, Math.min(d, baseAmount));
}

const couponError = (message) => { const e = new Error(message); e.status = 400; return e; };

// Checks a code against a booking and returns the discount, or throws an
// Error whose message is fit to show the client.
export async function resolveCoupon({ code, phone, baseAmount, isPackage }) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) throw couponError("Enter a coupon code.");

  const coupon = await NoidaCoupon.findOne({ code: normalized });
  if (!coupon || !coupon.active) throw couponError("That coupon code isn't valid.");

  const today = istTodayStr();
  if (coupon.validFrom && today < coupon.validFrom) throw couponError("That coupon isn't active yet.");
  if (coupon.validUntil && today > coupon.validUntil) throw couponError("That coupon has expired.");

  if (coupon.appliesTo === "package" && !isPackage) throw couponError("This coupon works on packages only.");
  if (coupon.appliesTo === "session" && isPackage) throw couponError("This coupon works on single sessions only.");
  if (coupon.minAmount > 0 && baseAmount < coupon.minAmount) {
    throw couponError(`This coupon works on bookings of ₹${coupon.minAmount} or more.`);
  }

  if (coupon.usageLimit > 0) {
    const used = await NoidaAppointment.countDocuments({ couponCode: coupon.code, status: "confirmed" });
    if (used >= coupon.usageLimit) throw couponError("That coupon has been fully used.");
  }
  if (coupon.perPhoneLimit > 0 && phone) {
    const mine = await NoidaAppointment.countDocuments({ couponCode: coupon.code, phone: String(phone).trim(), status: "confirmed" });
    if (mine >= coupon.perPhoneLimit) throw couponError("You've already used this coupon.");
  }

  const discountAmount = calcDiscount(coupon, baseAmount);
  if (discountAmount <= 0) throw couponError("This coupon doesn't apply to this booking.");
  return { coupon, discountAmount };
}
