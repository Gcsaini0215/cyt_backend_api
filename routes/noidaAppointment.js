import { Router } from "express";
import {
  getAvailableSlots,
  createNoidaOrder,
  createNoidaAppointment,
  lookupClientByPhone,
  getFollowupDates,
  getNoidaAppointments,
  updateNoidaAppointment,
  deleteNoidaAppointment,
  getFollowupSlots,
  addFollowupSlots,
  addFollowupSlotsBulk,
  deleteFollowupSlot,
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
import { leadRateLimit, phoneLookupRateLimit } from "../middlewares/rateLimitMiddleware.js";

const router = Router();

router.get("/noida-appointments/slots", leadRateLimit, getAvailableSlots);       // public — no auth
router.get("/noida-appointments/lookup", phoneLookupRateLimit, lookupClientByPhone); // public — no auth
router.get("/noida-appointments/followup-dates", leadRateLimit, getFollowupDates); // public — no auth
router.get("/noida-appointments/pricing", leadRateLimit, getPublicPricing);      // public — no auth
router.post("/noida-appointments/create-order", leadRateLimit, createNoidaOrder); // public — no auth
router.post("/noida-appointments", leadRateLimit, createNoidaAppointment);       // public — no auth

router.get("/noida-appointments", hasPermission("noidaCenter"), getNoidaAppointments);
router.patch("/noida-appointments/:id", hasPermission("noidaCenter"), updateNoidaAppointment);
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
