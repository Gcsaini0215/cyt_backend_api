import { Router } from "express";
import {
  createSessionReport,
  getSessionReports,
  updateSessionReport,
  deleteSessionReport,
} from "../controllers/SessionReportController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/session-reports", hasPermission("reports"), createSessionReport);
router.get("/session-reports", hasPermission("reports"), getSessionReports);
router.put("/session-reports/:id", hasPermission("reports"), updateSessionReport);
router.delete("/session-reports/:id", hasPermission("reports"), deleteSessionReport);

export default router;
