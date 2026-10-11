import mongoose from "mongoose";
import Razorpay from "razorpay";
import Users from "../models/Users.js";
import Therapists from "../models/Therapists.js";
import TherapistSubscriptionOrder from "../models/TherapistSubscriptionOrder.js";
import TherapistSubscriptionPayment from "../models/TherapistSubscriptionPayment.js";
import { sendMail } from "./mailer.js";
import { mailProfileLiveOnce } from "./profileLive.js";
import { therapistSubscriptionMail, adminSubscriptionMail } from "../services/mailTemplates.js";

// Therapist listing packages: prices, activation and the safety net that activates paid
// orders nobody confirmed (closed tab after UPI, lost signal, no webhook).

// "3_month" is no longer sold; kept so an order already paid on an old page still activates
export const PLAN_MONTHS = { "1_month": 1, "3_month": 3, "6_month": 6, "annual": 12 };
export const PLAN_AMOUNTS = { "1_month": 999, "3_month": 1999, "6_month": 4999, "annual": 7300 }; // annual = ₹20 / day

export const razorpayClient = () => new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });

/* Turns a confirmed payment into an active package — exactly once per order/payment.
   Returns { plan, amount, startedAt, expiresAt, already } or null if there's nothing to activate. */
export async function activateTherapistSubscription({ userId, plan, orderId, paymentId, termsVersion = "", source = "browser" }) {
  if (!PLAN_MONTHS[plan]) return null;

  // the claim: only the first caller moves this order from pending to paid
  const orderDoc = await TherapistSubscriptionOrder.findOne({ orderId }).lean();
  if (orderDoc) {
    const claimed = await TherapistSubscriptionOrder.findOneAndUpdate(
      { orderId, status: { $ne: "paid" } },
      { $set: { status: "paid", paymentId, paidAt: new Date(), activatedBy: source } },
      { new: true }
    );
    if (!claimed) return currentPackage(userId, true);
  } else if (await TherapistSubscriptionPayment.exists({ paymentId })) {
    return currentPackage(userId, true); // order from before orders were recorded, already handled
  }

  const user = await Users.findById(userId).select("name email phone").lean();
  const startedAt = new Date();
  const expiresAt = new Date(startedAt);
  expiresAt.setMonth(expiresAt.getMonth() + PLAN_MONTHS[plan]);
  const version = String(termsVersion || orderDoc?.termsVersion || "v1").slice(0, 20);

  const therapist = await Therapists.findOneAndUpdate(
    { user: userId },
    {
      subscription_plan: plan,
      subscription_amount: PLAN_AMOUNTS[plan],
      subscription_started_at: startedAt,
      subscription_expires_at: expiresAt,
      subscription_transaction_id: paymentId,
      subscription_terms_accepted_at: new Date(),
      subscription_terms_version: version,
      show_to_page: 1, // payment activates the public profile
    },
    { new: true, upsert: true }
  );
  if (therapist?._id) mailProfileLiveOnce(therapist._id); // first time live → public link mail

  try {
    await TherapistSubscriptionPayment.create({
      user: userId, name: user?.name, email: user?.email, plan, months: PLAN_MONTHS[plan], amount: PLAN_AMOUNTS[plan],
      startedAt, expiresAt, orderId, paymentId, termsVersion: version,
    });
    if (user?.email) {
      const info = { name: user.name, email: user.email, phone: user.phone, plan, amount: PLAN_AMOUNTS[plan], startedAt, expiresAt, paymentId };
      sendMail(user.email, "Payment received — your CYT listing is active", `Your listing is active until ${expiresAt.toDateString()}. Payment ID ${paymentId}.`, therapistSubscriptionMail(info), "Choose Your Therapist").catch(() => {});
      sendMail("hello@chooseyourtherapist.in", `Listing payment: ${user.name || user.email} (₹${PLAN_AMOUNTS[plan]})`, `${user.name} paid ₹${PLAN_AMOUNTS[plan]} for ${plan} (${source}).`, adminSubscriptionMail(info), "CYT Alerts").catch(() => {});
    }
  } catch (err) {
    if (err?.code !== 11000) console.error("subscription payment record/email failed:", err.message);
  }
  console.log(`subscription activated: ${user?.email} ${plan} order ${orderId} payment ${paymentId} via ${source}`);
  return { plan, amount: PLAN_AMOUNTS[plan], startedAt, expiresAt, already: false };
}

async function currentPackage(userId, already) {
  const t = await Therapists.findOne({ user: userId }).select("subscription_plan subscription_amount subscription_started_at subscription_expires_at").lean();
  return t ? { plan: t.subscription_plan, amount: t.subscription_amount, startedAt: t.subscription_started_at, expiresAt: t.subscription_expires_at, already } : null;
}

/* A captured payment on one of our package orders → activate (used by the webhook and the job). */
export async function activateFromRazorpayPayment(payment, source) {
  const order = await TherapistSubscriptionOrder.findOne({ orderId: payment.order_id }).lean();
  if (!order || order.status === "paid") return null;
  if (payment.status !== "captured" || Number(payment.amount) !== order.amount * 100 || (payment.currency || "INR") !== "INR") {
    console.error("subscription: payment does not match order", JSON.stringify({ order: order.orderId, paid: payment.amount, expected: order.amount * 100, status: payment.status }));
    return null;
  }
  return activateTherapistSubscription({ userId: order.user, plan: order.plan, orderId: order.orderId, paymentId: payment.id, termsVersion: order.termsVersion, source });
}

// Every couple of minutes: package orders still pending (older than 90 s, younger than a day)
// are checked with Razorpay; a captured payment of the right amount activates the package.
const EVERY_MS = 2 * 60 * 1000;
const MIN_AGE_MS = 90 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
let running = false;
export const reconcileSource = { fetchPayments: (orderId) => razorpayClient().orders.fetchPayments(orderId) }; // overridable in tests

export async function reconcilePendingSubscriptionOrders() {
  if (running || mongoose.connection.readyState !== 1) return;
  running = true;
  try {
    const now = Date.now();
    // give up on day-old orders that were never paid
    await TherapistSubscriptionOrder.updateMany({ status: "pending", createdAt: { $lt: new Date(now - MAX_AGE_MS) } }, { $set: { status: "expired" } });
    const rows = await TherapistSubscriptionOrder.find({
      status: "pending", createdAt: { $lte: new Date(now - MIN_AGE_MS), $gte: new Date(now - MAX_AGE_MS) },
    }).sort({ createdAt: 1 }).limit(50).lean();
    for (const row of rows) {
      try {
        const payments = await reconcileSource.fetchPayments(row.orderId);
        const paid = (payments?.items || []).find((p) => p.status === "captured");
        if (!paid) continue;
        const out = await activateFromRazorpayPayment({ ...paid, order_id: row.orderId }, "reconcile");
        if (out) console.log(`subscription reconcile: ${row.orderId} / ${paid.id} -> activated`);
      } catch (err) {
        console.error("subscription reconcile:", row.orderId, err?.error?.description || err?.message || err);
      }
    }
  } finally {
    running = false;
  }
}

let timer = null;
export function startSubscriptionReconcile() {
  if (timer) return;
  timer = setInterval(() => { reconcilePendingSubscriptionOrders().catch((e) => console.error("subscription reconcile:", e?.message)); }, EVERY_MS);
  timer.unref();
}
