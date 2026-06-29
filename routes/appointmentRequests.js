import { Router } from "express";
import { createAppointmentRequest, getAppointmentRequests, updateAppointmentRequest, deleteAppointmentRequest } from "../controllers/AppointmentRequestController.js";
import { isAdmin } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/appointment-requests",        createAppointmentRequest);       // public — no auth
router.get("/appointment-requests",         isAdmin, getAppointmentRequests);
router.patch("/appointment-requests/:id",   isAdmin, updateAppointmentRequest);
router.delete("/appointment-requests/:id",  isAdmin, deleteAppointmentRequest);

export default router;
