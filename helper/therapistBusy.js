import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import NoidaAppointment from "../models/NoidaAppointment.js";
import { noPreferenceTherapist, noidaSlotDate } from "./noidaBookingSync.js";

/* One psychologist, one session at a time — across the online booking page and the CYT Noida centre.
   Deepak Kumar is the centre's psychologist (and gets every "No preference" Noida booking), so:
   - his online calendar treats every confirmed Noida booking of his (or with no preference) as busy, and
   - the Noida slot table / booking treats his paid online sessions as busy.
   Two sessions clash when they start less than an hour apart (sessions run 50–60 min). */

export const SESSION_MIN = 60;
const MIN = 60000;
const istToday = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
// a paid booking, or one being paid for right now (started in the last 20 min, not abandoned)
const liveBooking = (excludeClient = null) => ({
  status: { $ne: "Cancelled" },
  $or: [
    { payment_status: "Paid" },
    { payment_status: "Pending Payment", _id: { $gt: mongoose.Types.ObjectId.createFromTime(Math.floor((Date.now() - 20 * MIN) / 1000)) }, slot_released_at: null,
      ...(excludeClient ? { client: { $ne: excludeClient } } : {}) },
  ],
});

// Noida appointments that are this psychologist's: chosen by name, or "No preference" when they're the default
async function noidaFilterFor(therapistId) {
  const def = await noPreferenceTherapist();
  const mine = def && String(def) === String(therapistId);
  return mine ? { $or: [{ therapist: therapistId }, { therapist: null }] } : { therapist: therapistId };
}

/* every session start this psychologist is busy at from now on (online bookings, Noida mirrors and Noida
   appointments themselves, so a missing mirror can't leave a gap) */
export async function busyStarts(therapistId) {
  const now = new Date();
  const [bookings, appts] = await Promise.all([
    Booking.find({ therapist: therapistId, booking_date: { $gte: new Date(now.getTime() - SESSION_MIN * MIN) }, ...liveBooking() }).select("booking_date").lean(),
    NoidaAppointment.find({ status: "confirmed", date: { $gte: istToday() }, ...(await noidaFilterFor(therapistId)) }).select("date slot").lean(),
  ]);
  const ms = new Set(bookings.map((b) => new Date(b.booking_date).getTime()));
  appts.forEach((a) => ms.add(noidaSlotDate(a.date, a.slot).getTime()));
  return [...ms].sort((a, b) => a - b);
}

// is this psychologist already busy within an hour of `start`? (excludeBookingId: the booking being moved)
export async function busyNear(therapistId, start, { excludeBookingId = null, excludeClient = null } = {}) {
  const t = new Date(start).getTime();
  const lo = new Date(t - (SESSION_MIN - 1) * MIN), hi = new Date(t + (SESSION_MIN - 1) * MIN);
  const clash = await Booking.exists({ therapist: therapistId, booking_date: { $gt: lo, $lt: hi }, ...(excludeBookingId ? { _id: { $ne: excludeBookingId } } : {}), ...liveBooking(excludeClient) });
  if (clash) return true;
  // Noida appointments without a booking yet: check the days around it
  const days = [new Date(t - 86400000), new Date(t), new Date(t + 86400000)].map((d) => new Date(d.getTime() + 5.5 * 3600000).toISOString().slice(0, 10));
  const appts = await NoidaAppointment.find({ status: "confirmed", date: { $in: days }, ...(await noidaFilterFor(therapistId)) }).select("date slot").lean();
  return appts.some((a) => Math.abs(noidaSlotDate(a.date, a.slot).getTime() - t) < SESSION_MIN * MIN);
}

// the psychologist's online (non-Noida) sessions near a Noida slot — used by the Noida side
export async function onlineBusyNear(therapistId, start) {
  const t = new Date(start).getTime();
  return !!(await Booking.exists({
    therapist: therapistId, source: { $ne: "noida" },
    booking_date: { $gt: new Date(t - (SESSION_MIN - 1) * MIN), $lt: new Date(t + (SESSION_MIN - 1) * MIN) }, ...liveBooking(),
  }));
}

// online session starts of a psychologist in a date range (for marking a whole Noida slot table at once)
export async function onlineStartsBetween(therapistId, from, to) {
  const rows = await Booking.find({ therapist: therapistId, source: { $ne: "noida" }, booking_date: { $gte: from, $lte: to }, ...liveBooking() }).select("booking_date").lean();
  return rows.map((b) => new Date(b.booking_date).getTime());
}
