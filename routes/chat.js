import { Router } from "express";
import { isAuth } from "../middlewares/authMiddleware.js";
import { getMessages, sendMessage, getUnreadCount } from "../controllers/ChatController.js";

const router = Router();

router.get("/chat/messages",      isAuth, getMessages);
router.post("/chat/send",         isAuth, sendMessage);
router.get("/chat/unread-count",  isAuth, getUnreadCount);

export default router;
