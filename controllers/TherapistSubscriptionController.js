import mongoose from "mongoose";
import expressAsyncHandler from "express-async-handler";
import Users from "../models/Users.js";
import Therapists from "../models/Therapists.js";
import TherapistSubscriptionPayment from "../models/TherapistSubscriptionPayment.js";
import { sendMail } from "../helper/mailer.js";
import { mailProfileLiveOnce } from "../helper/profileLive.js";
import { therapistSubscriptionReminderMail, therapistSubscriptionMail, REMINDER_TEMPLATES, funReminderMail } from "../services/mailTemplates.js";

const DAY = 86400000;
// the admin "show on page" toggle stores true/false, payments store 1 — both mean live
const LIVE_Q = { $in: [1, true] };
const isLive = (t) => t?.show_to_page === 1 || t?.show_to_page === true;

// Admin "Subscriptions" tracker: every approved therapist with their listing plan, dates and
// payment status. Rupee amounts are stripped for team members by hideRevenueForTeam.

// GET /admin/therapist-subscriptions
export const getTherapistSubscriptions = expressAsyncHandler(async (req, res) => {
  // approved therapists + anyone whose profile is live (even if their approval flag was never set)
  const liveIds = (await Therapists.find({ show_to_page: LIVE_Q }).select("user").lean()).map((t) => t.user);
  const users = await Users.find({ role: 1, $or: [{ is_verified: 1 }, { _id: { $in: liveIds } }] })
    .select("name email phone createdAt is_verified").lean();
  const ids = users.map((u) => u._id);
  const [therapists, paid] = await Promise.all([
    Therapists.find({ user: { $in: ids } })
      .select("user profile_type show_to_page preferred_plan subscription_plan subscription_amount subscription_started_at subscription_expires_at subscription_transaction_id subscription_reminded_at subscription_reminders")
      .lean(),
    TherapistSubscriptionPayment.aggregate([
      { $match: { user: { $in: ids } } },
      { $group: { _id: "$user", count: { $sum: 1 }, amount: { $sum: "$amount" }, lastPaidAt: { $max: "$createdAt" } } },
    ]),
  ]);
  const tByUser = new Map(therapists.map((t) => [String(t.user), t]));
  const pByUser = new Map(paid.map((p) => [String(p._id), p]));

  const rows = users.map((u) => {
    const t = tByUser.get(String(u._id)) || {};
    const p = pByUser.get(String(u._id));
    return {
      userId: u._id,
      name: u.name, email: u.email, phone: u.phone, approvedSince: u.createdAt,
      profileType: t.profile_type || "",
      live: isLive(t),
      approved: u.is_verified === 1,
      free: t.subscription_plan === "free",
      remindedAt: t.subscription_reminded_at || null,
      reminders: (t.subscription_reminders || []).slice(-10),
      preferredPlan: t.preferred_plan || null,
      plan: t.subscription_plan || null,
      amount: t.subscription_amount ?? null,
      startedAt: t.subscription_started_at || null,
      expiresAt: t.subscription_expires_at || null,
      paymentId: t.subscription_transaction_id || null,
      payments: p ? { count: p.count, amount: p.amount, lastPaidAt: p.lastPaidAt } : { count: t.subscription_transaction_id ? 1 : 0, amount: null, lastPaidAt: t.subscription_started_at || null },
    };
  });
  res.json({ status: true, data: rows });
});

// POST /admin/therapist-subscriptions/:userId/remind — email "choose a package" / "renew"
export const remindTherapistSubscription = expressAsyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(userId)) { res.status(400); return next(new Error("Invalid therapist.")); }
  const [user, t] = await Promise.all([
    Users.findOne({ _id: userId, role: 1 }).select("name email").lean(),
    Therapists.findOne({ user: userId }).select("subscription_expires_at subscription_reminded_at subscription_reminders show_to_page").lean(),
  ]);
  if (!user?.email) { res.status(404); return next(new Error("Therapist not found.")); }
  const active = t?.subscription_expires_at && new Date(t.subscription_expires_at) > new Date();
  if (active) { res.status(400); return next(new Error("This therapist already has an active package.")); }
  // live profiles stay free until the Super Admin decides otherwise — never chase them
  if (isLive(t)) { res.status(400); return next(new Error("This profile is live on the free arrangement — no reminder is sent.")); }
  if (t?.subscription_reminded_at && Date.now() - new Date(t.subscription_reminded_at).getTime() < 10 * 60 * 1000) {
    res.status(429); return next(new Error("A reminder was just sent — wait a few minutes before sending another."));
  }
  const expired = Boolean(t?.subscription_expires_at);
  const kind = expired ? "expired" : "unpaid";

  // a chosen fun template, "plain" for the straightforward one, or the next one this therapist hasn't had yet
  const want = String(req.body?.template || "auto");
  let template = null;
  if (want !== "plain") {
    template = REMINDER_TEMPLATES.find((x) => x.id === want && x.kind === kind);
    if (!template) {
      const sent = new Set((t?.subscription_reminders || []).map((r) => r.template));
      template = REMINDER_TEMPLATES.find((x) => x.kind === kind && !sent.has(x.id))
        || REMINDER_TEMPLATES.filter((x) => x.kind === kind)[(t?.subscription_reminders?.length || 0) % REMINDER_TEMPLATES.filter((x) => x.kind === kind).length];
    }
  }
  const ok = template
    ? await sendMail(user.email, template.subject, template.lines.join(" "), funReminderMail({ template, name: user.name, email: user.email }), "Choose Your Therapist")
    : await sendMail(user.email,
      expired ? "Your CYT profile is no longer live — renew to show up again" : "Your CYT profile is not live yet — choose a package to go live",
      "Choose a listing package to go live on Choose Your Therapist.",
      therapistSubscriptionReminderMail({ name: user.name, email: user.email, expired }), "Choose Your Therapist");
  if (!ok) { res.status(502); return next(new Error("Couldn't send the email right now. Try again.")); }
  const remindedAt = new Date();
  const entry = { template: template ? template.id : "plain", at: remindedAt, by: req.user?.name || "Admin" };
  await Therapists.updateOne({ user: userId }, { $set: { subscription_reminded_at: remindedAt }, $push: { subscription_reminders: entry } });
  res.json({ status: true, message: `Sent “${template ? template.subject : "plain reminder"}” to ${user.email}`, data: { remindedAt, reminder: entry } });
});

// GET /admin/therapist-subscriptions/reminder-templates — the fun reminders, for the picker
export const getReminderTemplates = (req, res) =>
  res.json({ status: true, data: REMINDER_TEMPLATES.map(({ id, kind, subject, heading, lines }) => ({ id, kind, subject, heading, lines })) });

// POST /admin/therapist-subscriptions/:userId/free — { months } : Super Admin grants a free listing
export const grantFreeSubscription = expressAsyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  if (req.user?.roleId) { res.status(403); return next(new Error("Only the Super Admin can give a free package.")); }
  if (!mongoose.Types.ObjectId.isValid(userId)) { res.status(400); return next(new Error("Invalid therapist.")); }
  const months = Number(req.body?.months);
  if (![1, 3, 6, 12].includes(months)) { res.status(400); return next(new Error("Choose 1, 3, 6 or 12 months.")); }
  const user = await Users.findOne({ _id: userId, role: 1 }).select("name email phone").lean();
  if (!user) { res.status(404); return next(new Error("Therapist not found.")); }

  // a free grant extends an active package instead of cutting it short
  const t = await Therapists.findOne({ user: userId }).select("subscription_expires_at").lean();
  const now = new Date();
  const from = t?.subscription_expires_at && new Date(t.subscription_expires_at) > now ? new Date(t.subscription_expires_at) : now;
  const expiresAt = new Date(from); expiresAt.setMonth(expiresAt.getMonth() + months);
  const grantId = `free_${userId}_${Date.now()}`;
  const by = req.user?.name || "Admin";

  await Therapists.updateOne({ user: userId }, { $set: {
    subscription_plan: "free", subscription_amount: 0,
    ...(from > now ? {} : { subscription_started_at: now }),
    subscription_expires_at: expiresAt, subscription_transaction_id: grantId, show_to_page: 1,
  } });
  const tDoc = await Therapists.findOne({ user: userId }).select("_id").lean();
  if (tDoc) mailProfileLiveOnce(tDoc._id);
  await TherapistSubscriptionPayment.create({
    user: userId, name: user.name, email: user.email, plan: "free", months, amount: 0,
    startedAt: from, expiresAt, paymentId: grantId, status: "free", grantedBy: by,
  });
  sendMail(user.email, "Your CYT listing is active", `Your listing is active until ${expiresAt.toDateString()}.`,
    therapistSubscriptionMail({ name: user.name, plan: "free", amount: 0, startedAt: from, expiresAt, paymentId: "Complimentary — no payment" }),
    "Choose Your Therapist").catch(() => {});
  res.json({ status: true, message: `${user.name || user.email}: free listing until ${expiresAt.toDateString()}`, data: { expiresAt } });
});

// GET /admin/therapist-subscriptions/:userId/payments — one therapist's payment history
export const getTherapistSubscriptionPayments = expressAsyncHandler(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.userId)) { res.status(400); return next(new Error("Invalid therapist.")); }
  const list = await TherapistSubscriptionPayment.find({ user: req.params.userId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ status: true, data: list });
});
