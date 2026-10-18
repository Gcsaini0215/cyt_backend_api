import crypto from "crypto";
import { TherapistAddonOrder } from "../models/TherapistAddon.js";

/* Free add-on activations (admin grant or a ₹0 price) don't go through Razorpay, so they had no record.
   Saved as a ₹0 "free" order so the therapist's My plans history (and the admin) can see them. */
export async function recordFreeAddon(user, addon, { from = new Date(), till = null, by = "" } = {}) {
  try {
    await TherapistAddonOrder.create({
      orderId: `free_${addon}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
      user, addon, amount: 0, status: "paid", kind: "free", grantedBy: by,
      paidAt: new Date(), periodFrom: from, periodTill: till,
    });
  } catch (e) {
    console.error("[plan-history] free record failed:", e.message);
  }
}
