import expressAsyncHandler from "express-async-handler";
import crypto from "crypto";
import Users from "../models/Users.js";
import Therapists from "../models/Therapists.js";
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

// one more year, from today or from the current end date if still running. A free activation always
// needs an admin check; a paid renewal keeps an earlier verification.
async function extendYear(user, { source, amount = 0, paymentId = "" }) {
  const a = await TherapistAddon.findOne({ user }).lean();
  const from = a?.assessmentsTill && a.assessmentsTill > new Date() ? a.assessmentsTill : new Date();
  await TherapistAddon.updateOne({ user }, {
    $set: {
      assessmentsTill: new Date(new Date(from).getTime() + YEAR), lastSource: source, lastAmount: amount, lastPaymentId: paymentId, lastPaidAt: new Date(),
      ...(source === "free" ? { verified: false, verifiedAt: null, verifiedBy: "" } : {}),
    },
  }, { upsert: true });
}

// bookable for assessments: running, reg. no. given, checked by an admin
const LISTED = () => ({ assessmentsTill: { $gt: new Date() }, verified: true, regNo: { $nin: ["", null] } });
export async function assessmentsActive(userId) {
  return !!(await TherapistAddon.exists({ user: userId, ...LISTED() }));
}

// save the reg. no.; a new one has to be checked again
export async function setRegNo(user, regNo) {
  const v = String(regNo || "").trim().slice(0, 60);
  const a = await TherapistAddon.findOne({ user }).select("regNo").lean();
  if (a && (a.regNo || "") === v) return;
  await TherapistAddon.updateOne({ user }, { $set: { regNo: v, verified: false, verifiedAt: null, verifiedBy: "" } }, { upsert: true });
}

// GET /therapist-addon — this therapist's add-ons
export const myAddons = expressAsyncHandler(async (req, res) => {
  const [a, p] = await Promise.all([TherapistAddon.findOne({ user: req.user._id }).lean(), getPricing()]);
  const till = a?.assessmentsTill || null;
  res.json({ status: true, data: { assessments: { active: !!(till && till > new Date()), till, verified: !!a?.verified, regNo: a?.regNo || "", ...p.addon }, therapistShare: p.therapistShare, tests: p.tests } });
});

// POST /therapist-addon/details { regNo } — registration / licence no. (needs an admin check)
export const saveAddonDetails = expressAsyncHandler(async (req, res) => {
  const regNo = String(req.body?.regNo || "").trim();
  if (regNo.length < 3) return res.status(400).json({ status: false, message: "Enter your registration / licence number." });
  await setRegNo(req.user._id, regNo);
  res.json({ status: true, message: "Saved. CYT will verify it — clients see you for assessments once it is verified." });
});

// POST /therapist-addon/order — start the ₹499 payment (priced here, never by the browser)
export const createAddonOrder = expressAsyncHandler(async (req, res) => {
  const u = await Users.findById(req.user._id).select("is_verified").lean();
  if (u?.is_verified !== 1) return res.status(403).json({ status: false, message: "Add-ons can be bought once your profile is approved." });
  const price = (await getPricing()).addon.price;
  if (price === 0) {
    await extendYear(req.user._id, { source: "free" });
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
  if (claimed) await extendYear(req.user._id, { source: "paid", amount: order.amount, paymentId });
  const a = await TherapistAddon.findOne({ user: req.user._id }).lean();
  res.json({ status: true, message: "Clinical Assessments activated.", data: { till: a?.assessmentsTill } });
});

// GET /assessment-providers — user ids of therapists who can be booked for clinical assessments
export const assessmentProviders = expressAsyncHandler(async (req, res) => {
  const rows = await TherapistAddon.find(LISTED()).select("user").lean();
  res.json({ status: true, data: rows.map((r) => String(r.user)) });
});

// ── admin ──────────────────────────────────────────────────────────────────────────────────────
// GET /admin/assessment-addons — every therapist with the add-on (or a reg. no. waiting for a check)
export const adminAddons = expressAsyncHandler(async (req, res) => {
  const rows = await TherapistAddon.find({ $or: [{ assessmentsTill: { $ne: null } }, { regNo: { $nin: ["", null] } }] }).populate("user", "name email phone").sort({ updatedAt: -1 }).lean();
  const ids = rows.map((r) => r.user?._id).filter(Boolean);
  const [ther, orders] = await Promise.all([
    Therapists.find({ user: { $in: ids } }).select("user profile_type").lean(),
    TherapistAddonOrder.find({ user: { $in: ids }, status: "paid" }).select("user amount paymentId createdAt").sort({ createdAt: -1 }).lean(),
  ]);
  const typeOf = Object.fromEntries(ther.map((t) => [String(t.user), t.profile_type]));
  res.json({
    status: true,
    data: rows.filter((r) => r.user).map((r) => {
      const paid = orders.filter((o) => String(o.user) === String(r.user._id));
      return {
        userId: r.user._id, name: r.user.name, email: r.user.email, phone: r.user.phone || "", profileType: typeOf[String(r.user._id)] || "",
        regNo: r.regNo || "", till: r.assessmentsTill, active: !!(r.assessmentsTill && r.assessmentsTill > new Date()),
        verified: !!r.verified, verifiedAt: r.verifiedAt, verifiedBy: r.verifiedBy, listed: !!(r.verified && r.regNo && r.assessmentsTill && r.assessmentsTill > new Date()),
        lastSource: r.lastSource || "", lastAmount: r.lastAmount, lastPaymentId: r.lastPaymentId || "", lastPaidAt: r.lastPaidAt,
        payments: paid.map((o) => ({ amount: o.amount, paymentId: o.paymentId, at: o.createdAt })),
      };
    }),
  });
});

// POST /admin/assessment-addons/:userId { action: "verify" | "unverify" | "revoke" }
export const adminAddonAction = expressAsyncHandler(async (req, res) => {
  const a = await TherapistAddon.findOne({ user: req.params.userId });
  if (!a) return res.status(404).json({ status: false, message: "Not found." });
  const who = req.user?.email || req.user?.name || "admin";
  const action = req.body?.action;
  if (action === "verify") {
    if (!a.regNo) return res.status(400).json({ status: false, message: "The therapist has not added a registration / licence number yet." });
    a.verified = true; a.verifiedAt = new Date(); a.verifiedBy = who;
  } else if (action === "unverify") {
    a.verified = false; a.verifiedAt = null; a.verifiedBy = "";
  } else if (action === "revoke") {
    a.assessmentsTill = null; a.verified = false; a.verifiedAt = null; a.verifiedBy = ""; a.lastSource = "revoked";
  } else return res.status(400).json({ status: false, message: "Unknown action." });
  await a.save();
  res.json({ status: true, message: action === "verify" ? "Verified — clients can now book assessments with this therapist." : action === "revoke" ? "Add-on removed." : "Verification removed — hidden from clients." });
});
