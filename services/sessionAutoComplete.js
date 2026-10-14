import Booking from "../models/Booking.js";
import { SESSION_MINUTES, JOIN_AFTER_END_MIN, deleteMeetEvent } from "../helper/googleMeet.js";

/* Every 5 minutes: sessions still "Started" after their join window (scheduled end + 30 min)
   are marked Completed (the therapist forgot to tap End), and calendar events of sessions whose
   window has closed are deleted so the Meet link can't be reused. */
const EVERY_MS = 5 * 60000;
let timer = null;

export async function runSessionAutoComplete() {
  const cutoff = new Date(Date.now() - (SESSION_MINUTES + JOIN_AFTER_END_MIN) * 60000);
  const stale = await Booking.find({ status: "Started", booking_date: { $lte: cutoff } }).select("_id booking_date therapist calendar_event_id").limit(200);
  for (const b of stale) {
    await Booking.updateOne({ _id: b._id, status: "Started" }, {
      $set: { status: "Completed", session_completed_at: new Date(new Date(b.booking_date).getTime() + SESSION_MINUTES * 60000), auto_completed: true },
    });
    await deleteMeetEvent(b);
  }
  // window closed but the event is still on the calendar (completed, cancelled or never joined)
  const leftovers = await Booking.find({ calendar_event_id: { $nin: ["", null] }, booking_date: { $lte: cutoff } }).select("_id therapist calendar_event_id").limit(200);
  for (const b of leftovers) await deleteMeetEvent(b);
  if (stale.length || leftovers.length) console.log(`[session-autocomplete] completed ${stale.length}, closed ${leftovers.length} meet link(s)`);
}

export function startSessionAutoComplete() {
  if (timer) return;
  const tick = async () => {
    try { await runSessionAutoComplete(); } catch (e) { console.error("[session-autocomplete] failed:", e.message); }
  };
  setTimeout(tick, 60000);
  timer = setInterval(tick, EVERY_MS);
}
