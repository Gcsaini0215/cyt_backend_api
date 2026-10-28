import mongoose from "mongoose";
import SessionBundle from "../models/SessionBundle.js";
import Booking from "../models/Booking.js";
import Therapists from "../models/Therapists.js";

// Session packs: size -> % off the therapist's own fee. The discount comes off the session amount, so the
// therapist's 70% and CYT's 30% are both taken from the discounted price (shared, not CYT-funded).
export const PACKS = { 4: 5, 6: 10 };
export const PACK_DAYS = 90;
const DAY = 86400000;

export function packPrice(fee, size) {
  const pct = PACKS[size];
  if (!pct || !(fee > 0)) return null;
  const total = Math.round((fee * size * (100 - pct)) / 100);
  return { size, pct, fee, total, per_session: Math.round((total / size) * 100) / 100 };
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
export async function activatePackFor(booking, paymentId) {
  if (!booking?.pack_size || booking.bundle) return null;
  const price = packPrice(Number(booking.pack_fee) || 0, booking.pack_size);
  if (!price) return null;
  const id = new mongoose.Types.ObjectId();
  const claimed = await Booking.findOneAndUpdate({ _id: booking._id, bundle: null }, { $set: { bundle: id } });
  if (!claimed) return null;
  booking.bundle = id;
  const now = Date.now();
  const bundle = await SessionBundle.create({
    _id: id,
    client: booking.client?._id || booking.client, therapist: booking.therapist?._id || booking.therapist,
    service: booking.service, format: booking.format, size: price.size, discount_pct: price.pct, fee: price.fee,
    total: price.total, per_session: price.per_session, used: 1, paid_at: new Date(now), expires_at: new Date(now + PACK_DAYS * DAY),
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
