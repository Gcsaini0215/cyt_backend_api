import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import "../models/Users.js";
import "../models/Therapists.js";
import { sendMail } from "../helper/mailer.js";
import { bookingRequestReceivedMail } from "../services/mailTemplates.js";

/* "We've got your request — complete payment" email, sent only when a booking is STILL unpaid
   10 minutes after it was created (the client may still be on the Razorpay screen before that).
   Looks at bookings created in the last 2 hours only, and sends at most once per booking. */
const WAIT_MIN = 10;
const LOOKBACK_MIN = 120;
const EVERY_MS = 2 * 60000;
let timer = null;

const slotText = (d) => new Date(d).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) + " IST";
const idAt = (ms) => mongoose.Types.ObjectId.createFromTime(Math.floor(ms / 1000));

export async function runPendingPaymentMails() {
  const now = Date.now();
  const due = await Booking.find({
    _id: { $gte: idAt(now - LOOKBACK_MIN * 60000), $lte: idAt(now - WAIT_MIN * 60000) },
    payment_status: "Pending Payment",
    pending_mail_sent_at: null,
    booking_date: { $gt: new Date() },
  }).select("_id").limit(50).lean();

  let sent = 0;
  for (const { _id } of due) {
    // claim it first so two runs (or two servers) never send twice
    const b = await Booking.findOneAndUpdate(
      { _id, payment_status: "Pending Payment", pending_mail_sent_at: null },
      { $set: { pending_mail_sent_at: new Date() } },
      { new: true }
    ).populate("client", "name email").populate({ path: "therapist", select: "user", populate: { path: "user", select: "name" } });
    if (!b?.client?.email) continue;
    const html = bookingRequestReceivedMail({
      clientName: b.client.name || b.client.email,
      therapistName: b.therapist?.user?.name || "your therapist",
      service: b.service, format: b.format, sessionDateTime: slotText(b.booking_date), sessionMode: b.session_type,
      whom: b.whom, cname: b.cname, relation_with_client: b.relation_with_client, notes: b.notes,
    });
    const ok = await sendMail(b.client.email, "Complete your booking — Choose Your Therapist",
      `Hi ${b.client.name || "there"}, your session request for ${slotText(b.booking_date)} is saved. It's confirmed once payment is completed.`, html);
    if (ok) sent++;
  }
  if (sent) console.log(`[pending-payment-mail] sent ${sent}`);
  return sent;
}

export function startPendingPaymentMails() {
  if (timer) return;
  const tick = async () => { try { await runPendingPaymentMails(); } catch (e) { console.error("[pending-payment-mail] failed:", e.message); } };
  setTimeout(tick, 90000);
  timer = setInterval(tick, EVERY_MS);
}
