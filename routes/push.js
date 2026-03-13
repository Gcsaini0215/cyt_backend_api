import { Router } from "express";
import { subscribe, sendNotification } from "../controllers/PushController.js";
import { isAdmin, isAuth } from "../middlewares/authMiddleware.js";

const router = Router();

// Route to save subscription
router.post("/subscribe", isAuth, subscribe);

// Route to send notification (Admin only)
router.post("/send-notification", isAdmin, sendNotification);

export default router;
