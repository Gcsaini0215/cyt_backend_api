import Booking from "../models/Booking.js";
import { SESSION_MINUTES, JOIN_AFTER_END_MIN, deleteMeetEvent } from "../helper/googleMeet.js";
import { notifyTherapists, therapistUserId } from "./therapistNotify.js";
import { notifyClient } from "./clientNotify.js";

/* Every 5 minutes: sessions still "Started" after their join window (scheduled end + 30 min)
   are marked Completed (the therapist forgot to tap End), and calendar events of sessions whose
   window has closed are deleted so the Meet link can't be reused. */
const EVERY_MS = 5 * 60000;
let timer = null;

// paid sessions starting in the next 20 minutes → "starting soon" for the client (once each)
async function remindSoon() {
  const now = Date.now();
  const soon = await Booking.find({
    status: "New", payment_status: "Paid", booking_date: { $gt: new Date(now), $lte: new Date(now + 20 * 60000) },
  }).select("_id booking_date client therapist").populate({ path: "therapist", select: "user", populate: { path: "user", select: "name" } }).limit(200).lean();
  for (const b of soon) {
    const mins = Math.max(1, Math.round((new Date(b.booking_date).getTime() - now) / 60000));
    await notifyClient(b.client, {
      type: "soon", title: `Your session starts in ${mins} min`,
      body: `With ${b.therapist?.user?.name || "your therapist"} — Join opens 15 minutes before.`, link: "/my-dashboard", ref: `soon:${b._id}`,
    });
  }
}

export async function runSessionAutoComplete() {
  await remindSoon().catch((e) => console.error("[client-remind] failed:", e.message));
  const cutoff = new Date(Date.now() - (SESSION_MINUTES + JOIN_AFTER_END_MIN) * 60000);
  const stale = await Booking.find({ status: "Started", booking_date: { $lte: cutoff } }).select("_id booking_date therapist calendar_event_id client").populate("client", "name").limit(200);
  for (const b of stale) {
    const r = await Booking.updateOne({ _id: b._id, status: "Started" }, {
      $set: { status: "Completed", session_completed_at: new Date(new Date(b.booking_date).getTime() + SESSION_MINUTES * 60000), auto_completed: true },
    });
    if (r.modifiedCount) {
      notifyTherapists([await therapistUserId(b.therapist)], {
        type: "session", title: "Session marked completed",
        body: `${b.client?.name || "Client"} — completed automatically after the session time.`, link: "/appointments", ref: `completed:${b._id}`,
      });
      notifyClient(b.client?._id, {
        type: "completed", title: "Session completed",
        body: "How did it go? Leave a quick review and book your next session.", link: "/my-dashboard", ref: `completed:${b._id}`,
      });
    }
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
