import expressAsyncHandler from "express-async-handler";
import AiVisit from "../models/AiVisit.js";

const SOURCES = ["chatgpt", "perplexity", "gemini", "copilot", "claude", "other"];
const istDay = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const cleanVid = (v) => String(v || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
const cleanPath = (p) => {
  const s = String(p || "/").split("?")[0].split("#")[0].slice(0, 200);
  return s.startsWith("/") ? s : "/";
};

// public: the site reports an arrival from an AI assistant
export const postAiVisit = expressAsyncHandler(async (req, res) => {
  const source = SOURCES.includes(req.body?.source) ? req.body.source : null;
  if (!source) return res.status(400).json({ status: false });
  const vid = cleanVid(req.body?.vid);
  // one row per browser per day per source is enough (reloads and page-to-page moves don't count again)
  const day = istDay();
  if (vid && (await AiVisit.exists({ vid, day, source }))) return res.json({ status: true });
  await AiVisit.create({ source, landing: cleanPath(req.body?.landing), vid, day });
  res.json({ status: true });
});

// public: that browser later sent an enquiry (lead) or booked a session
export const postAiConversion = expressAsyncHandler(async (req, res) => {
  const vid = cleanVid(req.body?.vid);
  const kind = req.body?.kind === "booked" ? "booked" : req.body?.kind === "lead" ? "lead" : null;
  if (!vid || !kind) return res.status(400).json({ status: false });
  const since = new Date(Date.now() - 30 * 86400 * 1000);
  const last = await AiVisit.findOne({ vid, createdAt: { $gte: since } }).sort({ createdAt: -1 });
  if (last && !last[kind]) { last[kind] = true; await last.save(); }
  res.json({ status: true });
});

// admin Overview: AI-assistant traffic for the last `days` days
export const adminAiVisits = expressAsyncHandler(async (req, res) => {
  const days = Math.min(180, Math.max(7, Number(req.query.days) || 30));
  const from = istDay(new Date(Date.now() - (days - 1) * 86400 * 1000));
  const rows = await AiVisit.find({ day: { $gte: from } }).select("source landing day lead booked").lean();
  const bySource = {};
  const byDay = {};
  const byPage = {};
  rows.forEach((r) => {
    const s = (bySource[r.source] = bySource[r.source] || { visits: 0, leads: 0, bookings: 0 });
    s.visits++; if (r.lead) s.leads++; if (r.booked) s.bookings++;
    byDay[r.day] = (byDay[r.day] || 0) + 1;
    byPage[r.landing] = (byPage[r.landing] || 0) + 1;
  });
  const series = [];
  for (let i = days - 1; i >= 0; i--) { const d = istDay(new Date(Date.now() - i * 86400 * 1000)); series.push({ day: d, visits: byDay[d] || 0 }); }
  res.json({
    status: true,
    data: {
      days,
      total: rows.length,
      leads: rows.filter((r) => r.lead).length,
      bookings: rows.filter((r) => r.booked).length,
      sources: Object.entries(bySource).map(([source, v]) => ({ source, ...v })).sort((a, b) => b.visits - a.visits),
      topPages: Object.entries(byPage).map(([page, visits]) => ({ page, visits })).sort((a, b) => b.visits - a.visits).slice(0, 6),
      series,
    },
  });
});
