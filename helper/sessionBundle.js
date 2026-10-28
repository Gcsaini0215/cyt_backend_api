import mongoose from "mongoose";
import SessionBundle from "../models/SessionBundle.js";
import Booking from "../models/Booking.js";
import Therapists from "../models/Therapists.js";
import PackPricing from "../models/PackPricing.js";

// Session packs: size -> % off the therapist's own fee, set in Admin → Pack Pricing (these are the defaults).
// The discount comes off the session amount, so the therapist's 70% and CYT's 30% are both taken from the
// discounted price (shared, not CYT-funded).
export const DEFAULT_PACKS = [{ size: 4, pct: 5, active: true }, { size: 6, pct: 10, active: true }];
export const DEFAULT_DAYS = 90;
const DAY = 86400000;

// the current settings (cached a minute): { packs: [{ size, pct, active }], days }
let cache = { at: 0, data: null };
export function clearPackCache() { cache = { at: 0, data: null }; }
export async function getPackConfig() {
  if (cache.data && Date.now() - cache.at < 60000) return cache.data;
  const doc = await PackPricing.findOne({ key: "default" }).lean();
  const packs = (doc?.packs?.length ? doc.packs : DEFAULT_PACKS)
    .map((p) => ({ size: Number(p.size), pct: Number(p.pct), active: p.active !== false }))
    .sort((a, b) => a.size - b.size);
  const data = { packs, days: Number(doc?.days) > 0 ? Number(doc.days) : DEFAULT_DAYS, updatedAt: doc?.updatedAt || null, updatedBy: doc?.updatedBy || "" };
  cache = { at: Date.now(), data };
  return data;
}

// a pack's price for this fee — only an active pack size (cfg from getPackConfig)
export function packPrice(fee, size, cfg) {
  const p = (cfg?.packs || DEFAULT_PACKS).find((x) => x.size === Number(size) && x.active !== false);
  if (!p || !(fee > 0)) return null;
  const total = Math.round((fee * p.size * (100 - p.pct)) / 100);
  return { size: p.size, pct: p.pct, fee, total, per_session: Math.round((total / p.size) * 100) / 100 };
}

// the therapist's fee for this service + format (Therapists.fees), or null
export async function feeFor(therapistId, service, format) {
  const t = await Therapists.findById(therapistId).select("fees").lean();
  const svc = (t?.fees || []).find((f) => String(f.name).toLowerCase() === String(service || "").toLowerCase());
  const f = (svc?.formats || []).find((x) => String(x.type).toLowerCase() === String(format || "").toLowerCase());
  return Number(f?.fee) > 0 ? Number(f.fee) : null;
}

export const remainingOf = (b) => Math.max(0, (b?.size || 0) - (b?.used || 0));
export const isUsable = (b, now = Date.now()) => !!b && b.status === "active" && remainingOf(b) > 0 && new Date(b.expires_at).getTime() > now;

// take one session from the pack — atomic, so two bookings at once can't both take the last one
export function takeSession(bundleId, clientId, therapistId) {
  return SessionBundle.findOneAndUpdate(
    { _id: bundleId, client: clientId, therapist: therapistId, status: "active", expires_at: { $gt: new Date() }, $expr: { $lt: ["$used", "$size"] } },
    { $inc: { used: 1 } },
    { new: true }
  );
}

// a pack session was cancelled → give it back (never below 0)
export async function returnSession(booking) {
  if (!booking?.bundle) return;
  await SessionBundle.updateOne({ _id: booking.bundle, used: { $gt: 0 } }, { $inc: { used: -1 } });
}

// the pack bought with this (just paid) booking: the first of its sessions is this one
// (safe to call twice — the booking is claimed first, so a retried payment confirmation makes one pack)
// The pack is made on what was charged at booking (pack_total / pack_pct), even if the % changed since.
export async function activatePackFor(booking, paymentId) {
  if (!booking?.pack_size || booking.bundle || !(booking.pack_total > 0)) return null;
  const size = Number(booking.pack_size);
  const price = { size, pct: Number(booking.pack_pct) || 0, fee: Number(booking.pack_fee) || 0, total: Number(booking.pack_total), per_session: Math.round((Number(booking.pack_total) / size) * 100) / 100 };
  const days = Number(booking.pack_days) > 0 ? Number(booking.pack_days) : (await getPackConfig()).days;
  const id = new mongoose.Types.ObjectId();
  const claimed = await Booking.findOneAndUpdate({ _id: booking._id, bundle: null }, { $set: { bundle: id } });
  if (!claimed) return null;
  booking.bundle = id;
  const now = Date.now();
  const bundle = await SessionBundle.create({
    _id: id,
    client: booking.client?._id || booking.client, therapist: booking.therapist?._id || booking.therapist,
    service: booking.service, format: booking.format, size: price.size, discount_pct: price.pct, fee: price.fee,
    total: price.total, per_session: price.per_session, used: 1, paid_at: new Date(now), expires_at: new Date(now + days * DAY),
    first_booking: booking._id, razorpay_payment_id: paymentId || "",
  });
  return bundle;
}

export const bundleRow = (b) => ({
  _id: String(b._id), size: b.size, used: b.used, remaining: remainingOf(b), discount_pct: b.discount_pct,
  total: b.total, per_session: b.per_session, service: b.service, format: b.format,
  paid_at: b.paid_at, expires_at: b.expires_at, status: b.status,
  expired: new Date(b.expires_at).getTime() <= Date.now(),
});
