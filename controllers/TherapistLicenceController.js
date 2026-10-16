import expressAsyncHandler from "express-async-handler";
import TherapistLicence, { LICENSED_TOOLS } from "../models/TherapistLicence.js";

const current = () => ({ $or: [{ validTill: null }, { validTill: { $gte: new Date() } }] });

// GET /assessment-licences/mine — the therapist's own licences
export const myLicences = expressAsyncHandler(async (req, res) => {
  const rows = await TherapistLicence.find({ user: req.user._id }).sort({ tool: 1 }).lean();
  res.json({ status: true, data: rows.map((r) => ({ tool: r.tool, details: r.details, validTill: r.validTill, updatedAt: r.updatedAt })) });
});

// POST /assessment-licences { tool, details, validTill? } — add or update one licence
export const saveLicence = expressAsyncHandler(async (req, res) => {
  const { tool } = req.body || {};
  const details = String(req.body?.details || "").trim();
  if (!LICENSED_TOOLS.includes(tool)) return res.status(400).json({ status: false, message: "Unknown questionnaire." });
  if (details.length < 4) return res.status(400).json({ status: false, message: "Please add your licence or permission details." });
  if (details.length > 400) return res.status(400).json({ status: false, message: "Licence details are too long (400 characters max)." });
  let validTill = null;
  if (req.body?.validTill) {
    validTill = new Date(req.body.validTill);
    if (Number.isNaN(validTill.getTime())) return res.status(400).json({ status: false, message: "Invalid date." });
  }
  await TherapistLicence.updateOne({ user: req.user._id, tool }, { $set: { details, validTill } }, { upsert: true });
  res.json({ status: true, message: "Licence saved." });
});

// DELETE /assessment-licences/:tool
export const removeLicence = expressAsyncHandler(async (req, res) => {
  await TherapistLicence.deleteOne({ user: req.user._id, tool: req.params.tool });
  res.json({ status: true, message: "Licence removed." });
});

// GET /assessment-licences/public?tool=isi — user ids of therapists with a current licence (no details)
export const licensedTherapists = expressAsyncHandler(async (req, res) => {
  const tool = String(req.query.tool || "");
  if (!LICENSED_TOOLS.includes(tool)) return res.json({ status: true, data: [] });
  const rows = await TherapistLicence.find({ tool, ...current() }).select("user").lean();
  res.json({ status: true, data: rows.map((r) => String(r.user)) });
});
