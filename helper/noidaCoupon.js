import NoidaCoupon from "../models/NoidaCoupon.js";
import NoidaAppointment from "../models/NoidaAppointment.js";
import NoidaCouponClaim from "../models/NoidaCouponClaim.js";

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

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmmToMin = (v) => { if (!v || !/^\d{1,2}:\d{2}$/.test(String(v))) return null; const [h, m] = String(v).split(":").map(Number); return h * 60 + m; };
const minToLabel = (m) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, "0")} ${m < 720 ? "AM" : "PM"}`;
function slotStart(slot) {
  const [time, ampm] = String(slot || "").split(" - ")[0].trim().split(" ");
  let [h, m] = String(time || "").split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + (m || 0);
}
const weekdayOf = (date) => { const [y, mo, d] = String(date || "").split("-").map(Number); return y ? new Date(Date.UTC(y, mo - 1, d)).getUTCDay() : null; };

// Human text for an offer's day/time rule, e.g. "Mon–Thu · 12:00 PM–4:00 PM"
export function offerWindowText(c) {
  const days = (c.days || []).slice().sort((a, b) => a - b);
  const dayTxt = !days.length || days.length === 7 ? "" : days.map((d) => DAY_NAMES[d]).join(", ");
  const f = hhmmToMin(c.timeFrom), t = hhmmToMin(c.timeTo);
  const timeTxt = f != null && t != null ? `${minToLabel(f)}–${minToLabel(t)}` : f != null ? `from ${minToLabel(f)}` : t != null ? `before ${minToLabel(t)}` : "";
  return [dayTxt, timeTxt].filter(Boolean).join(" · ");
}

// Does the chosen session slot fall inside the coupon's day / time window?
function checkWindow(coupon, date, slot) {
  const hasDays = coupon.days?.length && coupon.days.length < 7;
  const f = hhmmToMin(coupon.timeFrom), t = hhmmToMin(coupon.timeTo);
  if (!hasDays && f == null && t == null) return;
  if (!date || !slot) throw couponError("Pick a slot first — this offer is for specific days / times.");
  const wd = weekdayOf(date), start = slotStart(slot);
  const where = offerWindowText(coupon);
  if (hasDays && !coupon.days.includes(wd)) throw couponError(`This offer is only for sessions on ${where}.`);
  if (start != null && ((f != null && start < f) || (t != null && start >= t))) throw couponError(`This offer is only for sessions on ${where}.`);
}

// Checks a code against a booking and returns the discount (plus the exact code to store on
// the booking), or throws an Error whose message is fit to show the client. `date` / `slot`
// are the session being booked — day/time offers are judged on the session, not on today.
export async function resolveCoupon({ code, phone, baseAmount, isPackage, date, slot }) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) throw couponError("Enter a coupon code.");

  let coupon = await NoidaCoupon.findOne({ code: normalized });
  let claim = null;
  if (coupon && coupon.isPublic && coupon.claimOnly) {
    throw couponError("Claim this offer on the booking page to get your personal code.");
  }
  if (!coupon) {
    claim = await NoidaCouponClaim.findOne({ code: normalized });
    if (claim) coupon = await NoidaCoupon.findById(claim.coupon);
  }
  if (!coupon || !coupon.active) throw couponError("That coupon code isn't valid.");

  if (claim) {
    if (!phone) throw couponError("Enter your phone number to use this code.");
    if (String(phone).trim() !== claim.phone) throw couponError("This code belongs to a different phone number.");
    if (await NoidaAppointment.exists({ couponCode: claim.code, status: "confirmed" })) throw couponError("You've already used this code.");
  }

  const today = istTodayStr();
  if (coupon.validFrom && today < coupon.validFrom) throw couponError("That coupon isn't active yet.");
  if (coupon.validUntil && today > coupon.validUntil) throw couponError("That coupon has expired.");

  if (coupon.appliesTo === "package" && !isPackage) throw couponError("This coupon works on packages only.");
  if (coupon.appliesTo === "session" && isPackage) throw couponError("This coupon works on single sessions only.");
  if (coupon.minAmount > 0 && baseAmount < coupon.minAmount) {
    throw couponError(`This coupon works on bookings of ₹${coupon.minAmount} or more.`);
  }
  checkWindow(coupon, date, slot);

  // usage counts across the main code and every personal code claimed from it
  const family = [coupon.code, ...(await NoidaCouponClaim.distinct("code", { coupon: coupon._id }))];
  if (coupon.usageLimit > 0) {
    const used = await NoidaAppointment.countDocuments({ couponCode: { $in: family }, status: "confirmed" });
    if (used >= coupon.usageLimit) throw couponError("That coupon has been fully used.");
  }
  if (coupon.perPhoneLimit > 0 && phone) {
    const mine = await NoidaAppointment.countDocuments({ couponCode: { $in: family }, phone: String(phone).trim(), status: "confirmed" });
    if (mine >= coupon.perPhoneLimit) throw couponError("You've already used this coupon.");
  }

  const discountAmount = calcDiscount(coupon, baseAmount);
  if (discountAmount <= 0) throw couponError("This coupon doesn't apply to this booking.");
  return { coupon, discountAmount, appliedCode: claim ? claim.code : coupon.code };
}
