import { Router } from "express";
import { isAuth, isTherapist } from "../middlewares/authMiddleware.js";
import { getMessages, sendMessage, getUnreadCount, getConversations, getThreadAsTherapist, therapistSendMessage, deleteConversation } from "../controllers/ChatController.js";

const router = Router();

// User (client) side
router.get("/chat/messages",                isAuth,       getMessages);
router.post("/chat/send",                   isAuth,       sendMessage);
router.get("/chat/unread-count",            isAuth,       getUnreadCount);

// Therapist side
router.get("/chat/therapist/conversations", isTherapist,  getConversations);
router.get("/chat/therapist/messages",      isTherapist,  getThreadAsTherapist);
router.post("/chat/therapist/send",         isTherapist,  therapistSendMessage);
router.delete("/chat/therapist/conversation", isTherapist, deleteConversation);

export default router;
