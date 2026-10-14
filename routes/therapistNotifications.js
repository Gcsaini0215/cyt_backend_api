import express from "express";
import { isTherapist } from "../middlewares/authMiddleware.js";
import { listNotifications, readNotifications, notificationStream } from "../controllers/TherapistNotificationController.js";

const router = express.Router();

router.get("/therapist-notifications/stream", notificationStream); // SSE, token in ?token=
router.get("/therapist-notifications", isTherapist, listNotifications);
router.post("/therapist-notifications/read", isTherapist, readNotifications);

export default router;
