import crypto from "crypto";
import expressAsyncHandler from "express-async-handler";
import NoidaPendingBooking from "../models/NoidaPendingBooking.js";
import { processPaidOrder } from "./NoidaAppointmentController.js";

// Razorpay -> us: "this payment was captured". For Noida bookings that's the
// safety net behind the browser callback — if the client paid but closed the
// tab (or lost signal) before the page could confirm, the booking is still
// made here; if the slot was taken meanwhile, the payment is refunded.
//
// Needs RAZORPAY_WEBHOOK_SECRET (set on the webhook in the Razorpay dashboard)
// and the raw request body, so this route is mounted ahead of express.json().
export const razorpayWebhook = expressAsyncHandler(async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({ status: false, message: "Webhook is not configured." });
  }

  const raw = req.body;
  const signature = req.headers["x-razorpay-signature"];
  if (!Buffer.isBuffer(raw) || typeof signature !== "string") {
    return res.status(400).json({ status: false, message: "Bad webhook request." });
  }

  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(400).json({ status: false, message: "Invalid signature." });
  }

  let event;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ status: false, message: "Invalid payload." });
  }

  if (event.event !== "payment.captured") {
    return res.status(200).json({ status: true, ignored: true });
  }
  const payment = event?.payload?.payment?.entity;
  if (!payment?.id || !payment?.order_id) {
    return res.status(200).json({ status: true, ignored: true });
  }

  // Not every Razorpay payment on this account is a Noida booking.
  const isNoida = await NoidaPendingBooking.exists({ orderId: payment.order_id });
  if (!isNoida) {
    return res.status(200).json({ status: true, ignored: true });
  }

  // Business failures (slot taken) are handled inside — they refund and
  // still return normally. Anything thrown here is unexpected (e.g. the
  // database is down) and should make Razorpay retry, so let it become a 500.
  await processPaidOrder({ orderId: payment.order_id, paymentId: payment.id });
  return res.status(200).json({ status: true });
});
