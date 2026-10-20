import Booking from "../models/Booking.js";
import "../models/Users.js";
import "../models/Therapists.js";
import { sendMail } from "../helper/mailer.js";
import { sessionReminderMail } from "./mailTemplates.js";

/* "Your session starts in an hour" email to the client — sent once per booking, about 60 minutes before
   (any run that finds a session 40–70 minutes away sends it; runs every 5 min). Only paid sessions and
   CYT Noida bookings; never cancelled / completed / started ones. Reduces no-shows. */
const EVERY_MS = 5 * 60000;
const FROM_MIN = 40;
const TO_MIN = 70;
let timer = null;

const timeText = (d) => new Date(d).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) + " IST";
export const isInPersonBooking = (b) => /person|offline|clinic/i.test(`${b?.session_type || ""} ${b?.format || ""}`);

export async function runSessionReminders(now = Date.now()) {
  const due = await Booking.find({
    booking_date: { $gte: new Date(now + FROM_MIN * 60000), $lte: new Date(now + TO_MIN * 60000) },
    reminder_1h_sent_at: null,
    status: { $nin: ["Cancelled", "Completed", "Started"] },
    $or: [{ payment_status: "Paid" }, { source: "noida" }],
    client: { $ne: null },
  }).select("_id").limit(100).lean();

  let sent = 0;
  for (const { _id } of due) {
    // claim first so two runs never send twice
    const b = await Booking.findOneAndUpdate(
      { _id, reminder_1h_sent_at: null },
      { $set: { reminder_1h_sent_at: new Date() } },
      { new: true }
    ).populate("client", "name email").populate({ path: "therapist", select: "user", populate: { path: "user", select: "name" } });
    if (!b?.client?.email) continue;
    const therapistName = b.therapist?.user?.name || "your therapist";
    const inPerson = isInPersonBooking(b);
    const html = sessionReminderMail({
      clientName: String(b.client.name || "").split(/\s+/)[0],
      therapistName,
      sessionDateTime: timeText(b.booking_date),
      inPerson,
      meetLink: inPerson ? "" : b.meet_link || "",
    });
    const ok = await sendMail(b.client.email, `Reminder: your session with ${therapistName} starts in 1 hour`,
      `Hi ${b.client.name || "there"}, your session with ${therapistName} starts at ${timeText(b.booking_date)}.${inPerson ? " It's in person at CYT Noida, Sector 51." : " Join from My Bookings."}`, html);
    if (ok) sent++;
  }
  if (sent) console.log(`[session-reminder] sent ${sent}`);
  return sent;
}

export function startSessionReminders() {
  if (timer) return;
  const tick = async () => { try { await runSessionReminders(); } catch (e) { console.error("[session-reminder] failed:", e.message); } };
  setTimeout(tick, 60000);
  timer = setInterval(tick, EVERY_MS);
}
