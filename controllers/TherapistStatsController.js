import expressAsyncHandler from "express-async-handler";
import Booking from "../models/Booking.js";
import Review from "../models/Review.js";
import { SESSION_STATUS } from "../helper/status.js";
import { isSuperAdminReq } from "../middlewares/hideRevenueMiddleware.js";

/* GET /api/therapist-stats  (admin, "therapists" permission)

   One row per therapist, computed from the bookings and reviews collections, so the Therapists page can track the whole
   pipeline — who is getting sessions, who is idle, ratings — without downloading every booking to the browser.

   {
     stats: { "<therapistId>": {
         total, paid, completed, cancelled, upcoming, last30, prev30, clients,
         lastBookingAt, nextBookingAt, lastCompletedAt,
         rating, reviews,
         earned            (Super Admin only — revenue is hidden from team members, like everywhere else)
     } },
     totals: { bookings, last30, upcoming, ... }
   } */
export const getTherapistStats = expressAsyncHandler(async (req, res) => {
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 86400000);
  const d60 = new Date(now.getTime() - 60 * 86400000);
  const showMoney = isSuperAdminReq(req);

  const [bk, rv] = await Promise.all([
    Booking.aggregate([
      {
        $group: {
          _id: "$therapist",
          total: { $sum: 1 },
          paid: { $sum: { $cond: [{ $eq: ["$payment_status", "Paid"] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ["$status", SESSION_STATUS.COMPLETED] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", SESSION_STATUS.CANCELED] }, 1, 0] } },
          upcoming: {
            $sum: {
              $cond: [
                { $and: [{ $gte: ["$booking_date", now] }, { $ne: ["$status", SESSION_STATUS.CANCELED] }, { $ne: ["$status", SESSION_STATUS.COMPLETED] }] },
                1, 0,
              ],
            },
          },
          last30: { $sum: { $cond: [{ $and: [{ $gte: ["$booking_date", d30] }, { $lte: ["$booking_date", now] }, { $ne: ["$status", SESSION_STATUS.CANCELED] }] }, 1, 0] } },
          prev30: { $sum: { $cond: [{ $and: [{ $gte: ["$booking_date", d60] }, { $lt: ["$booking_date", d30] }, { $ne: ["$status", SESSION_STATUS.CANCELED] }] }, 1, 0] } },
          clients: { $addToSet: "$client" },
          lastBookingAt: { $max: { $cond: [{ $lte: ["$booking_date", now] }, "$booking_date", null] } },
          nextBookingAt: { $min: { $cond: [{ $and: [{ $gte: ["$booking_date", now] }, { $ne: ["$status", SESSION_STATUS.CANCELED] }] }, "$booking_date", null] } },
          lastCompletedAt: { $max: "$session_completed_at" },
          earned: { $sum: { $cond: [{ $eq: ["$payment_status", "Paid"] }, { $toDouble: "$amount" }, 0] } },
        },
      },
    ]),
    Review.aggregate([{ $group: { _id: "$therapist_id", n: { $sum: 1 }, avg: { $avg: "$rating" } } }]),
  ]);

  const stats = {};
  const totals = { bookings: 0, paid: 0, completed: 0, cancelled: 0, upcoming: 0, last30: 0, prev30: 0 };
  bk.forEach((b) => {
    if (!b._id) return;
    stats[String(b._id)] = {
      total: b.total, paid: b.paid, completed: b.completed, cancelled: b.cancelled, upcoming: b.upcoming,
      last30: b.last30, prev30: b.prev30, clients: (b.clients || []).length,
      lastBookingAt: b.lastBookingAt, nextBookingAt: b.nextBookingAt, lastCompletedAt: b.lastCompletedAt,
      ...(showMoney ? { earned: Math.round(b.earned || 0) } : {}),
    };
    totals.bookings += b.total; totals.paid += b.paid; totals.completed += b.completed; totals.cancelled += b.cancelled;
    totals.upcoming += b.upcoming; totals.last30 += b.last30; totals.prev30 += b.prev30;
  });
  rv.forEach((r) => {
    if (!r._id) return;
    const k = String(r._id);
    stats[k] = { ...(stats[k] || {}), reviews: r.n, rating: Math.round((r.avg || 0) * 10) / 10 };
  });

  res.json({ status: true, data: { stats, totals, generatedAt: now, canSeeMoney: showMoney } });
});
