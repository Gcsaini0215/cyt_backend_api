import express from "express";
import { overviewSummary } from "../controllers/OverviewController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = express.Router();
// any admin who can see at least one module
router.get("/admin/overview-summary", hasPermission(["noidaCenter", "therapists", "probono", "clients", "bookings", "invoices", "leads", "reviews"]), overviewSummary);
export default router;
