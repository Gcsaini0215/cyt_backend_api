import { Router } from "express";
import { deleteLead, getLeads, getProbonoLeads, saveLead, verifyConsultPayment } from "../controllers/LeadController.js";
import { leadRateLimit } from "../middlewares/rateLimitMiddleware.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/save-lead", leadRateLimit, saveLead);
router.post("/verify-consult-payment", leadRateLimit, verifyConsultPayment);
router.get("/leads", hasPermission(["leads","bdm"]), getLeads);
router.get("/probono-leads", hasPermission("probono"), getProbonoLeads);
router.delete("/leads/:id", hasPermission("leads"), deleteLead);

export default router;