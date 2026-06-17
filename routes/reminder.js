import { Router } from "express";
import { sendFollowUpReminder } from "../controllers/ReminderController.js";
import { isAdmin } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/send-reminder", isAdmin, sendFollowUpReminder);

export default router;
