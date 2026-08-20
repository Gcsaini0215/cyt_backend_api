import { Router } from "express";
import { createAppointmentRequest, getAppointmentRequests, updateAppointmentRequest, deleteAppointmentRequest } from "../controllers/AppointmentRequestController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/appointment-requests",        createAppointmentRequest);       // public — no auth
router.get("/appointment-requests",         hasPermission("clients"), getAppointmentRequests);
router.patch("/appointment-requests/:id",   hasPermission("clients"), updateAppointmentRequest);
router.delete("/appointment-requests/:id",  hasPermission("clients"), deleteAppointmentRequest);

export default router;
