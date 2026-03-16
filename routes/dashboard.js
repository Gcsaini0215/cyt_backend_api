import { Router } from "express";
import { isAuthCommon } from "../middlewares/authMiddleware.js";
import { getDashboardData as getClientDashboardData } from "../controllers/DashboardController.js";
import { getDashboardData as getTherapistDashboardData } from "../controllers/TherapistController.js";

const router = Router();

router.get("/get-dashboard-data", isAuthCommon, (req, res, next) => {
  if (req.user.role === 1) {
    return getTherapistDashboardData(req, res, next);
  }
  return getClientDashboardData(req, res, next);
});


export default router;
