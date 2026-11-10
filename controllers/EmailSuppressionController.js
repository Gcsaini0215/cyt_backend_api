// Admin → Content → Blocked emails: addresses that bounced (or are wrong / asked to stop).
// helper/mailer.js skips them in every outgoing mail.
import expressAsyncHandler from "express-async-handler";
import EmailSuppression from "../models/EmailSuppression.js";
import Users from "../models/Users.js";
import { clearBlockedCache } from "../helper/mailer.js";

const REASONS = ["bounced", "wrong-address", "unsubscribed", "other"];
const ROLE = { 0: "Client", 1: "Therapist", 2: "Admin", 3: "Trainee" };
const isEmail = (e) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e);

// who on CYT uses this address (so the team knows whose account to fix)
async function owners(emails) {
  if (!emails.length) return {};
  const us = await Users.find({ email: { $in: emails } }).select("name email role").lean();
  const map = {};
  for (const u of us) (map[String(u.email).toLowerCase()] = map[String(u.email).toLowerCase()] || []).push({ name: u.name || "", role: ROLE[u.role] || "User" });
  return map;
}

// GET /email-suppressions
export const listSuppressions = expressAsyncHandler(async (req, res) => {
  const rows = await EmailSuppression.find({}).sort({ createdAt: -1 }).lean();
  const who = await owners(rows.map((r) => r.email));
  res.json({ status: true, data: rows.map((r) => ({ _id: String(r._id), email: r.email, reason: r.reason, note: r.note, addedBy: r.addedBy, createdAt: r.createdAt, accounts: who[r.email] || [] })) });
});

// POST /email-suppressions { email | emails (comma / new-line list), reason, note }
export const addSuppression = expressAsyncHandler(async (req, res) => {
  const raw = String(req.body?.emails || req.body?.email || "");
  const list = [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const bad = list.filter((e) => !isEmail(e));
  if (!list.length || bad.length) return res.status(400).json({ status: false, message: bad.length ? `Not a valid email: ${bad.slice(0, 3).join(", ")}` : "Enter an email address." });
  if (list.length > 200) return res.status(400).json({ status: false, message: "Add up to 200 at a time." });
  const reason = REASONS.includes(req.body?.reason) ? req.body.reason : "bounced";
  const note = String(req.body?.note || "").slice(0, 300);
  const by = req.user?.name || "";
  await EmailSuppression.bulkWrite(list.map((email) => ({
    updateOne: { filter: { email }, update: { $setOnInsert: { email, addedBy: by }, $set: { reason, note } }, upsert: true },
  })));
  clearBlockedCache();
  const who = await owners(list);
  res.status(201).json({ status: true, data: { added: list.length, accounts: list.map((e) => ({ email: e, accounts: who[e] || [] })) } });
});

// DELETE /email-suppressions/:id
export const removeSuppression = expressAsyncHandler(async (req, res) => {
  await EmailSuppression.deleteOne({ _id: req.params.id }).catch(() => null);
  clearBlockedCache();
  res.json({ status: true });
});
