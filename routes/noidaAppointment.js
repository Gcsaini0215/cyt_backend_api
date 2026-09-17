import { Router } from "express";
import {
  getAvailableSlots,
  createNoidaAppointment,
  getNoidaAppointments,
  updateNoidaAppointment,
  deleteNoidaAppointment,
} from "../controllers/NoidaAppointmentController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";
import { leadRateLimit } from "../middlewares/rateLimitMiddleware.js";

const router = Router();

router.get("/noida-appointments/slots", leadRateLimit, getAvailableSlots);      // public — no auth
router.post("/noida-appointments", leadRateLimit, createNoidaAppointment);      // public — no auth

router.get("/noida-appointments", hasPermission("bookings"), getNoidaAppointments);
router.patch("/noida-appointments/:id", hasPermission("bookings"), updateNoidaAppointment);
router.delete("/noida-appointments/:id", hasPermission("bookings"), deleteNoidaAppointment);

export default router;
