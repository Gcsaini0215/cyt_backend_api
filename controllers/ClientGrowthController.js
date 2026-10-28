import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Users from "../models/Users.js";
import Review from "../models/Review.js";

/* GET /api/admin/client-growth?days=30 — is the client portal bringing people back?
   rebook rate, review rate, referral bookings, unpaid bookings recovered, and the rebook nudge emails
   (services/rebookNudge.js). Online/in-person bookings only (Noida centre sessions are tracked there). */
const DAY = 86400000;
const paid = { $or: [{ payment_status: "Paid" }, { transaction: { $ne: null } }] };
// Booking has no createdAt — when it was made is in its _id
const idAt = (d) => mongoose.Types.ObjectId.createFromTime(Math.floor(new Date(d).getTime() / 1000));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

export const clientGrowth = expressAsyncHandler(async (req, res) => {
  const days = Math.min(180, Math.max(7, Number(req.query.days) || 30));
  const now = Date.now();
  const from = new Date(now - days * DAY);

  // sessions completed in the window — was another one booked after it, was the therapist reviewed?
  const done = await Booking.find({ status: "Completed", source: { $ne: "noida" }, client: { $ne: null }, booking_date: { $gte: from } })
    .select("_id client therapist booking_date").lean();
  const clientIds = [...new Set(done.map((b) => String(b.client)))];
  const later = clientIds.length ? await Booking.find({
    client: { $in: clientIds }, status: { $ne: "Cancelled" }, booking_date: { $gte: from }, ...paid,
  }).select("client booking_date").lean() : [];
  const datesOf = new Map();
  later.forEach((b) => { const k = String(b.client); if (!datesOf.has(k)) datesOf.set(k, []); datesOf.get(k).push(new Date(b.booking_date).getTime()); });
  const rebooked = done.filter((b) => (datesOf.get(String(b.client)) || []).some((t) => t > new Date(b.booking_date).getTime())).length;

  const users = clientIds.length ? await Users.find({ _id: { $in: clientIds } }).select("email").lean() : [];
  const emailOf = new Map(users.map((u) => [String(u._id), String(u.email || "").toLowerCase()]));
  const reviews = await Review.find({ email: { $in: [...new Set([...emailOf.values()].filter(Boolean))] } }).select("email therapist_id").lean();
  const reviewedPairs = new Set(reviews.map((r) => `${String(r.email).toLowerCase()}|${r.therapist_id}`));
  const pairs = new Set(done.map((b) => `${emailOf.get(String(b.client)) || ""}|${b.therapist}`));
  const reviewedN = [...pairs].filter((p) => reviewedPairs.has(p)).length;

  // bookings made in the window
  const created = { _id: { $gte: idAt(from) } };
  const [referralPaid, creditUsed, pendingMailed, pendingRecovered, nudgesSent, nudges] = await Promise.all([
    Booking.countDocuments({ ...created, referral_code: { $nin: ["", null] }, ...paid }),
    Booking.aggregate([{ $match: { ...created, credit_used: { $gt: 0 }, ...paid } }, { $group: { _id: null, t: { $sum: "$credit_used" }, n: { $sum: 1 } } }]),
    Booking.countDocuments({ ...created, pending_mail_sent_at: { $ne: null } }),
    Booking.countDocuments({ ...created, pending_mail_sent_at: { $ne: null }, ...paid }),
    Booking.countDocuments({ rebook_nudge: "sent", rebook_nudge_at: { $gte: from } }),
    Booking.find({ rebook_nudge: "sent", rebook_nudge_at: { $gte: from } }).select("client rebook_nudge_at").lean(),
  ]);
  // a nudge "worked" when the client paid for a booking made within 14 days of it
  let nudgeBooked = 0;
  for (const n of nudges) {
    const at = new Date(n.rebook_nudge_at);
    if (await Booking.exists({ client: n.client, _id: { $gte: idAt(at), $lte: idAt(at.getTime() + 14 * DAY) }, ...paid })) nudgeBooked++;
  }

  res.json({
    status: true,
    data: {
      days,
      completed: done.length,
      rebooked, rebookRate: pct(rebooked, done.length),
      reviewPairs: pairs.size, reviewed: reviewedN, reviewRate: pct(reviewedN, pairs.size),
      referralBookings: referralPaid,
      creditUsed: Math.round(creditUsed[0]?.t || 0), creditBookings: creditUsed[0]?.n || 0,
      pendingMailed, pendingRecovered, recoveryRate: pct(pendingRecovered, pendingMailed),
      nudgesSent, nudgeBooked, nudgeRate: pct(nudgeBooked, nudgesSent),
    },
  });
});
