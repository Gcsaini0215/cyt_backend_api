import { Router } from "express";
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
} from "../controllers/NoidaAppointmentController.js";
import {
  getPublicPricing,
  getPricing,
  updatePricing,
  getPackages,
  createPackage,
  updatePackage,
  deletePackage,
} from "../controllers/NoidaPricingController.js";
import {
  getClientCredits,
  createClientCredit,
  updateClientCredit,
  deleteClientCredit,
} from "../controllers/NoidaClientCreditController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";
import { leadRateLimit, phoneLookupRateLimit, pollingRateLimit, lastMinuteRequestRateLimit } from "../middlewares/rateLimitMiddleware.js";

const router = Router();

router.get("/noida-appointments/slots", leadRateLimit, getAvailableSlots);       // public — no auth
router.get("/noida-appointments/slots-matrix", leadRateLimit, getPublicSlotsMatrix); // public — no auth
router.get("/noida-appointments/lookup", phoneLookupRateLimit, lookupClientByPhone); // public — no auth
router.get("/noida-appointments/followup-dates", leadRateLimit, getFollowupDates); // public — no auth
router.get("/noida-appointments/pricing", leadRateLimit, getPublicPricing);      // public — no auth
router.post("/noida-appointments/create-order", leadRateLimit, createNoidaOrder); // public — no auth
router.post("/noida-appointments", leadRateLimit, createNoidaAppointment);       // public — no auth
router.get("/noida-appointments/upcoming", phoneLookupRateLimit, getUpcomingAppointment); // public — no auth
router.patch("/noida-appointments/reschedule", leadRateLimit, rescheduleNoidaAppointment); // public — no auth, registered before the :id route below

router.post("/noida-appointments/last-minute-requests", lastMinuteRequestRateLimit, createLastMinuteRequest); // public — no auth
router.get("/noida-appointments/last-minute-requests/:id/status", pollingRateLimit, getLastMinuteRequestStatus); // public — no auth, polled

router.post("/noida-appointments/admin-book-credit", hasPermission("noidaCenter"), adminBookCreditSession);
router.post("/noida-appointments/admin-create", hasPermission("noidaCenter"), adminCreateNoidaAppointment);
router.get("/noida-appointments/payment-qr", hasPermission("noidaCenter"), getNoidaPaymentQr);
router.get("/noida-appointments/last-minute-requests", hasPermission("noidaCenter"), getLastMinuteRequests);
router.patch("/noida-appointments/last-minute-requests/:id/accept", hasPermission("noidaCenter"), acceptLastMinuteRequest);
router.patch("/noida-appointments/last-minute-requests/:id/reject", hasPermission("noidaCenter"), rejectLastMinuteRequest);
router.get("/noida-appointments/summary", hasPermission("noidaCenter"), getNoidaAppointmentsSummary);
router.get("/noida-appointments/export", hasPermission("noidaCenter"), exportNoidaAppointments);
router.get("/noida-appointments/payment-problems", hasPermission("noidaCenter"), getPaymentProblems);
router.post("/noida-appointments/payment-problems/:id/retry", hasPermission("noidaCenter"), retryPaymentProblem);
router.patch("/noida-appointments/payment-problems/:id/resolve", hasPermission("noidaCenter"), resolvePaymentProblem);
router.get("/noida-appointments", hasPermission("noidaCenter"), getNoidaAppointments);
router.patch("/noida-appointments/:id", hasPermission("noidaCenter"), updateNoidaAppointment);
router.patch("/noida-appointments/:id/assign", hasPermission("noidaCenter"), assignNoidaAppointment);
router.delete("/noida-appointments/:id", hasPermission("noidaCenter"), deleteNoidaAppointment);

router.get("/noida-followup-slots", hasPermission("noidaCenter"), getFollowupSlots);
router.post("/noida-followup-slots", hasPermission("noidaCenter"), addFollowupSlots);
router.post("/noida-followup-slots/bulk", hasPermission("noidaCenter"), addFollowupSlotsBulk);
router.delete("/noida-followup-slots/:id", hasPermission("noidaCenter"), deleteFollowupSlot);

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
