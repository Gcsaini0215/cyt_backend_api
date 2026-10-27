import express from "express";
import { postAiVisit, postAiConversion, adminAiVisits } from "../controllers/AiVisitController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";
import { aiVisitRateLimit } from "../middlewares/rateLimitMiddleware.js";

const router = express.Router();

// public — called by the website (no personal data: an anonymous browser id, the AI source, the landing path)
router.post("/ai-visits", aiVisitRateLimit, postAiVisit);
router.post("/ai-visits/convert", aiVisitRateLimit, postAiConversion);
// admin Overview card
router.get("/admin/ai-visits", hasPermission(["leads", "therapists", "clients", "bookings"]), adminAiVisits);

export default router;
