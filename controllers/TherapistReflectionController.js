import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import TherapistReflection from "../models/TherapistReflection.js";
import { encrypt, decrypt } from "../helper/googleMeet.js";

/* Private reflection journal for therapists (countertransference self-help). Every query is scoped to
   req.user._id — there is deliberately no admin / other-user access. */
export const R_FEELINGS = ["Anxious", "Protective", "Irritated", "Bored", "Sad", "Helpless", "Angry", "Drained", "Overwhelmed", "Warm / caring", "Judged", "Not good enough", "Disconnected", "Guilty", "Hopeful", "Confused"];
export const R_BODY = ["Tight chest", "Heavy", "Tense shoulders", "Sleepy", "Restless", "Headache", "Knot in stomach", "Numb", "Teary", "Calm"];
export const R_PULLS = ["Rescue / fix it", "Give advice", "Run over time", "Avoid a topic", "Agree too quickly", "Be stricter", "Share about myself", "Pull back", "Reassure too much", "Push for change"];
export const R_WHOSE = ["mine", "client", "both", "unsure"];
export const R_CARE = ["Breathe", "Short walk", "Water / snack", "Talk to a colleague", "Supervision", "Rest", "Write it out", "Movement"];
const TEXTS = ["label", "moment", "story", "meaning", "plan"];

const pick = (v, list, max = 10) => [...new Set((Array.isArray(v) ? v : []).filter((x) => list.includes(x)))].slice(0, max);
const txt = (v, n = 2000) => String(v ?? "").slice(0, n).trim();
const open = (d) => {
  let t = {};
  try { t = d.secret ? JSON.parse(decrypt(d.secret)) : {}; } catch { t = {}; }
  return { _id: d._id, at: d.createdAt, feelings: d.feelings, intensity: d.intensity, body: d.body, pulls: d.pulls, whose: d.whose, care: d.care, supervision: d.supervision, ...Object.fromEntries(TEXTS.map((k) => [k, t[k] || ""])) };
};

// GET /therapist-reflections → options, entries (newest first, up to 100), 30-day patterns
export const listReflections = expressAsyncHandler(async (req, res) => {
  const docs = await TherapistReflection.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
  const since = Date.now() - 30 * 864e5;
  const recent = docs.filter((d) => new Date(d.createdAt).getTime() >= since);
  const count = (key) => {
    const m = {};
    recent.forEach((d) => (d[key] || []).forEach((x) => { m[x] = (m[x] || 0) + 1; }));
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name, n }));
  };
  const whose = {}; recent.forEach((d) => { if (d.whose) whose[d.whose] = (whose[d.whose] || 0) + 1; });
  const patterns = {
    entries: recent.length,
    avgIntensity: recent.length ? Math.round((recent.reduce((s, d) => s + (d.intensity || 0), 0) / recent.length) * 10) / 10 : 0,
    feelings: count("feelings"), pulls: count("pulls"), body: count("body"), whose,
    toSupervision: recent.filter((d) => d.supervision).length,
  };
  res.json({ status: true, data: { options: { feelings: R_FEELINGS, body: R_BODY, pulls: R_PULLS, whose: R_WHOSE, care: R_CARE }, entries: docs.map(open), patterns } });
});

// POST /therapist-reflections
export const addReflection = expressAsyncHandler(async (req, res) => {
  const b = req.body || {};
  const feelings = pick(b.feelings, R_FEELINGS);
  const texts = Object.fromEntries(TEXTS.map((k) => [k, txt(b[k], k === "label" ? 60 : 2000)]));
  if (!feelings.length && !texts.moment && !texts.story) return res.status(400).json({ status: false, message: "Pick a feeling or write a line about the moment" });
  const n = Math.round(Number(b.intensity));
  const doc = await TherapistReflection.create({
    user: req.user._id, feelings, intensity: Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : 5,
    body: pick(b.body, R_BODY), pulls: pick(b.pulls, R_PULLS), whose: R_WHOSE.includes(b.whose) ? b.whose : "",
    care: pick(b.care, R_CARE), supervision: !!b.supervision, secret: encrypt(JSON.stringify(texts)),
  });
  res.json({ status: true, message: "Saved privately", data: open(doc.toObject()) });
});

// DELETE /therapist-reflections/:id
export const deleteReflection = expressAsyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ status: false, message: "Bad id" });
  const r = await TherapistReflection.deleteOne({ _id: req.params.id, user: req.user._id });
  res.json({ status: !!r.deletedCount, message: r.deletedCount ? "Deleted" : "Not found" });
});
