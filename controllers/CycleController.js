import expressAsyncHandler from "express-async-handler";
import CycleProfile from "../models/CycleProfile.js";
import CycleLog from "../models/CycleLog.js";
import MoodEntry from "../models/MoodEntry.js";
import User from "../models/Users.js";

/* "Cycle & Mood Care" (site: /client/cycle) — a private period + mood tracker with therapy support.
   Only the signed-in client reads or writes their own rows. */
const istDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const GENDERS = ["Female", "Male", "Non-binary", "Other"];
export const CYCLE_GOALS = ["pms", "pmdd", "pain", "pcos", "body", "fertility", "meno", "track"];
export const CYCLE_SYMPTOMS = ["cramps", "headache", "bloating", "tired", "irritable", "anxious", "low", "cravings", "sleep", "breasts", "acne", "backpain"];

const publicProfile = (p) => (p ? {
  menstruates: p.menstruates, dismissed: !!p.dismissed, enabled: !!p.enabled, consentAt: p.consentAt,
  lastStart: p.lastStart || "", cycleLen: p.cycleLen, periodLen: p.periodLen, goals: p.goals || [],
} : null);

// GET /my-cycle → { gender, profile, logs: { day: { flow, symptoms, note } }, moods: { day: 1..5 } }
export const myCycle = expressAsyncHandler(async (req, res) => {
  const lite = req.query.lite === "1"; // My Space card: profile + recent flow only
  const days = lite ? 120 : 400;
  const from = istDay(new Date(Date.now() - (days - 1) * 86400000));
  const [user, profile] = await Promise.all([
    User.findById(req.user._id).select("gender").lean(),
    CycleProfile.findOne({ user: req.user._id }).lean(),
  ]);
  let logs = {}; let moods = {};
  if (profile?.enabled) {
    const [l, m] = await Promise.all([
      CycleLog.find({ user: req.user._id, day: { $gte: from } }).select(lite ? "day flow" : "day flow symptoms note").lean(),
      lite ? [] : MoodEntry.find({ user: req.user._id, day: { $gte: from } }).select("day v").lean(),
    ]);
    logs = Object.fromEntries(l.map((r) => [r.day, lite ? { flow: r.flow } : { flow: r.flow, symptoms: r.symptoms || [], note: r.note || "" }]));
    moods = Object.fromEntries(m.map((r) => [r.day, r.v]));
  }
  res.json({ status: true, data: { gender: user?.gender || "", profile: publicProfile(profile), logs, moods } });
});

// PUT /my-cycle/profile { gender?, menstruates?, dismissed?, enabled?, consent?, lastStart?, cycleLen?, periodLen?, goals? }
export const saveCycleProfile = expressAsyncHandler(async (req, res) => {
  const b = req.body || {};
  if (b.gender !== undefined) {
    if (!GENDERS.includes(b.gender)) return res.status(400).json({ status: false, message: "Please pick an option." });
    await User.updateOne({ _id: req.user._id }, { $set: { gender: b.gender } });
  }
  const set = {};
  if (typeof b.menstruates === "boolean") set.menstruates = b.menstruates;
  if (typeof b.dismissed === "boolean") set.dismissed = b.dismissed;
  if (b.lastStart !== undefined) {
    const d = String(b.lastStart || "");
    if (d && (!DAY_RE.test(d) || d > istDay() || d < istDay(new Date(Date.now() - 400 * 86400000)))) return res.status(400).json({ status: false, message: "Please pick a date in the past year." });
    set.lastStart = d;
  }
  if (b.cycleLen !== undefined) set.cycleLen = Math.min(60, Math.max(15, Math.round(Number(b.cycleLen) || 28)));
  if (b.periodLen !== undefined) set.periodLen = Math.min(12, Math.max(1, Math.round(Number(b.periodLen) || 5)));
  if (Array.isArray(b.goals)) set.goals = [...new Set(b.goals.filter((g) => CYCLE_GOALS.includes(g)))];
  if (typeof b.enabled === "boolean") {
    if (b.enabled) {
      const cur = await CycleProfile.findOne({ user: req.user._id }).select("consentAt").lean();
      if (!cur?.consentAt && b.consent !== true) return res.status(400).json({ status: false, message: "Please agree to how your data is kept." });
      if (b.consent === true) set.consentAt = new Date();
      set.dismissed = false;
    }
    set.enabled = b.enabled;
  }
  const p = await CycleProfile.findOneAndUpdate({ user: req.user._id }, { $set: set, $setOnInsert: { user: req.user._id } }, { new: true, upsert: true }).lean();
  res.json({ status: true, data: publicProfile(p) });
});

// PUT /my-cycle/log { day, flow, symptoms, note } — an empty day is removed
export const saveCycleLog = expressAsyncHandler(async (req, res) => {
  const b = req.body || {};
  const day = String(b.day || istDay());
  if (!DAY_RE.test(day) || day > istDay()) return res.status(400).json({ status: false, message: "Please pick today or an earlier day." });
  const p = await CycleProfile.findOne({ user: req.user._id }).select("enabled").lean();
  if (!p?.enabled) return res.status(400).json({ status: false, message: "Please set up your tracker first." });
  const flow = Math.min(4, Math.max(0, Math.round(Number(b.flow) || 0)));
  const symptoms = Array.isArray(b.symptoms) ? [...new Set(b.symptoms.filter((s) => CYCLE_SYMPTOMS.includes(s)))] : [];
  const note = String(b.note || "").replace(/\s+$/, "").slice(0, 280);
  if (!flow && !symptoms.length && !note) {
    await CycleLog.deleteOne({ user: req.user._id, day });
    return res.json({ status: true, data: null });
  }
  await CycleLog.updateOne({ user: req.user._id, day }, { $set: { flow, symptoms, note } }, { upsert: true });
  res.json({ status: true, data: { day, flow, symptoms, note } });
});

// DELETE /my-cycle — switch off and delete every cycle row (moods stay: My Space uses them)
export const deleteMyCycle = expressAsyncHandler(async (req, res) => {
  await Promise.all([
    CycleLog.deleteMany({ user: req.user._id }),
    CycleProfile.updateOne({ user: req.user._id }, { $set: { enabled: false, dismissed: true, consentAt: null, lastStart: "", goals: [], cycleLen: 28, periodLen: 5 } }),
  ]);
  res.json({ status: true });
});
