import expressAsyncHandler from "express-async-handler";
import MoodEntry from "../models/MoodEntry.js";

/* The client's daily mood on My Space, kept with the account (it used to live in one browser only). */
const istDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /my-moods?days=60 → { "YYYY-MM-DD": 1..5 }
export const myMoods = expressAsyncHandler(async (req, res) => {
  const days = Math.min(400, Math.max(7, Number(req.query.days) || 60));
  const from = istDay(new Date(Date.now() - (days - 1) * 86400000));
  const rows = await MoodEntry.find({ user: req.user._id, day: { $gte: from } }).select("day v").lean();
  res.json({ status: true, data: Object.fromEntries(rows.map((r) => [r.day, r.v])) });
});

// POST /my-moods { day, v } — today's mood (or { entries: { day: v } } to bring over what this browser kept)
export const saveMood = expressAsyncHandler(async (req, res) => {
  const today = istDay();
  const input = req.body?.entries && typeof req.body.entries === "object" ? req.body.entries : { [req.body?.day || today]: req.body?.v };
  const ops = Object.entries(input)
    .filter(([day, v]) => DAY_RE.test(day) && day <= today && [1, 2, 3, 4, 5].includes(Number(v)))
    .slice(0, 120)
    .map(([day, v]) => ({
      // importing never overwrites a day already saved; today's pick does
      updateOne: req.body?.entries
        ? { filter: { user: req.user._id, day }, update: { $setOnInsert: { v: Number(v) } }, upsert: true }
        : { filter: { user: req.user._id, day }, update: { $set: { v: Number(v) } }, upsert: true },
    }));
  if (!ops.length) return res.status(400).json({ status: false, message: "Nothing to save." });
  await MoodEntry.bulkWrite(ops, { ordered: false });
  res.json({ status: true, saved: ops.length });
});
