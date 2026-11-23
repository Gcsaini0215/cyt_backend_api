import express from "express";
import { weeklyReview, getTargets, saveTargets, saveManual } from "../controllers/GrowthController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

// Admin → Growth 2027 (owner's growth plan PDF). Super Admin only: "growth2027" is not a Roles key, so only an
// admin with no Role passes hasPermission; the controller checks again.
const router = express.Router();
const superAdmin = hasPermission("growth2027");
router.get("/admin/growth/weekly", superAdmin, weeklyReview);
router.get("/admin/growth/targets", superAdmin, getTargets);
router.put("/admin/growth/targets", superAdmin, saveTargets);
router.put("/admin/growth/manual", superAdmin, saveManual);
export default router;
