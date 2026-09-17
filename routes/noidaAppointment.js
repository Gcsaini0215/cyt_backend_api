import { Router } from "express";
import {
  getAvailableSlots,
  createNoidaAppointment,
  lookupClientByPhone,
  getFollowupDates,
  getNoidaAppointments,
  updateNoidaAppointment,
  deleteNoidaAppointment,
  getFollowupSlots,
  addFollowupSlots,
  deleteFollowupSlot,
} from "../controllers/NoidaAppointmentController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";
import { leadRateLimit, phoneLookupRateLimit } from "../middlewares/rateLimitMiddleware.js";

const router = Router();

router.get("/noida-appointments/slots", leadRateLimit, getAvailableSlots);       // public — no auth
router.get("/noida-appointments/lookup", phoneLookupRateLimit, lookupClientByPhone); // public — no auth
router.get("/noida-appointments/followup-dates", leadRateLimit, getFollowupDates); // public — no auth
router.post("/noida-appointments", leadRateLimit, createNoidaAppointment);       // public — no auth

router.get("/noida-appointments", hasPermission("bookings"), getNoidaAppointments);
router.patch("/noida-appointments/:id", hasPermission("bookings"), updateNoidaAppointment);
router.delete("/noida-appointments/:id", hasPermission("bookings"), deleteNoidaAppointment);

router.get("/noida-followup-slots", hasPermission("bookings"), getFollowupSlots);
router.post("/noida-followup-slots", hasPermission("bookings"), addFollowupSlots);
router.delete("/noida-followup-slots/:id", hasPermission("bookings"), deleteFollowupSlot);

export default router;
