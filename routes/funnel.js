import express from "express";
import { postFunnelEvent, adminFunnel } from "../controllers/FunnelController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";
import { funnelRateLimit } from "../middlewares/rateLimitMiddleware.js";

const router = express.Router();

// public — the booking pages send step counts (no personal data, no ids)
router.post("/funnel/event", funnelRateLimit, postFunnelEvent);
// admin — booking funnel report
router.get("/admin/funnel", hasPermission(["bookings", "bdm"]), adminFunnel);

export default router;
