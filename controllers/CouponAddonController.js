import expressAsyncHandler from "express-async-handler";
import crypto from "crypto";
import mongoose from "mongoose";
import Users from "../models/Users.js";
import Therapists from "../models/Therapists.js";
import Coupon from "../models/Coupan.js";
import TherapistAddon, { TherapistAddonOrder } from "../models/TherapistAddon.js";
import AssessmentPricing from "../models/AssessmentPricing.js";
import { getCouponsPrice, unlockCoupons } from "../helper/couponAddon.js";
import { addonPaymentSource } from "./TherapistAddonController.js";
import { notifyTherapists } from "../services/therapistNotify.js";
import { recordFreeAddon } from "../helper/planHistory.js";

/* Coupons upgrade — one-time Razorpay payment (price from the admin panel, default ₹399), lifetime.
   ₹0 unlocks without payment. Admins can unlock it free for a therapist or revoke it. */

const fail = (res, code, message) => res.status(code).json({ status: false, message });

// GET /coupon/addon — this therapist's status
export const myCouponsAddon = expressAsyncHandler(async (req, res) => {
  const [a, price, u, count] = await Promise.all([
    TherapistAddon.findOne({ user: req.user._id }).select("couponsUnlocked couponsSource couponsAt couponsAmount couponsPaymentId").lean(),
    getCouponsPrice(),
    Users.findById(req.user._id).select("is_verified").lean(),
    Coupon.countDocuments({ therapist: req.user._id }),
  ]);
  res.json({
    status: true,
    data: {
      unlocked: !!a?.couponsUnlocked, source: a?.couponsSource || "", at: a?.couponsAt || null,
      amount: a?.couponsAmount ?? null, paymentId: a?.couponsPaymentId || "",
      price, approved: u?.is_verified === 1, coupons: count,
    },
  });
});

// POST /coupon/addon/order — start the payment (priced here, never by the browser)
export const createCouponsOrder = expressAsyncHandler(async (req, res) => {
  const u = await Users.findById(req.user._id).select("is_verified").lean();
  if (u?.is_verified !== 1) return fail(res, 403, "Upgrades can be bought once your profile is approved.");
  const a = await TherapistAddon.findOne({ user: req.user._id }).select("couponsUnlocked").lean();
  if (a?.couponsUnlocked) return res.json({ status: true, data: { unlocked: true }, message: "Coupons are already unlocked." });
  const price = await getCouponsPrice();
  if (price === 0) {
    await unlockCoupons(req.user._id, { source: "free", amount: 0 });
    await recordFreeAddon(req.user._id, "coupons", { by: "free price" });
    return res.json({ status: true, data: { free: true }, message: "Coupons unlocked." });
  }
  try {
    const order = await addonPaymentSource.createOrder({
      amount: price * 100, currency: "INR",
      receipt: `cpn_${String(req.user._id).slice(-10)}_${Date.now().toString(36)}`,
      notes: { purpose: "therapist_addon", addon: "coupons" },
    });
    await TherapistAddonOrder.create({ orderId: order.id, user: req.user._id, addon: "coupons", amount: price });
    res.json({ status: true, data: { orderId: order.id, amount: price, keyId: process.env.RAZORPAY_KEY_ID } });
  } catch (e) {
    console.error("[coupons-addon] order failed:", e?.error?.description || e.message);
    fail(res, 502, "Couldn't start the payment right now. Please try again in a minute.");
  }
});

// POST /coupon/addon/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature }
export const verifyCouponsPayment = expressAsyncHandler(async (req, res) => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = req.body || {};
  if (!orderId || !paymentId || !sig) return fail(res, 400, "Missing payment details.");
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  if (expected !== sig) return fail(res, 400, "Invalid payment signature.");

  const order = await TherapistAddonOrder.findOne({ orderId, user: req.user._id, addon: "coupons" });
  if (!order) return fail(res, 404, "Order not found.");
  if (order.status === "paid") return res.json({ status: true, message: "Coupons are already unlocked." });

  let p;
  try { p = await addonPaymentSource.fetchPayment(paymentId); } catch (e) {
    return fail(res, 502, "We couldn't confirm your payment with Razorpay just now. Please try again in a minute — your money is safe.");
  }
  const ok = p && p.order_id === orderId && ["captured", "authorized"].includes(p.status) && (p.currency || "INR") === "INR" && Number(p.amount) === order.amount * 100;
  if (!ok) {
    console.error("[coupons-addon] verify mismatch", JSON.stringify({ orderId, paymentId, paid: p?.amount, status: p?.status }));
    return fail(res, 400, "This payment doesn't match the upgrade price. Please contact hello@chooseyourtherapist.in with your payment ID.");
  }
  // unlock once: only the request that flips pending → paid does it
  const claimed = await TherapistAddonOrder.findOneAndUpdate({ _id: order._id, status: "pending" }, { $set: { status: "paid", paymentId, paidAt: new Date() } });
  if (claimed) await unlockCoupons(req.user._id, { source: "paid", amount: order.amount, paymentId });
  res.json({ status: true, message: "Coupons unlocked — create your first coupon." });
});

// ── admin ──────────────────────────────────────────────────────────────────────────────────────
// GET /coupon/admin/addon — price + every approved therapist with their Coupons status
export const adminCouponsAddon = expressAsyncHandler(async (req, res) => {
  const [price, users] = await Promise.all([
    getCouponsPrice(),
    Users.find({ role: 1, is_verified: 1 }).select("name email phone").sort({ name: 1 }).lean(),
  ]);
  const ids = users.map((u) => u._id);
  const [addons, counts, ther] = await Promise.all([
    TherapistAddon.find({ user: { $in: ids } }).select("user couponsUnlocked couponsSource couponsAt couponsBy couponsAmount couponsPaymentId").lean(),
    Coupon.aggregate([{ $match: { therapist: { $in: ids } } }, { $group: { _id: "$therapist", n: { $sum: 1 } } }]),
    Therapists.find({ user: { $in: ids } }).select("user profile_type").lean(),
  ]);
  const by = Object.fromEntries(addons.map((a) => [String(a.user), a]));
  const n = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  const type = Object.fromEntries(ther.map((t) => [String(t.user), t.profile_type || ""]));
  res.json({
    status: true,
    data: {
      price,
      therapists: users.map((u) => {
        const a = by[String(u._id)] || {};
        return {
          userId: u._id, name: u.name, email: u.email, phone: u.phone || "", profileType: type[String(u._id)] || "",
          unlocked: !!a.couponsUnlocked, source: a.couponsSource || "", at: a.couponsAt || null, by: a.couponsBy || "",
          amount: a.couponsAmount ?? null, paymentId: a.couponsPaymentId || "", coupons: n[String(u._id)] || 0,
        };
      }),
    },
  });
});

// POST /coupon/admin/addon/:userId { action: "grant" | "revoke" }
export const adminCouponsAction = expressAsyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(userId)) return fail(res, 400, "Invalid therapist.");
  const u = await Users.findOne({ _id: userId, role: 1 }).select("name").lean();
  if (!u) return fail(res, 404, "Therapist not found.");
  const who = req.user?.email || req.user?.name || "admin";
  const action = req.body?.action;
  if (action === "grant") {
    await unlockCoupons(userId, { source: "free", amount: 0, by: who });
    await recordFreeAddon(userId, "coupons", { by: who });
    notifyTherapists([userId], { type: "addon", title: "Coupons unlocked", body: "CYT has unlocked Coupons for you — create offers for your clients.", link: "/coupons" });
  } else if (action === "revoke") {
    await TherapistAddon.updateOne({ user: userId }, { $set: { couponsUnlocked: false, couponsSource: "revoked", couponsAt: new Date(), couponsBy: who } }, { upsert: true });
  } else return fail(res, 400, "Unknown action.");
  res.json({ status: true, message: action === "grant" ? `Coupons unlocked for ${u.name}.` : `Coupons turned off for ${u.name}.` });
});

// PUT /coupon/admin/addon-price { price } — Super Admin
export const adminCouponsPrice = expressAsyncHandler(async (req, res) => {
  const price = Math.round(Number(req.body?.price));
  if (!Number.isFinite(price) || price < 0 || price > 100000) return fail(res, 400, "Enter a valid price (₹0 = free for everyone).");
  await AssessmentPricing.updateOne({ key: "default" }, { $set: { couponsPrice: price, updatedBy: req.user?.email || req.user?.name || "" } }, { upsert: true });
  res.json({ status: true, message: "Price saved.", data: { price } });
});
