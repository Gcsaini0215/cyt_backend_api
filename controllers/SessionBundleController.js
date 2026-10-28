import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import SessionBundle from "../models/SessionBundle.js";
import "../models/Therapists.js";
import "../models/Users.js";
import PackPricing from "../models/PackPricing.js";
import { bundleRow, remainingOf, getPackConfig, clearPackCache } from "../helper/sessionBundle.js";

const DAY = 86400000;
const therapistPop = { path: "therapist", select: "_id user profile_type state", populate: { path: "user", select: "name profile" } };

// GET /my-bundles — the client's packs that still have sessions to book (and haven't expired)
export const myBundles = expressAsyncHandler(async (req, res) => {
  const rows = await SessionBundle.find({ client: req.user._id, status: "active", expires_at: { $gt: new Date() } })
    .populate(therapistPop).sort({ expires_at: 1 }).lean();
  res.json({
    status: true,
    data: rows.filter((b) => remainingOf(b) > 0).map((b) => ({ ...bundleRow(b), therapist: b.therapist })),
  });
});

// GET /session-packs — the packs on sale and their discounts (the booking page shows them)
export const packOptions = expressAsyncHandler(async (req, res) => {
  const cfg = await getPackConfig();
  res.json({ status: true, data: { packs: cfg.packs.filter((p) => p.active).map(({ size, pct }) => ({ size, pct })), days: cfg.days } });
});

// GET /admin/pack-pricing — all packs (on and off) + validity
export const adminPackPricing = expressAsyncHandler(async (req, res) => {
  res.json({ status: true, data: await getPackConfig() });
});

// PUT /admin/pack-pricing { packs: [{ size, pct, active }], days } — super admin. Packs already bought keep
// the price and validity they were bought with.
export const savePackPricing = expressAsyncHandler(async (req, res) => {
  const list = Array.isArray(req.body?.packs) ? req.body.packs : [];
  const packs = [];
  for (const p of list) {
    const size = Math.round(Number(p.size)), pct = Math.round(Number(p.pct) * 10) / 10;
    if (!(size >= 2 && size <= 24)) return res.status(400).json({ status: false, message: "A pack must have 2–24 sessions." });
    if (!(pct >= 0 && pct <= 50)) return res.status(400).json({ status: false, message: "Discount must be between 0% and 50%." });
    if (packs.some((x) => x.size === size)) return res.status(400).json({ status: false, message: `There are two packs of ${size} sessions.` });
    packs.push({ size, pct, active: p.active !== false });
  }
  if (!packs.length || packs.length > 6) return res.status(400).json({ status: false, message: "Add 1–6 packs." });
  const days = Math.round(Number(req.body?.days));
  if (!(days >= 7 && days <= 730)) return res.status(400).json({ status: false, message: "Validity must be 7–730 days." });
  await PackPricing.findOneAndUpdate({ key: "default" }, { $set: { packs, days, updatedBy: req.user?.name || req.user?.email || "admin" } }, { upsert: true });
  clearPackCache();
  res.json({ status: true, message: "Pack pricing saved.", data: await getPackConfig() });
});

// GET /admin/session-packs?status=active|expired|used|all
export const adminBundles = expressAsyncHandler(async (req, res) => {
  const rows = await SessionBundle.find({}).populate(therapistPop).populate("client", "name email phone").sort({ _id: -1 }).limit(500).lean();
  const now = Date.now();
  const data = rows.map((b) => {
    const r = bundleRow(b);
    const state = b.status === "cancelled" ? "cancelled" : r.remaining === 0 ? "used" : new Date(b.expires_at).getTime() <= now ? "expired" : "active";
    return { ...r, state, client: b.client, therapist: b.therapist, extensions: b.extensions || [] };
  });
  const want = String(req.query.status || "all");
  const sold = data.filter((d) => d.state !== "cancelled");
  res.json({
    status: true,
    data: want === "all" ? data : data.filter((d) => d.state === want),
    summary: {
      sold: sold.length,
      revenue: sold.reduce((n, d) => n + (d.total || 0), 0),
      active: data.filter((d) => d.state === "active").length,
      sessionsLeft: data.filter((d) => d.state === "active").reduce((n, d) => n + d.remaining, 0),
      expiredUnused: data.filter((d) => d.state === "expired").reduce((n, d) => n + d.remaining, 0),
    },
  });
});

// POST /admin/session-packs/:id/extend { days } — give the client more time (also revives an expired pack)
export const extendBundle = expressAsyncHandler(async (req, res) => {
  const days = Math.round(Number(req.body?.days) || 0);
  if (!mongoose.Types.ObjectId.isValid(req.params.id) || days < 1 || days > 365) return res.status(400).json({ status: false, message: "Choose 1–365 days." });
  const b = await SessionBundle.findById(req.params.id);
  if (!b || b.status !== "active") return res.status(404).json({ status: false, message: "Pack not found." });
  const from = Math.max(Date.now(), new Date(b.expires_at).getTime());
  b.expires_at = new Date(from + days * DAY);
  b.extensions.push({ days, by: req.user?.name || req.user?.email || "admin", at: new Date() });
  await b.save();
  res.json({ status: true, message: `Valid till ${b.expires_at.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}.`, data: bundleRow(b) });
});
