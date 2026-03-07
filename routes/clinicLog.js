import { Router } from "express";
import {
  saveClinicLog,
  getClinicLogs,
  updateClinicLog,
  deleteClinicLog,
} from "../controllers/ClinicLogController.js";
import { isAuthCommon } from "../middlewares/authMiddleware.js";

const router = Router();

// All routes should use isAuthCommon to identify the therapist
router.post("/clinic-logs", isAuthCommon, saveClinicLog);
router.get("/clinic-logs", isAuthCommon, getClinicLogs);
router.put("/clinic-logs/:id", isAuthCommon, updateClinicLog);
router.delete("/clinic-logs/:id", isAuthCommon, deleteClinicLog);

export default router;
