import { Router } from "express";
import { deleteLead, getLeads, saveLead } from "../controllers/LeadController.js";
import { leadRateLimit } from "../middlewares/rateLimitMiddleware.js";
import { isAdmin } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/save-lead", leadRateLimit, saveLead);
router.get("/leads", isAdmin, getLeads);
router.delete("/leads/:id", isAdmin, deleteLead);

export default router;