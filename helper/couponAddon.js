import AssessmentPricing from "../models/AssessmentPricing.js";
import TherapistAddon from "../models/TherapistAddon.js";

/* "Coupons" upgrade for therapists: one-time payment, lifetime. Price is set by a Super Admin
   (AssessmentPricing.couponsPrice, default ₹399); an admin can also unlock it free or take it away.
   Until it's unlocked a therapist can't create / edit / switch on coupons, and their coupons don't
   show on the profile or apply on the booking page. */

export const COUPONS_PRICE = 399;

export async function getCouponsPrice() {
  const doc = await AssessmentPricing.findOne({ key: "default" }).select("couponsPrice").lean();
  return doc?.couponsPrice ?? COUPONS_PRICE;
}

export async function couponsUnlocked(userId) {
  if (!userId) return false;
  return !!(await TherapistAddon.exists({ user: userId, couponsUnlocked: true }));
}

export async function unlockCoupons(userId, { source, amount = null, paymentId = "", by = "" }) {
  await TherapistAddon.updateOne({ user: userId }, {
    $set: { couponsUnlocked: true, couponsSource: source, couponsAt: new Date(), couponsAmount: amount, couponsPaymentId: paymentId, couponsBy: by },
  }, { upsert: true });
}
