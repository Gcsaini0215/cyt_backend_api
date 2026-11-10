import express from "express";
import { hasPermission } from "../middlewares/authMiddleware.js";
import { listSuppressions, addSuppression, removeSuppression } from "../controllers/EmailSuppressionController.js";

// Admin → Content → Blocked emails (same access as "Sent Emails": clients permission)
const router = express.Router();

router.get("/email-suppressions", hasPermission("clients"), listSuppressions);
router.post("/email-suppressions", hasPermission("clients"), addSuppression);
router.delete("/email-suppressions/:id", hasPermission("clients"), removeSuppression);

export default router;
