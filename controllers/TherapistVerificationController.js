// Admin review of therapist applications: checklist, reject (with an emailed reason) and
// "please re-upload" requests. A re-upload request emails the therapist a one-time link
// (valid 7 days); only a hash of its token is stored.

import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import crypto from "crypto";
import Therapists from "../models/Therapists.js";
import Users from "../models/Users.js";
import { sendMail } from "../helper/mailer.js";
import { therapistApplicationRejectedMail, therapistReuploadMail, therapistPaymentMail, therapistCompleteProfileMail } from "../services/mailTemplates.js";
import { emitStaff } from "../services/staffEvents.js";

const SITE = (process.env.SITE_URL || "https://www.chooseyourtherapist.in").replace(/\/$/, "");
const DOCS = {
  resume: "Resume / CV",
  qualification_certificate: "Highest qualification certificate",
  id_card: "ID card",
};
const CHECKS = ["id_matches", "degree_valid", "docs_clear", "about_ok"];
const REUPLOAD_DAYS = 7;

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

async function findApplication(id) {
  if (!mongoose.isValidObjectId(id)) return null;
  return Therapists.findById(id).populate("user", "name email is_verified");
}

/* PATCH /therapist-verification/:id/checklist — { checklist: { id_matches: true, ... } } */
export const saveVerificationChecklist = expressAsyncHandler(async (req, res) => {
  const t = await findApplication(req.params.id);
  if (!t) return res.status(404).json({ status: false, message: "Application not found" });
  const incoming = req.body?.checklist || {};
  const checklist = {};
  for (const k of CHECKS) checklist[k] = !!incoming[k];
  t.verification_checklist = checklist;
  await t.save();
  res.json({ status: true, data: { verification_checklist: checklist } });
});

/* POST /therapist-verification/:id/reject — { reason } */
export const rejectTherapistApplication = expressAsyncHandler(async (req, res) => {
  const reason = String(req.body?.reason || "").trim().slice(0, 600);
  if (reason.length < 5) return res.status(400).json({ status: false, message: "Please write the reason (it is emailed to the therapist)." });
  const t = await findApplication(req.params.id);
  if (!t) return res.status(404).json({ status: false, message: "Application not found" });
  if (t.user?.is_verified === 1) return res.status(400).json({ status: false, message: "This therapist is already approved." });

  t.verification_status = "rejected";
  t.verification_note = reason;
  t.reupload_docs = [];
  t.reupload_token_hash = null;
  t.reupload_expires = null;
  t.verified_by = req.user?._id || null;
  t.verified_at = new Date();
  await t.save();

  let mailed = false;
  if (t.user?.email) {
    mailed = !!(await sendMail(
      t.user.email,
      "Update on your Choose Your Therapist application",
      `Your application could not be approved. Reason: ${reason}`,
      therapistApplicationRejectedMail({ name: t.user.name, reason })
    ).catch(() => false));
  }
  res.json({ status: true, message: mailed ? "Rejected and emailed the therapist." : "Rejected (email could not be sent).", data: { verification_status: "rejected" } });
});

/* POST /therapist-verification/:id/reupload — { docs: ["id_card", ...], note } */
export const requestTherapistReupload = expressAsyncHandler(async (req, res) => {
  const docs = [...new Set((req.body?.docs || []).filter((d) => DOCS[d]))];
  if (!docs.length) return res.status(400).json({ status: false, message: "Choose at least one document to re-upload." });
  const note = String(req.body?.note || "").trim().slice(0, 600);
  const t = await findApplication(req.params.id);
  if (!t) return res.status(404).json({ status: false, message: "Application not found" });
  if (!t.user?.email) return res.status(400).json({ status: false, message: "This application has no email address." });

  const token = crypto.randomBytes(32).toString("hex");
  t.verification_status = "reupload";
  t.verification_note = note;
  t.reupload_docs = docs;
  t.reupload_token_hash = sha256(token);
  t.reupload_expires = new Date(Date.now() + REUPLOAD_DAYS * 24 * 60 * 60 * 1000);
  t.verified_by = req.user?._id || null;
  t.verified_at = new Date();
  await t.save();

  const link = `${SITE}/therapist-reupload?token=${token}`;
  const mailed = !!(await sendMail(
    t.user.email,
    "Please re-upload a document for your application",
    `Please re-upload: ${docs.map((d) => DOCS[d]).join(", ")}. Link: ${link}`,
    therapistReuploadMail({ name: t.user.name, docs: docs.map((d) => DOCS[d]), note, link })
  ).catch(() => false));

  res.json({ status: true, message: mailed ? "Re-upload request emailed." : "Saved, but the email could not be sent.", data: { verification_status: "reupload", reupload_docs: docs } });
});

async function findByToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  const t = await Therapists.findOne({ reupload_token_hash: sha256(token), verification_status: "reupload" }).populate("user", "name");
  if (!t || !t.reupload_expires || t.reupload_expires < new Date()) return null;
  return t;
}

/* GET /therapist-reupload/:token — public: what to upload */
export const getReuploadRequest = expressAsyncHandler(async (req, res) => {
  const t = await findByToken(req.params.token);
  if (!t) return res.status(404).json({ status: false, message: "This link has expired or was already used." });
  res.json({
    status: true,
    data: {
      name: t.user?.name || "",
      docs: t.reupload_docs.map((d) => ({ key: d, label: DOCS[d] })),
      note: t.verification_note || "",
      expires: t.reupload_expires,
    },
  });
});

/* POST /therapist-reupload/:token — public multipart: resume / qualification_certificate / id_card */
export const submitReupload = expressAsyncHandler(async (req, res) => {
  const t = await findByToken(req.params.token);
  if (!t) return res.status(404).json({ status: false, message: "This link has expired or was already used." });
  const update = {};
  for (const d of t.reupload_docs) {
    const f = req.files?.[d]?.[0];
    if (!f) return res.status(400).json({ status: false, message: `Please upload your ${DOCS[d].toLowerCase()}.` });
    update[d] = f.filename;
  }
  Object.assign(t, update, {
    verification_status: "pending",
    reupload_docs: [],
    reupload_token_hash: null,
    reupload_expires: null,
  });
  if (req.body?.idCardType && update.id_card) t.id_card_type = String(req.body.idCardType).slice(0, 40);
  await t.save();

  const user = await Users.findById(t.user?._id || t.user, "name email");
  sendMail(
    "chooseyourtherapist@gmail.com",
    `Documents re-uploaded: ${user?.name || "therapist"}`,
    `${user?.name || "A therapist"} (${user?.email || ""}) re-uploaded: ${Object.keys(update).map((d) => DOCS[d]).join(", ")}. Review it in admin → Therapists.`,
    `<p>${(user?.name || "A therapist").replace(/[<>&]/g, "")} re-uploaded: ${Object.keys(update).map((d) => DOCS[d]).join(", ")}.</p><p>Review it in admin → Therapists.</p>`
  ).catch(() => {});

  res.json({ status: true, message: "Thank you — your documents were uploaded. We'll review them shortly." });
});

/* ── subscription: email the payment link again (approved therapists) ───── */
/* POST /therapist-verification/:id/payment-link */
export const sendPaymentLink = expressAsyncHandler(async (req, res) => {
  const t = await findApplication(req.params.id);
  if (!t) return res.status(404).json({ status: false, message: "Therapist not found" });
  if (t.user?.is_verified !== 1) return res.status(400).json({ status: false, message: "Approve the therapist first." });
  if (!t.user?.email) return res.status(400).json({ status: false, message: "This therapist has no email address." });
  const mailed = !!(await sendMail(t.user.email, "Activate your Choose Your Therapist profile", "Choose a plan to make your profile live.",
    therapistPaymentMail({ name: t.user.name, email: t.user.email })).catch(() => false));
  res.json({ status: mailed, message: mailed ? "Payment link emailed." : "The email could not be sent." });
});

/* ── profile completeness: what each therapist still has to fill ───────── */
const DEFAULT_PHOTO = "pngegg.com";
const COMPLETE_ITEMS = {
  photo: { label: "Profile photo", kind: "file" },
  bio: { label: "About you (50–250 words)", kind: "text" },
  qualification: { label: "Qualification", kind: "text" },
  experience: { label: "Years of experience", kind: "text" },
  languages: { label: "Languages you speak", kind: "text" },
  location: { label: "City / state", kind: "text" },
  specialisation: { label: "Areas you specialise in", kind: "text" },
  resume: { label: "Resume / CV", kind: "file" },
  qualification_certificate: { label: "Qualification certificate", kind: "file" },
  id_card: { label: "ID card", kind: "file" },
  fees: { label: "Session fees (set in your dashboard)", kind: "dashboard" },
  availability: { label: "Weekly availability (set in your dashboard)", kind: "dashboard" },
};
const words = (s) => String(s || "").replace(/<[^>]*>/g, " ").trim().split(/\s+/).filter(Boolean).length;

export function profileGaps(t, user) {
  const gaps = [];
  if (!user?.profile || String(user.profile).includes(DEFAULT_PHOTO)) gaps.push("photo");
  if (words(user?.bio) < 50) gaps.push("bio");
  if (!t.qualification) gaps.push("qualification");
  if (!t.year_of_exp) gaps.push("experience");
  if (!t.language_spoken) gaps.push("languages");
  if (!(t.state || user?.state)) gaps.push("location");
  if (!(t.experties || t.services)) gaps.push("specialisation");
  if (!t.resume) gaps.push("resume");
  if (!t.qualification_certificate) gaps.push("qualification_certificate");
  if (!t.id_card) gaps.push("id_card");
  const hasFee = (t.fees || []).some((f) => (f.formats || []).some((x) => Number(x.fee) > 0)) || Number(t.fee) > 0;
  if (!hasFee) gaps.push("fees");
  if (!(t.availabilities || []).some((a) => (a.times || []).length)) gaps.push("availability");
  return gaps;
}

const COMPLETE_DAYS = 14;

async function sendCompletionRequest(t, items, note, adminId) {
  const token = crypto.randomBytes(32).toString("hex");
  t.completion_items = items;
  t.completion_note = note;
  t.completion_token_hash = sha256(token);
  t.completion_expires = new Date(Date.now() + COMPLETE_DAYS * 24 * 60 * 60 * 1000);
  t.completion_requested_at = new Date();
  t.verified_by = adminId || t.verified_by;
  await t.save();
  const link = `${SITE}/therapist-complete?token=${token}`;
  return !!(await sendMail(
    t.user.email,
    "Please complete your Choose Your Therapist profile",
    `Please add: ${items.map((i) => COMPLETE_ITEMS[i].label).join(", ")}. Link: ${link}`,
    therapistCompleteProfileMail({ name: t.user.name, items: items.map((i) => COMPLETE_ITEMS[i].label), note, link, live: t.show_to_page === 1 })
  ).catch(() => false));
}

/* GET /therapist-profile-gaps — admin: every therapist with what's missing */
export const listProfileGaps = expressAsyncHandler(async (req, res) => {
  const list = await Therapists.find({}).populate("user", "name email profile bio state is_verified createdAt").lean();
  const out = list.filter((t) => t.user).map((t) => ({
    id: t._id, name: t.user.name, email: t.user.email, profileType: t.profile_type || "",
    stage: t.user.is_verified !== 1 ? "review" : t.show_to_page === 1 ? "live" : "hidden",
    gaps: profileGaps(t, t.user),
    requestedAt: t.completion_requested_at, submittedAt: t.completion_submitted_at, recheck: !!t.profile_recheck,
  }));
  res.json({ status: true, data: { items: Object.fromEntries(Object.entries(COMPLETE_ITEMS).map(([k, v]) => [k, v.label])), therapists: out } });
});

/* POST /therapist-verification/:id/complete-profile — { items?: [], note } (items default to everything missing) */
export const requestProfileCompletion = expressAsyncHandler(async (req, res) => {
  const t = await findApplication(req.params.id);
  if (!t) return res.status(404).json({ status: false, message: "Therapist not found" });
  if (!t.user?.email) return res.status(400).json({ status: false, message: "This therapist has no email address." });
  const user = await Users.findById(t.user._id, "profile bio state");
  const requested = Array.isArray(req.body?.items) ? req.body.items.filter((i) => COMPLETE_ITEMS[i]) : null;
  const items = requested?.length ? [...new Set(requested)] : profileGaps(t, user);
  if (!items.length) return res.status(400).json({ status: false, message: "This profile is already complete." });
  const note = String(req.body?.note || "").trim().slice(0, 600);
  const mailed = await sendCompletionRequest(t, items, note, req.user?._id);
  res.json({ status: true, message: mailed ? "Email sent." : "Saved, but the email could not be sent.", data: { items, mailed } });
});

/* POST /therapist-profile-gaps/notify — { ids: [], note } bulk: each gets their own missing items */
export const notifyProfileGaps = expressAsyncHandler(async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((i) => mongoose.isValidObjectId(i)).slice(0, 500);
  if (!ids.length) return res.status(400).json({ status: false, message: "Pick at least one therapist." });
  const note = String(req.body?.note || "").trim().slice(0, 600);
  let sent = 0, skipped = 0, failed = 0;
  for (const id of ids) {
    const t = await findApplication(id);
    if (!t?.user?.email) { skipped++; continue; }
    const user = await Users.findById(t.user._id, "profile bio state");
    const items = profileGaps(t, user);
    if (!items.length) { skipped++; continue; }
    (await sendCompletionRequest(t, items, note, req.user?._id)) ? sent++ : failed++;
  }
  res.json({ status: true, message: `Sent ${sent}${skipped ? `, skipped ${skipped} (complete or no email)` : ""}${failed ? `, ${failed} failed` : ""}.`, data: { sent, skipped, failed } });
});

/* PATCH /therapist-verification/:id/rechecked — admin looked at a resubmitted profile */
export const markRechecked = expressAsyncHandler(async (req, res) => {
  const t = await findApplication(req.params.id);
  if (!t) return res.status(404).json({ status: false, message: "Therapist not found" });
  t.profile_recheck = false;
  await t.save();
  res.json({ status: true });
});

async function findByCompletionToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  const t = await Therapists.findOne({ completion_token_hash: sha256(token) }).populate("user", "name email profile bio state");
  if (!t || !t.completion_expires || t.completion_expires < new Date()) return null;
  return t;
}

/* GET /therapist-complete/:token — public: what to fill, with current values */
export const getCompletionRequest = expressAsyncHandler(async (req, res) => {
  const t = await findByCompletionToken(req.params.token);
  if (!t) return res.status(404).json({ status: false, message: "This link has expired or was already used." });
  res.json({
    status: true,
    data: {
      name: t.user?.name || "", email: t.user?.email || "", note: t.completion_note || "", expires: t.completion_expires,
      live: t.show_to_page === 1,
      items: t.completion_items.map((k) => ({ key: k, ...COMPLETE_ITEMS[k] })),
      current: {
        bio: t.user?.bio || "", qualification: t.qualification || "", experience: t.year_of_exp || "",
        languages: t.language_spoken || "", location: t.state || t.user?.state || "", specialisation: t.experties || t.services || "",
      },
    },
  });
});

/* POST /therapist-complete/:token — public multipart: photo / resume / qualification_certificate / id_card + text fields */
export const submitCompletion = expressAsyncHandler(async (req, res) => {
  const t = await findByCompletionToken(req.params.token);
  if (!t) return res.status(404).json({ status: false, message: "This link has expired or was already used." });
  const b = req.body || {};
  const clean = (v, n = 300) => String(v || "").replace(/<[^>]*>/g, "").trim().slice(0, n);
  const userUpdate = {};
  for (const k of t.completion_items) {
    const kind = COMPLETE_ITEMS[k]?.kind;
    if (kind === "dashboard") continue; // fees / availability are set after login
    if (kind === "file") {
      const f = req.files?.[k]?.[0];
      if (!f) return res.status(400).json({ status: false, message: `Please upload your ${COMPLETE_ITEMS[k].label.toLowerCase()}.` });
      if (k === "photo") userUpdate.profile = f.filename;
      else t[k] = f.filename;
      continue;
    }
    const v = clean(b[k], k === "bio" ? 3000 : 300);
    if (!v) return res.status(400).json({ status: false, message: `Please fill in: ${COMPLETE_ITEMS[k].label}.` });
    if (k === "bio") {
      const n = words(v);
      if (n < 50 || n > 250) return res.status(400).json({ status: false, message: "Please write between 50 and 250 words about yourself." });
      userUpdate.bio = v;
    }
    if (k === "qualification") t.qualification = v;
    if (k === "experience") t.year_of_exp = v.replace(/[^\d.]/g, "").slice(0, 4) || v.slice(0, 20);
    if (k === "languages") t.language_spoken = v;
    if (k === "location") t.state = v;
    if (k === "specialisation") t.experties = v;
  }
  if (Object.keys(userUpdate).length) await Users.updateOne({ _id: t.user._id }, { $set: userUpdate });
  const filled = t.completion_items.filter((k) => COMPLETE_ITEMS[k]?.kind !== "dashboard");
  t.completion_token_hash = null;
  t.completion_expires = null;
  t.completion_submitted_at = new Date();
  t.profile_recheck = true;
  await t.save();

  emitStaff("therapist-resubmitted", null, { id: t._id, name: t.user?.name, items: filled.map((k) => COMPLETE_ITEMS[k].label), at: Date.now() });
  sendMail(
    "chooseyourtherapist@gmail.com",
    `Profile completed: ${t.user?.name || "therapist"}`,
    `${t.user?.name || "A therapist"} (${t.user?.email || ""}) completed: ${filled.map((k) => COMPLETE_ITEMS[k].label).join(", ")}. Check it again in admin → Therapists.`,
    `<p>${String(t.user?.name || "A therapist").replace(/[<>&]/g, "")} completed: ${filled.map((k) => COMPLETE_ITEMS[k].label).join(", ")}.</p><p>Check the profile again in admin → Therapists.</p>`
  ).catch(() => {});
  res.json({ status: true, message: "Thank you — your profile was updated. Our team will check it shortly." });
});
