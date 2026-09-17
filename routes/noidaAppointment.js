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
import { hasPermission } from "../middlewares/authMiddleware.js";
import { leadRateLimit, phoneLookupRateLimit } from "../middlewares/rateLimitMiddleware.js";

const router = Router();

router.get("/noida-appointments/slots", leadRateLimit, getAvailableSlots);       // public — no auth
router.get("/noida-appointments/lookup", phoneLookupRateLimit, lookupClientByPhone); // public — no auth
router.get("/noida-appointments/followup-dates", leadRateLimit, getFollowupDates); // public — no auth
router.get("/noida-appointments/pricing", leadRateLimit, getPublicPricing);      // public — no auth
router.post("/noida-appointments/create-order", leadRateLimit, createNoidaOrder); // public — no auth
router.post("/noida-appointments", leadRateLimit, createNoidaAppointment);       // public — no auth

router.get("/noida-appointments", hasPermission("bookings"), getNoidaAppointments);
router.patch("/noida-appointments/:id", hasPermission("bookings"), updateNoidaAppointment);
router.delete("/noida-appointments/:id", hasPermission("bookings"), deleteNoidaAppointment);

router.get("/noida-followup-slots", hasPermission("bookings"), getFollowupSlots);
router.post("/noida-followup-slots", hasPermission("bookings"), addFollowupSlots);
router.post("/noida-followup-slots/bulk", hasPermission("bookings"), addFollowupSlotsBulk);
router.delete("/noida-followup-slots/:id", hasPermission("bookings"), deleteFollowupSlot);

router.get("/noida-pricing", hasPermission("bookings"), getPricing);
router.patch("/noida-pricing", hasPermission("bookings"), updatePricing);
router.get("/noida-packages", hasPermission("bookings"), getPackages);
router.post("/noida-packages", hasPermission("bookings"), createPackage);
router.patch("/noida-packages/:id", hasPermission("bookings"), updatePackage);
router.delete("/noida-packages/:id", hasPermission("bookings"), deletePackage);

export default router;
