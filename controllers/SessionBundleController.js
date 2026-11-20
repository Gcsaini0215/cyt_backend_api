import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import SessionBundle from "../models/SessionBundle.js";
import "../models/Therapists.js";
import "../models/Users.js";
import PackPricing from "../models/PackPricing.js";
import Booking from "../models/Booking.js";
import User from "../models/Users.js";
import NoidaClientCredit from "../models/NoidaClientCredit.js";
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

/* GET /my-wallet — the client's prepaid money (2026-11-20). Nothing new is stored: a pack's balance is what was paid
   minus one session's share for every pack session that has been completed. Booked-but-not-done sessions are
   shown as "reserved" (still in the balance). Expired packs: the unused part isn't counted (packs aren't refunded).
   CYT Noida clinic packages are counted in sessions (they have no rupee value per session on record). */
export const myWallet = expressAsyncHandler(async (req, res) => {
  const now = Date.now();
  const bundles = await SessionBundle.find({ client: req.user._id, status: "active", paid_at: { $ne: null } }).populate(therapistPop).sort({ paid_at: -1 }).lean();
  const ids = bundles.map((b) => b._id);
  const pb = ids.length ? await Booking.find({ bundle: { $in: ids } }).select("bundle status booking_date session_completed_at").lean() : [];
  const r2 = (x) => Math.round(x);
  let balance = 0, reserved = 0;
  const history = [];
  const packs = bundles.map((b) => {
    const mine = pb.filter((x) => String(x.bundle) === String(b._id));
    const done = mine.filter((x) => x.status === "Completed");
    const booked = mine.filter((x) => x.status === "New" || x.status === "Started").length;
    const per = Number(b.per_session) || 0, total = Number(b.total) || 0;
    const left = done.length >= b.size ? 0 : Math.max(0, total - per * done.length);
    const expired = new Date(b.expires_at).getTime() <= now;
    if (!expired) { balance += left; reserved += Math.min(left, per * booked); }
    const tName = b.therapist?.user?.name || "your therapist";
    history.push({ at: b.paid_at, kind: "credit", amount: total, label: `${b.size}-session pack with ${tName}`, sub: b.discount_pct ? `${b.discount_pct}% off` : "" });
    done.forEach((x, i) => history.push({ at: x.session_completed_at || x.booking_date, kind: "debit", amount: i === b.size - 1 ? r2(total - per * (b.size - 1)) : r2(per), label: `Session with ${tName}`, sub: `${i + 1} of ${b.size}` }));
    if (expired && left > 0) history.push({ at: b.expires_at, kind: "expired", amount: r2(left), label: `Pack with ${tName} expired`, sub: `${b.size - done.length - booked} session(s) unused` });
    return {
      _id: String(b._id), size: b.size, completed: done.length, booked, unbooked: remainingOf(b), total, per_session: per,
      balance: r2(left), expires_at: b.expires_at, expired, discount_pct: b.discount_pct, service: b.service, format: b.format,
      therapist: { _id: String(b.therapist?._id || ""), name: tName, photo: b.therapist?.user?.profile || "", profile_type: b.therapist?.profile_type || "", state: b.therapist?.state || "" },
    };
  });
  // CYT Noida clinic packages (kept by phone number)
  let clinic = [];
  const u = await User.findById(req.user._id, { phone: 1 }).lean();
  const p10 = String(u?.phone || "").replace(/\D/g, "").slice(-10);
  if (p10.length === 10) {
    const cr = await NoidaClientCredit.find({ phone: { $regex: `${p10}$` }, active: true }).sort({ createdAt: -1 }).lean();
    clinic = cr.map((c) => ({ _id: String(c._id), name: c.packageName || "Clinic package", total: c.totalSessions, used: c.sessionsUsed, left: Math.max(0, c.totalSessions - c.sessionsUsed) }));
  }
  history.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  res.json({ status: true, data: { balance: r2(balance), reserved: r2(reserved), packs, clinic, history: history.slice(0, 60) } });
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
