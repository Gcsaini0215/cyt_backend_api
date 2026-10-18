import expressAsyncHandler from "express-async-handler";
import Therapists from "../models/Therapists.js";
import TherapistSubscriptionPayment from "../models/TherapistSubscriptionPayment.js";
import TherapistAddon, { TherapistAddonOrder } from "../models/TherapistAddon.js";
import { addonStep } from "./TherapistAddonController.js";

/* GET /therapist/my-plans — everything a therapist pays CYT for, in one place: the listing package,
   the Clinical Assessments add-on and the Coupons upgrade — current status + full history from the start
   (Razorpay payments and free grants by CYT). */

const PLAN_LABEL = { "1_month": "1 month", "3_month": "3 months", "6_month": "6 months", annual: "12 months", free: "Free" };
const daysLeft = (till) => (till && new Date(till) > new Date() ? Math.ceil((new Date(till) - Date.now()) / 864e5) : 0);
const realId = (id) => (id && !/^free/i.test(id) ? id : "");

export const myPlans = expressAsyncHandler(async (req, res) => {
  const user = req.user._id;
  const [t, payments, addon, orders] = await Promise.all([
    Therapists.findOne({ user }).select("subscription_plan subscription_amount subscription_started_at subscription_expires_at subscription_transaction_id show_to_page").lean(),
    TherapistSubscriptionPayment.find({ user }).sort({ createdAt: -1 }).lean(),
    TherapistAddon.findOne({ user }).lean(),
    TherapistAddonOrder.find({ user, status: "paid" }).sort({ createdAt: -1 }).lean(),
  ]);

  // ── current status ────────────────────────────────────────────────────────────────────────────
  const listingTill = t?.subscription_expires_at || null;
  const listing = {
    plan: t?.subscription_plan || null, planLabel: PLAN_LABEL[t?.subscription_plan] || t?.subscription_plan || "",
    amount: t?.subscription_amount ?? null, from: t?.subscription_started_at || null, till: listingTill,
    active: daysLeft(listingTill) > 0, daysLeft: daysLeft(listingTill),
    live: t?.show_to_page === 1 || t?.show_to_page === true || t?.show_to_page === "1" || t?.show_to_page === "true",
  };
  const aTill = addon?.assessmentsTill || null;
  const assessments = {
    active: daysLeft(aTill) > 0, daysLeft: daysLeft(aTill), from: addon?.termFrom || null, till: aTill,
    step: addonStep(addon), source: addon?.lastSource || "", termMonths: 6,
  };
  const coupons = {
    active: !!addon?.couponsUnlocked, source: addon?.couponsSource || "", at: addon?.couponsAt || null, lifetime: true,
  };

  // ── history, newest first ─────────────────────────────────────────────────────────────────────
  const history = [
    ...payments.map((p) => ({
      product: "listing", label: `Listing package · ${PLAN_LABEL[p.plan] || p.plan}`, kind: p.status === "free" ? "free" : "paid",
      amount: p.status === "free" ? 0 : p.amount, from: p.startedAt, till: p.expiresAt, paymentId: realId(p.paymentId), by: p.grantedBy || "", at: p.createdAt,
    })),
    ...orders.map((o) => {
      const product = o.addon === "coupons" ? "coupons" : "assessments";
      return {
        product, label: product === "coupons" ? "Coupons upgrade · lifetime" : "Clinical Assessments · 6 months", kind: o.kind === "free" ? "free" : "paid",
        amount: o.amount, from: o.periodFrom || o.paidAt || o.createdAt, till: product === "coupons" ? null : o.periodTill, paymentId: realId(o.paymentId), by: o.grantedBy || "", at: o.paidAt || o.createdAt,
      };
    }),
  ];
  // a listing bought before payments were recorded: show what the profile remembers
  if (!payments.length && t?.subscription_started_at) {
    history.push({
      product: "listing", label: `Listing package · ${listing.planLabel || "plan"}`, kind: t.subscription_amount ? "paid" : "free",
      amount: t.subscription_amount || 0, from: t.subscription_started_at, till: listingTill, paymentId: realId(t.subscription_transaction_id), by: "", at: t.subscription_started_at,
    });
  }
  history.sort((x, y) => new Date(y.at || 0) - new Date(x.at || 0));

  res.json({
    status: true,
    data: {
      listing, assessments, coupons, history,
      totals: { paid: history.filter((h) => h.kind === "paid").reduce((n, h) => n + (h.amount || 0), 0), count: history.length, since: history.length ? history[history.length - 1].at : null },
    },
  });
});
