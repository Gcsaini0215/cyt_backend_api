import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import SessionBundle from "../models/SessionBundle.js";
import "../models/Therapists.js";
import "../models/Users.js";
import { bundleRow, remainingOf, PACKS, PACK_DAYS } from "../helper/sessionBundle.js";

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

// GET /session-packs — the pack sizes and discounts (the booking page shows them)
export const packOptions = (req, res) => res.json({ status: true, data: { packs: Object.entries(PACKS).map(([size, pct]) => ({ size: Number(size), pct })), days: PACK_DAYS } });

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
