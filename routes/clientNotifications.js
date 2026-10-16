import express from "express";
import { isAuth } from "../middlewares/authMiddleware.js";
import { listClientNotifications, readClientNotifications, clientNotificationStream } from "../controllers/ClientNotificationController.js";

const router = express.Router();

router.get("/client-notifications/stream", clientNotificationStream); // SSE, token in ?token=
router.get("/client-notifications", isAuth, listClientNotifications);
router.post("/client-notifications/read", isAuth, readClientNotifications);

export default router;
