import { Router } from "express";
import { deleteLead, getLeads, getProbonoLeads, saveLead, verifyConsultPayment } from "../controllers/LeadController.js";
import { leadRateLimit } from "../middlewares/rateLimitMiddleware.js";
import { isAdmin } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/save-lead", leadRateLimit, saveLead);
router.post("/verify-consult-payment", leadRateLimit, verifyConsultPayment);
router.get("/leads", isAdmin, getLeads);
router.get("/probono-leads", isAdmin, getProbonoLeads);
router.delete("/leads/:id", isAdmin, deleteLead);

export default router;