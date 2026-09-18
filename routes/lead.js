import { Router } from "express";
import { assignLead, deleteLead, deleteLeadActivity, getLeadActivity, getLeads, getProbonoLeads, saveLead, updateLeadStatus, verifyConsultPayment } from "../controllers/LeadController.js";
import { leadRateLimit } from "../middlewares/rateLimitMiddleware.js";
import { hasPermission, isSuperAdmin } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/save-lead", leadRateLimit, saveLead);
router.post("/verify-consult-payment", leadRateLimit, verifyConsultPayment);
router.get("/leads", hasPermission(["leads","bdm"]), getLeads);
router.get("/lead-activity", isSuperAdmin, getLeadActivity);
router.delete("/lead-activity/:id", isSuperAdmin, deleteLeadActivity);
router.get("/probono-leads", hasPermission("probono"), getProbonoLeads);
router.patch("/leads/:id/status", hasPermission(["leads","bdm"]), updateLeadStatus);
router.patch("/leads/:id/assign", hasPermission(["leads","bdm"]), assignLead);
router.delete("/leads/:id", hasPermission("leads"), deleteLead);

export default router;