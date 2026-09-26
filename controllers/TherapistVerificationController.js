// Admin review of therapist applications: checklist, reject (with an emailed reason) and
// "please re-upload" requests. A re-upload request emails the therapist a one-time link
// (valid 7 days); only a hash of its token is stored.

import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import crypto from "crypto";
import Therapists from "../models/Therapists.js";
import Users from "../models/Users.js";
import { sendMail } from "../helper/mailer.js";
import { therapistApplicationRejectedMail, therapistReuploadMail } from "../services/mailTemplates.js";

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
