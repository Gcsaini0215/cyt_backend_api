import { Router } from "express";
import { validateCoupon, getCoupons, createCoupon, updateCoupon, deleteCoupon } from "../controllers/NoidaCouponController.js";
import {
  getAvailableSlots,
  getPublicSlotsMatrix,
  createNoidaOrder,
  createNoidaAppointment,
  lookupClientByPhone,
  getFollowupDates,
  getNoidaAppointments,
  updateNoidaAppointment,
  assignNoidaAppointment,
  deleteNoidaAppointment,
  getFollowupSlots,
  addFollowupSlots,
  addFollowupSlotsBulk,
  deleteFollowupSlot,
  getUpcomingAppointment,
  rescheduleNoidaAppointment,
  adminBookCreditSession,
  adminCreateNoidaAppointment,
  exportNoidaAppointments,
  getNoidaAppointmentsSummary,
  getPaymentProblems,
  retryPaymentProblem,
  resolvePaymentProblem,
  getNoidaPaymentQr,
  createLastMinuteRequest,
  getLastMinuteRequestStatus,
  getLastMinuteRequests,
  acceptLastMinuteRequest,
  rejectLastMinuteRequest,
  getNoidaClientsList,
  getNoidaClientProfile,
  deleteNoidaClient,
  getNoidaRecentActivity,
} from "../controllers/NoidaAppointmentController.js";
import {
  getPublicPricing,
  getPricing,
  updatePricing,
  getPackages,
  createPackage,
  updatePackage,
  deletePackage,
  getPublicNoidaTherapists,
  getNoidaTherapistOptions,
  updateNoidaTherapists,
} from "../controllers/NoidaPricingController.js";
import {
  getClientCredits,
  createClientCredit,
  updateClientCredit,
  deleteClientCredit,
} from "../controllers/NoidaClientCreditController.js";
import { pingNoidaPresence, getNoidaPresence } from "../controllers/NoidaPresenceController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";
import { hideRevenueForTeam } from "../middlewares/hideRevenueMiddleware.js";
import { leadRateLimit, phoneLookupRateLimit, pollingRateLimit, lastMinuteRequestRateLimit } from "../middlewares/rateLimitMiddleware.js";

const router = Router();

router.get("/noida-appointments/slots", leadRateLimit, getAvailableSlots);       // public — no auth
router.get("/noida-appointments/slots-matrix", leadRateLimit, getPublicSlotsMatrix); // public — no auth
router.get("/noida-appointments/lookup", phoneLookupRateLimit, lookupClientByPhone); // public — no auth
router.get("/noida-appointments/followup-dates", leadRateLimit, getFollowupDates); // public — no auth
router.get("/noida-appointments/pricing", leadRateLimit, getPublicPricing);      // public — no auth
router.get("/noida-appointments/therapists", leadRateLimit, getPublicNoidaTherapists); // public — no auth
router.post("/noida-appointments/create-order", leadRateLimit, createNoidaOrder); // public — no auth
router.post("/noida-appointments/coupon/validate", leadRateLimit, validateCoupon);   // public — no auth
router.post("/noida-appointments", leadRateLimit, createNoidaAppointment);       // public — no auth
router.get("/noida-appointments/upcoming", phoneLookupRateLimit, getUpcomingAppointment); // public — no auth
router.patch("/noida-appointments/reschedule", leadRateLimit, rescheduleNoidaAppointment); // public — no auth, registered before the :id route below

router.post("/noida-appointments/last-minute-requests", lastMinuteRequestRateLimit, createLastMinuteRequest); // public — no auth
router.get("/noida-appointments/last-minute-requests/:id/status", pollingRateLimit, getLastMinuteRequestStatus); // public — no auth, polled

router.post("/noida-appointments/admin-book-credit", hasPermission("noidaCenter"), hideRevenueForTeam, adminBookCreditSession);
router.post("/noida-appointments/admin-create", hasPermission("noidaCenter"), hideRevenueForTeam, adminCreateNoidaAppointment);
router.get("/noida-appointments/payment-qr", hasPermission("noidaCenter"), getNoidaPaymentQr);
router.get("/noida-appointments/last-minute-requests", hasPermission("noidaCenter"), hideRevenueForTeam, getLastMinuteRequests);
router.patch("/noida-appointments/last-minute-requests/:id/accept", hasPermission("noidaCenter"), hideRevenueForTeam, acceptLastMinuteRequest);
router.patch("/noida-appointments/last-minute-requests/:id/reject", hasPermission("noidaCenter"), rejectLastMinuteRequest);
router.get("/noida-appointments/summary", hasPermission("noidaCenter"), hideRevenueForTeam, getNoidaAppointmentsSummary);
// Live visitors on the public booking page: visitors ping (public), reception reads the counts.
router.post("/noida-appointments/presence", pollingRateLimit, pingNoidaPresence);
router.get("/noida-appointments/presence", hasPermission("noidaCenter"), getNoidaPresence);
router.get("/noida-appointments/export", hasPermission("noidaCenter"), hideRevenueForTeam, exportNoidaAppointments);
router.get("/noida-appointments/payment-problems", hasPermission("noidaCenter"), hideRevenueForTeam, getPaymentProblems);
router.post("/noida-appointments/payment-problems/:id/retry", hasPermission("noidaCenter"), hideRevenueForTeam, retryPaymentProblem);
router.patch("/noida-appointments/payment-problems/:id/resolve", hasPermission("noidaCenter"), hideRevenueForTeam, resolvePaymentProblem);
router.get("/noida-appointments/clients", hasPermission("noidaCenter"), hideRevenueForTeam, getNoidaClientsList);
router.get("/noida-appointments/client-profile", hasPermission("noidaCenter"), hideRevenueForTeam, getNoidaClientProfile);
router.delete("/noida-appointments/clients/:phone", hasPermission("noidaCenter"), deleteNoidaClient);
router.get("/noida-appointments/recent-activity", hasPermission("noidaCenter"), hideRevenueForTeam, getNoidaRecentActivity);
router.get("/noida-appointments", hasPermission("noidaCenter"), hideRevenueForTeam, getNoidaAppointments);
router.patch("/noida-appointments/:id", hasPermission("noidaCenter"), hideRevenueForTeam, updateNoidaAppointment);
router.patch("/noida-appointments/:id/assign", hasPermission("noidaCenter"), hideRevenueForTeam, assignNoidaAppointment);
router.delete("/noida-appointments/:id", hasPermission("noidaCenter"), deleteNoidaAppointment);

router.get("/noida-followup-slots", hasPermission("noidaCenter"), hideRevenueForTeam, getFollowupSlots);
router.post("/noida-followup-slots", hasPermission("noidaCenter"), addFollowupSlots);
router.post("/noida-followup-slots/bulk", hasPermission("noidaCenter"), addFollowupSlotsBulk);
router.delete("/noida-followup-slots/:id", hasPermission("noidaCenter"), deleteFollowupSlot);

router.get("/noida-coupons", hasPermission("noidaCenter"), getCoupons);
router.post("/noida-coupons", hasPermission("noidaCenter"), createCoupon);
router.patch("/noida-coupons/:id", hasPermission("noidaCenter"), updateCoupon);
router.delete("/noida-coupons/:id", hasPermission("noidaCenter"), deleteCoupon);

router.get("/noida-therapists/options", hasPermission("noidaCenter"), getNoidaTherapistOptions);
router.patch("/noida-therapists", hasPermission("noidaCenter"), updateNoidaTherapists);

router.get("/noida-pricing", hasPermission("noidaCenter"), getPricing);
router.patch("/noida-pricing", hasPermission("noidaCenter"), updatePricing);
router.get("/noida-packages", hasPermission("noidaCenter"), getPackages);
router.post("/noida-packages", hasPermission("noidaCenter"), createPackage);
router.patch("/noida-packages/:id", hasPermission("noidaCenter"), updatePackage);
router.delete("/noida-packages/:id", hasPermission("noidaCenter"), deletePackage);

router.get("/noida-client-credits", hasPermission("noidaCenter"), getClientCredits);
router.post("/noida-client-credits", hasPermission("noidaCenter"), createClientCredit);
router.patch("/noida-client-credits/:id", hasPermission("noidaCenter"), updateClientCredit);
router.delete("/noida-client-credits/:id", hasPermission("noidaCenter"), deleteClientCredit);

export default router;
