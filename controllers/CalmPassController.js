import expressAsyncHandler from "express-async-handler";
import crypto from "crypto";
import CalmPass, { CalmPassOrder } from "../models/CalmPass.js";
import { addonPaymentSource } from "./TherapistAddonController.js";
import { notifyClient } from "../services/clientNotify.js";

/* Calm corner pass — 7 days free from the first visit, then ₹100 for 30 days (paid by the client each time,
   Razorpay one-time payment; price set here, never by the browser). Paying during the trial or before the
   current month ends adds the 30 days after it. */
export const CALM_PRICE = 100;
export const CALM_DAYS = 30;
export const CALM_TRIAL_DAYS = 7;
const DAY = 864e5;
const fail = (res, code, message) => res.status(code).json({ status: false, message });

const trialEnd = (p) => new Date(new Date(p.trialStartedAt).getTime() + CALM_TRIAL_DAYS * DAY);
export function calmState(p, now = Date.now()) {
  if (!p) return { state: "new", open: true };
  const tEnd = trialEnd(p).getTime();
  const paid = p.paidUntil ? new Date(p.paidUntil).getTime() : 0;
  if (paid > now) return { state: "active", open: true, until: new Date(paid), daysLeft: Math.ceil((paid - now) / DAY) };
  if (tEnd > now) return { state: "trial", open: true, until: new Date(tEnd), daysLeft: Math.ceil((tEnd - now) / DAY) };
  return { state: "expired", open: false, until: new Date(Math.max(paid, tEnd)), daysLeft: 0 };
}
const out = (p) => ({ ...calmState(p), price: CALM_PRICE, days: CALM_DAYS, trialDays: CALM_TRIAL_DAYS, trialStartedAt: p?.trialStartedAt || null, paidUntil: p?.paidUntil || null });

// GET /calm/status — the trial starts the first time the client opens the Calm corner
export const calmStatus = expressAsyncHandler(async (req, res) => {
  let p = await CalmPass.findOne({ user: req.user._id }).lean();
  if (!p && req.query.start === "1") {
    try { p = (await CalmPass.create({ user: req.user._id, trialStartedAt: new Date() })).toObject(); }
    catch (e) { if (e?.code === 11000) p = await CalmPass.findOne({ user: req.user._id }).lean(); else throw e; }
  }
  res.json({ status: true, data: out(p) });
});

// POST /calm/order — start a ₹100 payment
export const createCalmOrder = expressAsyncHandler(async (req, res) => {
  try {
    const order = await addonPaymentSource.createOrder({
      amount: CALM_PRICE * 100, currency: "INR",
      receipt: `calm_${String(req.user._id).slice(-10)}_${Date.now().toString(36)}`,
      notes: { purpose: "calm_pass", user: String(req.user._id) },
    });
    await CalmPassOrder.create({ orderId: order.id, user: req.user._id, amount: CALM_PRICE, days: CALM_DAYS });
    res.json({ status: true, data: { orderId: order.id, amount: CALM_PRICE, keyId: process.env.RAZORPAY_KEY_ID } });
  } catch (e) {
    console.error("[calm-pass] order failed:", e?.error?.description || e.message);
    fail(res, 502, "Couldn't start the payment right now. Please try again in a minute.");
  }
});

// POST /calm/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature }
export const verifyCalmPayment = expressAsyncHandler(async (req, res) => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = req.body || {};
  if (!orderId || !paymentId || !sig) return fail(res, 400, "Missing payment details.");
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  if (expected !== sig) return fail(res, 400, "Invalid payment signature.");
  const order = await CalmPassOrder.findOne({ orderId, user: req.user._id });
  if (!order) return fail(res, 404, "Order not found.");
  if (order.status === "paid") {
    const p = await CalmPass.findOne({ user: req.user._id }).lean();
    return res.json({ status: true, message: "Already unlocked.", data: out(p) });
  }
  let pay;
  try { pay = await addonPaymentSource.fetchPayment(paymentId); } catch (e) {
    return fail(res, 502, "We couldn't confirm your payment with Razorpay just now. Please try again in a minute — your money is safe.");
  }
  const ok = pay && pay.order_id === orderId && ["captured", "authorized"].includes(pay.status) && (pay.currency || "INR") === "INR" && Number(pay.amount) === order.amount * 100;
  if (!ok) {
    console.error("[calm-pass] verify mismatch", JSON.stringify({ orderId, paymentId, paid: pay?.amount, status: pay?.status }));
    return fail(res, 400, "This payment doesn't match the Calm corner price. Please contact hello@chooseyourtherapist.in with your payment ID.");
  }
  // only the request that flips pending → paid extends the pass
  const claimed = await CalmPassOrder.findOneAndUpdate({ _id: order._id, status: "pending" }, { $set: { status: "paid", paymentId, paidAt: new Date() } }, { new: true });
  let p = await CalmPass.findOne({ user: req.user._id });
  if (claimed) {
    if (!p) p = new CalmPass({ user: req.user._id, trialStartedAt: new Date() });
    const now = Date.now();
    const from = new Date(Math.max(now, p.paidUntil ? new Date(p.paidUntil).getTime() : 0, trialEnd(p).getTime()));
    const till = new Date(from.getTime() + order.days * DAY);
    p.paidUntil = till;
    await p.save();
    await CalmPassOrder.updateOne({ _id: order._id }, { $set: { from, till } });
    notifyClient(req.user._id, {
      type: "notice", title: "Calm corner unlocked",
      body: `Thank you! Your Calm corner is open till ${till.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}.`,
      link: "/client/calm", ref: `calm-paid:${paymentId}`,
    });
  }
  res.json({ status: true, message: "Calm corner unlocked.", data: out(p ? p.toObject() : null) });
});
