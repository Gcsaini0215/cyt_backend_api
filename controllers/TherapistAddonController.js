import expressAsyncHandler from "express-async-handler";
import crypto from "crypto";
import Users from "../models/Users.js";
import TherapistAddon, { TherapistAddonOrder } from "../models/TherapistAddon.js";
import { razorpayClient } from "../helper/therapistSubscription.js";
import { getPricing } from "../helper/assessmentPricing.js";

/* "Clinical Assessments" add-on: a yearly upgrade (price + offers set in the admin panel, default ₹499)
   bought by the therapist on Razorpay. While it is active, clients can book clinical assessments with
   them (see AssessmentRequestController). A price of ₹0 activates it without payment. */

const YEAR = 365 * 864e5;
// Razorpay calls, overridable in tests
export const addonPaymentSource = {
  createOrder: (o) => razorpayClient().orders.create(o),
  fetchPayment: (id) => razorpayClient().payments.fetch(id),
};

// one more year, from today or from the current end date if still running
async function extendYear(user) {
  const a = await TherapistAddon.findOne({ user }).lean();
  const from = a?.assessmentsTill && a.assessmentsTill > new Date() ? a.assessmentsTill : new Date();
  await TherapistAddon.updateOne({ user }, { $set: { assessmentsTill: new Date(new Date(from).getTime() + YEAR) } }, { upsert: true });
}

export async function assessmentsActive(userId) {
  const a = await TherapistAddon.findOne({ user: userId }).select("assessmentsTill").lean();
  return !!(a?.assessmentsTill && a.assessmentsTill > new Date());
}

// GET /therapist-addon — this therapist's add-ons
export const myAddons = expressAsyncHandler(async (req, res) => {
  const [a, p] = await Promise.all([TherapistAddon.findOne({ user: req.user._id }).lean(), getPricing()]);
  const till = a?.assessmentsTill || null;
  res.json({ status: true, data: { assessments: { active: !!(till && till > new Date()), till, ...p.addon }, therapistShare: p.therapistShare, tests: p.tests } });
});

// POST /therapist-addon/order — start the ₹499 payment (priced here, never by the browser)
export const createAddonOrder = expressAsyncHandler(async (req, res) => {
  const u = await Users.findById(req.user._id).select("is_verified").lean();
  if (u?.is_verified !== 1) return res.status(403).json({ status: false, message: "Add-ons can be bought once your profile is approved." });
  const price = (await getPricing()).addon.price;
  if (price === 0) {
    await extendYear(req.user._id);
    return res.json({ status: true, data: { free: true }, message: "Clinical Assessments activated." });
  }
  try {
    const order = await addonPaymentSource.createOrder({
      amount: price * 100, currency: "INR",
      receipt: `addon_${String(req.user._id).slice(-10)}_${Date.now().toString(36)}`,
      notes: { purpose: "therapist_addon", addon: "assessments" },
    });
    await TherapistAddonOrder.create({ orderId: order.id, user: req.user._id, amount: price });
    res.json({ status: true, data: { orderId: order.id, amount: price, keyId: process.env.RAZORPAY_KEY_ID } });
  } catch (e) {
    console.error("[addon] order failed:", e?.error?.description || e.message);
    res.status(502).json({ status: false, message: "Couldn't start the payment right now. Please try again in a minute." });
  }
});

// POST /therapist-addon/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature }
export const verifyAddonPayment = expressAsyncHandler(async (req, res) => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = req.body || {};
  if (!orderId || !paymentId || !sig) return res.status(400).json({ status: false, message: "Missing payment details." });
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  if (expected !== sig) return res.status(400).json({ status: false, message: "Invalid payment signature." });

  const order = await TherapistAddonOrder.findOne({ orderId, user: req.user._id });
  if (!order) return res.status(404).json({ status: false, message: "Order not found." });
  if (order.status === "paid") return res.json({ status: true, message: "Already active." });

  let p;
  try { p = await addonPaymentSource.fetchPayment(paymentId); } catch (e) {
    return res.status(502).json({ status: false, message: "We couldn't confirm your payment with Razorpay just now. Please try again in a minute — your money is safe." });
  }
  const ok = p && p.order_id === orderId && ["captured", "authorized"].includes(p.status) && (p.currency || "INR") === "INR" && Number(p.amount) === order.amount * 100;
  if (!ok) {
    console.error("[addon] verify mismatch", JSON.stringify({ orderId, paymentId, paid: p?.amount, status: p?.status }));
    return res.status(400).json({ status: false, message: "This payment doesn't match the add-on price. Please contact hello@chooseyourtherapist.in with your payment ID." });
  }
  // activate once: only the request that flips pending → paid extends the year
  const claimed = await TherapistAddonOrder.findOneAndUpdate({ _id: order._id, status: "pending" }, { $set: { status: "paid", paymentId } });
  if (claimed) await extendYear(req.user._id);
  const a = await TherapistAddon.findOne({ user: req.user._id }).lean();
  res.json({ status: true, message: "Clinical Assessments activated.", data: { till: a?.assessmentsTill } });
});

// GET /assessment-providers — user ids of therapists who can be booked for clinical assessments
export const assessmentProviders = expressAsyncHandler(async (req, res) => {
  const rows = await TherapistAddon.find({ assessmentsTill: { $gt: new Date() } }).select("user").lean();
  res.json({ status: true, data: rows.map((r) => String(r.user)) });
});
