import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Role from "../models/Role.js";
import Booking from "../models/Booking.js";
import Transaction from "../models/Transaction.js";
import Lead from "../models/Lead.js";
import Therapists from "../models/Therapists.js";
import Review from "../models/Review.js";
import User from "../models/Users.js";
import NoidaAppointment from "../models/NoidaAppointment.js";
import NoidaLastMinuteRequest from "../models/NoidaLastMinuteRequest.js";
import AssessmentRequest, { AssessmentOrder } from "../models/AssessmentRequest.js";
import TherapistSubscriptionPayment from "../models/TherapistSubscriptionPayment.js";
import TherapistPayout from "../models/TherapistPayout.js";
import Trainee from "../models/Trainee.js";
import TraineeAccount from "../models/TraineeAccount.js";
import CollabApplication from "../models/CollabApplication.js";
import WorkshopBooking from "../models/WorkshopBooking.js";
import TherapistActionRequest from "../models/TherapistActionRequest.js";
import "../models/Workshop.js";
import { TEST_BY_KEY } from "../helper/assessmentTests.js";

/* GET /api/admin/activity-feed?since=<ISO> — everything that happened across the admin, newest first:
   bookings (pending / paid / completed / cancelled), payments, leads, therapist sign-ups, reviews,
   Noida bookings + last-minute requests, assessments, therapist plans, payouts, internships,
   trainee accounts, collaborations, workshops and new clients. Built live from the collections
   (no extra writes) and filtered by the admin's role; amounts only for super admins. */

const LIMIT = 25; // per source
const num = (v) => (v && typeof v === "object" && v.$numberDecimal != null ? Number(v.$numberDecimal) : Number(v) || 0);
const inr = (n) => `₹${Math.round(num(n)).toLocaleString("en-IN")}`;
const idSince = (d) => mongoose.Types.ObjectId.createFromTime(Math.floor(d.getTime() / 1000));
const at = (doc) => doc._id.getTimestamp();

export const activityFeed = expressAsyncHandler(async (req, res) => {
  const since = req.query.since && !Number.isNaN(Date.parse(req.query.since)) ? new Date(req.query.since) : new Date(Date.now() - 7 * 864e5);
  const floor = new Date(Date.now() - 30 * 864e5);
  const from = since < floor ? floor : since;
  const byId = { _id: { $gt: idSince(from) } };
  const isSuper = !req.user?.roleId;
  let perms = [];
  if (!isSuper) perms = (await Role.findById(req.user.roleId).select("permissions").lean())?.permissions || [];
  const can = (k) => isSuper || k === "*" || perms.includes(k);
  const money = (n) => (isSuper ? ` · ${inr(n)}` : "");
  const items = [];
  const push = (perm, it) => { if (can(perm)) items.push(it); };

  const tName = { path: "therapist", select: "user", populate: { path: "user", select: "name" } };
  const jobs = [];
  if (can("bookings")) {
    jobs.push(Booking.find(byId).populate(tName).populate({ path: "client", select: "name" }).sort({ _id: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((b) => {
      const who = `${b.client?.name || b.cname || "A client"} with ${b.therapist?.user?.name || "a therapist"}`;
      const paid = b.payment_status === "Paid";
      push("bookings", { id: `bk:${b._id}`, type: "booking", tone: paid ? "green" : b.payment_status === "Payment Failed" ? "red" : "amber", title: paid ? "New booking · paid" : b.payment_status === "Payment Failed" ? "Booking · payment failed" : "New booking · payment pending", body: `${who}${money(b.amount)}`, link: "/appointments", at: at(b) });
    })));
    jobs.push(Booking.find({ session_completed_at: { $gt: from } }).populate(tName).populate({ path: "client", select: "name" }).sort({ session_completed_at: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((b) => {
      push("bookings", { id: `bkc:${b._id}`, type: "session", tone: "teal", title: "Session completed", body: `${b.client?.name || "Client"} with ${b.therapist?.user?.name || "therapist"}`, link: "/appointments", at: b.session_completed_at });
    })));
    jobs.push(Transaction.find({ ...byId, is_payment_success: true }).populate({ path: "user", select: "name" }).sort({ _id: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((t) => {
      push("bookings", { id: `tx:${t._id}`, type: "payment", tone: "green", title: "Payment received", body: `${t.user?.name || "A client"}${money(t.amount)}${t.transaction_id ? ` · ${t.transaction_id}` : ""}`, link: "/invoices", at: at(t) });
    })));
  }
  if (can("leads")) jobs.push(Lead.find(byId).sort({ _id: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((l) => {
    push("leads", { id: `ld:${l._id}`, type: "lead", tone: "blue", title: "New lead", body: [l.name || l.fullName, l.phone, l.service || l.concern].filter(Boolean).join(" · ") || "Website enquiry", link: "/leads", at: at(l) });
  })));
  if (can("therapists")) {
    jobs.push(Therapists.find(byId).populate({ path: "user", select: "name is_verified" }).sort({ _id: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((t) => {
      push("therapists", { id: `th:${t._id}`, type: "therapist", tone: "violet", title: "New therapist registered", body: `${t.user?.name || "Therapist"}${t.profile_type ? ` · ${t.profile_type}` : ""}${t.user?.is_verified ? "" : " · waiting for approval"}`, link: "/therapists", at: at(t) });
    })));
    jobs.push(AssessmentOrder.find({ ...byId, status: "paid" }).populate({ path: "user", select: "name" }).sort({ _id: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((o) => {
      push("therapists", { id: `ao:${o._id}`, type: "assessment", tone: "violet", title: "Assessment bought", body: `${o.user?.name || "A client"} · ${TEST_BY_KEY[o.tool]?.short || o.tool}${money(o.amount)}`, link: "/client-360", at: at(o) });
    })));
    jobs.push(AssessmentRequest.find({ status: "done", doneAt: { $gt: from } }).populate({ path: "client", select: "name" }).sort({ doneAt: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((r) => {
      push("therapists", { id: `ar:${r._id}`, type: "assessment", tone: "amber", title: "Assessment completed · waiting for review", body: `${r.client?.name || "Client"} · ${TEST_BY_KEY[r.tool]?.short || r.tool}`, link: "/client-360", at: r.doneAt });
    })));
    jobs.push(TherapistSubscriptionPayment.find(byId).sort({ _id: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((p) => {
      push("therapists", { id: `sp:${p._id}`, type: "plan", tone: "gold", title: p.status === "free" ? "Therapist plan given free" : "Therapist plan payment", body: `${p.name || p.email || "Therapist"}${p.status === "free" ? "" : money(p.amount)}`, link: "/subscriptions", at: at(p) });
    })));
    jobs.push(TherapistActionRequest.find({ status: "done", doneAt: { $gt: from } }).sort({ doneAt: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((r) => {
      push("therapists", { id: `tr:${r._id}`, type: "therapist", tone: "teal", title: "Therapist finished a request", body: r.title || r.body?.slice(0, 80) || "Request done", link: "/therapist-comms", at: r.doneAt });
    })));
  }
  if (can("reviews")) jobs.push(Review.find(byId).populate({ path: "therapist_id", select: "user", populate: { path: "user", select: "name" } }).sort({ _id: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((r) => {
    push("reviews", { id: `rv:${r._id}`, type: "review", tone: (r.rating || 0) >= 4 ? "gold" : "red", title: `New ${r.rating || ""}★ review`, body: `${r.name || "Client"} for ${r.therapist_id?.user?.name || "a therapist"}`, link: "/reviews", at: at(r) });
  })));
  if (can("noidaCenter")) {
    jobs.push(NoidaAppointment.find(byId).sort({ _id: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((n) => {
      const paid = n.paymentStatus === "paid";
      push("noidaCenter", { id: `na:${n._id}`, type: "noida", tone: n.status === "cancelled" ? "red" : paid ? "green" : "amber", title: n.status === "cancelled" ? "Noida booking cancelled" : paid ? "Noida booking · paid" : n.paymentStatus === "package-credit" ? "Noida booking · package credit" : "Noida booking · payment pending", body: `${n.name} · ${n.date} ${n.slot}${paid ? money(n.amount) : ""}`, link: "/noida-appointments", at: at(n) });
    })));
    jobs.push(NoidaLastMinuteRequest.find({ ...byId, status: "pending" }).sort({ _id: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((n) => {
      push("noidaCenter", { id: `lm:${n._id}`, type: "urgent", tone: "red", title: "Last-minute Noida request", body: `${n.name || "Client"} · ${n.date || ""} ${n.slot || ""}`, link: "/noida-appointments?view=lastMinute", at: at(n) });
    })));
    jobs.push(CollabApplication.find(byId).sort({ _id: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((c) => {
      push("noidaCenter", { id: `co:${c._id}`, type: "collab", tone: "blue", title: "New collaboration request", body: [c.name, c.qualification].filter(Boolean).join(" · ") || c.email, link: "/collaborations", at: at(c) });
    })));
  }
  if (can("probono")) {
    jobs.push(Trainee.find(byId).sort({ _id: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((t) => {
      push("probono", { id: `tn:${t._id}`, type: "intern", tone: "teal", title: `Internship ${t.paymentStatus === "paid" ? "application · paid" : "application"}`, body: `${t.name} · ${t.hours || ""}${t.paymentStatus === "paid" ? money(t.programFee) : ""}`, link: "/internship-applications", at: at(t) });
    })));
    jobs.push(TraineeAccount.find({ ...byId, verified: true }).sort({ _id: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((a) => {
      push("probono", { id: `ta:${a._id}`, type: "intern", tone: "amber", title: a.approval === "pending" ? "Trainee account waiting for approval" : "New trainee account", body: `${[a.firstName, a.lastName].filter(Boolean).join(" ")} · ${a.email}`, link: "/internship-applications", at: at(a) });
    })));
  }
  if (can("clients")) jobs.push(User.find({ ...byId, role: 0 }).sort({ _id: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((u) => {
    push("clients", { id: `us:${u._id}`, type: "client", tone: "blue", title: "New client signed up", body: [u.name, u.email].filter(Boolean).join(" · "), link: `/client-360/${u._id}`, at: at(u) });
  })));
  jobs.push(WorkshopBooking.find({ ...byId, is_payment_success: true }).populate({ path: "workshop", select: "name title" }).populate({ path: "user", select: "name" }).sort({ _id: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((w) => {
    push("bookings", { id: `wb:${w._id}`, type: "workshop", tone: "gold", title: "Workshop sign-up · paid", body: `${w.user?.name || "Someone"} · ${w.workshop?.name || w.workshop?.title || "Workshop"}${money(w.amount)}`, link: "/client-360", at: at(w) });
  })));
  if (isSuper) jobs.push(TherapistPayout.find({ status: "paid", paidAt: { $gt: from } }).sort({ paidAt: -1 }).limit(LIMIT).lean().then((rows) => rows.forEach((p) => {
    items.push({ id: `po:${p._id}`, type: "payout", tone: "green", title: "Payout sent", body: `${inr(p.amount)}${p.reference ? ` · ${p.reference}` : ""}`, link: "/therapist-payouts", at: p.paidAt });
  })));

  await Promise.allSettled(jobs);
  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  res.json({ status: true, data: items.slice(0, 120), now: new Date() });
});
