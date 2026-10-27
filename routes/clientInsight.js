import express from "express";
import { listClients, clientDetail } from "../controllers/ClientInsightController.js";
import { reassignBooking } from "../controllers/BookingReassignController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.get("/admin/client-360", hasPermission("clients"), listClients);
router.get("/admin/client-360/:id", hasPermission("clients"), clientDetail);
// Client 360 → Replace therapist on a session that hasn't started
router.patch("/admin/bookings/:id/reassign", hasPermission(["clients", "bookings"]), reassignBooking);
export default router;
