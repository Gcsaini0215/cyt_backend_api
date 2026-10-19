import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import OutreachEmail from "../models/OutreachEmail.js";
import { sendMailAdvanced } from "../helper/mailer.js";
import { isValidEmail } from "../helper/isValidMail.js";
import { PRESETS, BANNERS, COMPANY, buildOutreachHtml, buildOutreachText, resolveOutreach } from "../helper/outreachEmail.js";

/* Admin → Outreach Email: write a designed collaboration email (college, corporate, NGO, clinic…), preview it
   live and send it — or send a test copy to yourself first. Everything sent is kept in the history. */

const MAX_TO = 10, MAX_CC = 10;
const fail = (res, code, message) => res.status(code).json({ status: false, message });
const emails = (v) => [...new Set((Array.isArray(v) ? v : String(v || "").split(/[,;\s]+/)).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
const cleanData = (d = {}) => {
  const s = (v, n) => String(v ?? "").slice(0, n);
  return {
    preset: PRESETS[d.preset] ? d.preset : "general",
    banner: BANNERS[d.banner] ? d.banner : "",
    organisation: s(d.organisation, 120), recipientName: s(d.recipientName, 120),
    subject: s(d.subject, 200), headline: s(d.headline, 160), intro: s(d.intro, 1500), body: s(d.body, 6000),
    offerTitle: s(d.offerTitle, 80), offers: (Array.isArray(d.offers) ? d.offers : []).slice(0, 8).map((o) => s(o, 200)),
    ctaText: s(d.ctaText, 60), ctaUrl: s(d.ctaUrl, 500), closing: s(d.closing, 60),
    senderName: s(d.senderName, 80), senderTitle: s(d.senderTitle, 80), senderPhone: s(d.senderPhone, 40),
  };
};

// GET /outreach/presets — the ready-made emails + banner choices for the form
export const outreachPresets = expressAsyncHandler(async (req, res) => {
  res.json({
    status: true,
    data: {
      presets: Object.entries(PRESETS).map(([key, p]) => ({ key, ...p })),
      banners: Object.entries(BANNERS).map(([key, b]) => ({ key, ...b })),
      company: COMPANY,
      me: { name: req.user?.name || "", email: req.user?.email || "" },
    },
  });
});

// POST /outreach/preview { data } → { subject, html }
export const outreachPreview = expressAsyncHandler(async (req, res) => {
  const data = cleanData(req.body?.data);
  res.json({ status: true, data: { subject: resolveOutreach(data).subject, html: buildOutreachHtml(data) } });
});

// POST /outreach/send { data, to, cc, test } — test = only to the signed-in admin's email
export const outreachSend = expressAsyncHandler(async (req, res) => {
  const data = cleanData(req.body?.data);
  const test = !!req.body?.test;
  const me = String(req.user?.email || "").toLowerCase();
  const to = test ? [me] : emails(req.body?.to);
  const cc = test ? [] : emails(req.body?.cc);
  if (!to.length || !to[0]) return fail(res, 400, test ? "Your admin account has no email to send the test to." : "Add at least one recipient email.");
  if (to.length > MAX_TO || cc.length > MAX_CC) return fail(res, 400, `Up to ${MAX_TO} recipients and ${MAX_CC} in CC at a time.`);
  const bad = [...to, ...cc].filter((e) => !isValidEmail(e));
  if (bad.length) return fail(res, 400, `Check these emails: ${bad.join(", ")}`);

  const r = resolveOutreach(data);
  const subject = test ? `[TEST] ${r.subject}` : r.subject;
  const result = await sendMailAdvanced({
    to, cc, replyTo: COMPANY.email, subject,
    text: buildOutreachText(data), html: buildOutreachHtml(data), fromName: "Choose Your Therapist",
  });
  const log = await OutreachEmail.create({
    to, cc, subject, preset: data.preset, organisation: data.organisation, data, test,
    status: result.success ? "sent" : "failed", error: result.success ? "" : String(result.error || "").slice(0, 300),
    messageId: result.messageId || "", sentBy: req.user?.email || req.user?.name || "admin",
  });
  if (!result.success) return fail(res, 502, `Couldn't send: ${result.error || "mail server error"}`);
  res.json({ status: true, message: test ? `Test sent to ${me}.` : `Sent to ${to.join(", ")}.`, data: { id: log._id } });
});

// GET /outreach/history?page= — newest first (form data included so it can be used again)
export const outreachHistory = expressAsyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1), limit = 15;
  const filter = req.query.tests === "1" ? {} : { test: false };
  const [rows, total] = await Promise.all([
    OutreachEmail.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    OutreachEmail.countDocuments(filter),
  ]);
  res.json({ status: true, data: { rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) } });
});

// DELETE /outreach/:id — remove a history entry
export const outreachDelete = expressAsyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return fail(res, 400, "Invalid id.");
  await OutreachEmail.deleteOne({ _id: req.params.id });
  res.json({ status: true, message: "Removed from history." });
});
