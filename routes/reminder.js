import { Router } from "express";
import { sendFollowUpReminder } from "../controllers/ReminderController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/send-reminder", hasPermission("clients"), sendFollowUpReminder);

export default router;
