import expressAsyncHandler from "express-async-handler";
import AssessmentResult from "../models/AssessmentResult.js";

// max score per check; null = several scores sent as `dims` ("sleep" was retired — old results only)
const TESTS = { phq9: 27, gad7: 21, pcl5: 80, k10: 50, phq15: 30, audit: 40, asrs: 6, epds: 30, rses: 30, bigfive: null, dass21: null, cbi: null };
const DIM_MAX = { bigfive: 100, dass21: 42, cbi: 100 };

// POST /assessments { test, title, score, level, dims?, flag? } — save a finished self-check
export const saveAssessment = expressAsyncHandler(async (req, res) => {
  const { test, title, level, dims, flag } = req.body || {};
  if (!Object.prototype.hasOwnProperty.call(TESTS, test)) return res.status(400).json({ status: false, message: "Unknown assessment." });
  const max = TESTS[test];
  const score = max === null ? null : Number(req.body.score);
  if (max !== null && (!Number.isFinite(score) || score < 0 || score > max)) return res.status(400).json({ status: false, message: "Invalid score." });
  let cleanDims;
  if (max === null) {
    if (!dims || typeof dims !== "object") return res.status(400).json({ status: false, message: "Missing scores." });
    cleanDims = {};
    for (const [k, v] of Object.entries(dims).slice(0, 8)) {
      if (/^[a-z_]{1,24}$/i.test(k) && Number.isFinite(Number(v))) cleanDims[k] = Math.max(0, Math.min(DIM_MAX[test], Math.round(Number(v))));
    }
  }
  // the same result submitted twice within a minute (double tap) is stored once
  const recent = await AssessmentResult.findOne({ user: req.user._id, test, createdAt: { $gt: new Date(Date.now() - 60000) } }).lean();
  if (recent) return res.json({ status: true, data: { _id: recent._id } });
  const doc = await AssessmentResult.create({
    user: req.user._id, test, title: String(title || "").slice(0, 80), score, max,
    level: String(level || "").slice(0, 40), dims: cleanDims, flag: !!flag,
  });
  res.status(201).json({ status: true, data: { _id: doc._id } });
});

// GET /assessments — this client's history, newest first
export const listAssessments = expressAsyncHandler(async (req, res) => {
  const rows = await AssessmentResult.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ status: true, data: rows.map((r) => ({ _id: r._id, test: r.test, title: r.title, score: r.score, max: r.max, level: r.level, dims: r.dims || null, flag: !!r.flag, createdAt: r.createdAt })) });
});
