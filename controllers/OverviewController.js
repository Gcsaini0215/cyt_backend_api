import expressAsyncHandler from "express-async-handler";
import NoidaAppointment from "../models/NoidaAppointment.js";
import NoidaLastMinuteRequest from "../models/NoidaLastMinuteRequest.js";
import { AssessmentOrder } from "../models/AssessmentRequest.js";
import AssessmentRequest from "../models/AssessmentRequest.js";
import TherapistSubscriptionPayment from "../models/TherapistSubscriptionPayment.js";
import TherapistPayout from "../models/TherapistPayout.js";
import Trainee from "../models/Trainee.js";
import TraineeAccount from "../models/TraineeAccount.js";
import TraineeAttendance from "../models/TraineeAttendance.js";
import CollabApplication from "../models/CollabApplication.js";
import TherapistActionRequest from "../models/TherapistActionRequest.js";
import WorkshopBooking from "../models/WorkshopBooking.js";

/* GET /api/admin/overview-summary — the parts of the business the Overview didn't track yet:
   Noida centre, assessments, therapist plans, payouts, internships / trainee portal, collaborations,
   therapist requests and workshops. This month's money + what is waiting on the team. */
const IST_MS = 330 * 60000;
const istDay = (d = new Date()) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const monthStart = () => { const t = istDay(); return new Date(new Date(`${t.slice(0, 7)}-01T00:00:00Z`).getTime() - IST_MS); };
const sum = async (Model, match, field = "$amount") => {
  const r = await Model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: { $toDouble: { $ifNull: [field, 0] } } }, n: { $sum: 1 } } }]);
  return { total: Math.round(r[0]?.total || 0), n: r[0]?.n || 0 };
};

export const overviewSummary = expressAsyncHandler(async (req, res) => {
  const today = istDay();
  const from = monthStart();
  const [
    noidaToday, noidaMonth, lastMinute, assessMonth, assessReview, plansMonth, payoutsPending,
    internPending, internActive, internInToday, accountsWaiting, collabNew, therapistReqs, workshopMonth,
  ] = await Promise.all([
    NoidaAppointment.countDocuments({ date: today, status: "confirmed" }),
    sum(NoidaAppointment, { paymentStatus: "paid", createdAt: { $gte: from } }),
    NoidaLastMinuteRequest.countDocuments({ status: "pending" }),
    sum(AssessmentOrder, { status: "paid", createdAt: { $gte: from } }),
    AssessmentRequest.countDocuments({ status: "done" }),
    sum(TherapistSubscriptionPayment, { status: "paid", createdAt: { $gte: from } }),
    sum(TherapistPayout, { status: "pending" }),
    Trainee.countDocuments({ status: "pending" }),
    Trainee.countDocuments({ status: "active" }),
    TraineeAttendance.countDocuments({ date: today, checkIn: { $ne: null } }),
    TraineeAccount.countDocuments({ approval: "pending", verified: true }),
    CollabApplication.countDocuments({ status: "new" }),
    TherapistActionRequest.countDocuments({ status: "open" }),
    sum(WorkshopBooking, { is_payment_success: true, createdAt: { $gte: from } }),
  ]);
  res.json({
    status: true,
    data: {
      month: today.slice(0, 7),
      noida: { today: noidaToday, monthRevenue: noidaMonth.total, monthVisits: noidaMonth.n, lastMinutePending: lastMinute },
      assessments: { monthRevenue: assessMonth.total, monthCount: assessMonth.n, toReview: assessReview },
      plans: { monthRevenue: plansMonth.total, monthCount: plansMonth.n },
      payouts: { pendingCount: payoutsPending.n, pendingAmount: payoutsPending.total },
      internships: { pending: internPending, active: internActive, inToday: internInToday, accountsWaiting },
      collaborations: { new: collabNew },
      therapistRequests: { open: therapistReqs },
      workshops: { monthRevenue: workshopMonth.total, monthCount: workshopMonth.n },
    },
  });
});
