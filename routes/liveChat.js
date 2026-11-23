import { Router } from "express";
import { isAuthCommon, hasPermission } from "../middlewares/authMiddleware.js";
import {
  getConsent, giveConsent, listThreads, unreadCount, startThread, getThread, sendMessage, markRead, deleteMessage,
  getSettings, saveSettings, therapistChatInfo, stream, adminThreads, adminThread, adminStats, adminAccessLog, ADMIN_PERM,
} from "../controllers/LiveChatController.js";

// Live therapist ↔ client chat (2026-11-23). The older routes/chat.js is separate and untouched.
const router = Router();

router.get("/live-chat/stream", stream);
router.get("/live-chat/therapist/:therapistId", therapistChatInfo);
router.get("/live-chat/consent", isAuthCommon, getConsent);
router.post("/live-chat/consent", isAuthCommon, giveConsent);
router.get("/live-chat/threads", isAuthCommon, listThreads);
router.get("/live-chat/unread", isAuthCommon, unreadCount);
router.post("/live-chat/start", isAuthCommon, startThread);
router.get("/live-chat/threads/:id", isAuthCommon, getThread);
router.post("/live-chat/threads/:id/messages", isAuthCommon, sendMessage);
router.post("/live-chat/threads/:id/read", isAuthCommon, markRead);
router.delete("/live-chat/messages/:id", isAuthCommon, deleteMessage);
router.get("/live-chat/settings", isAuthCommon, getSettings);
router.put("/live-chat/settings", isAuthCommon, saveSettings);

// admin: the complete record (page:/chat-monitor on the admin's role, or super admin)
router.get("/admin/live-chat/threads", hasPermission(ADMIN_PERM), adminThreads);
router.get("/admin/live-chat/threads/:id", hasPermission(ADMIN_PERM), adminThread);
router.get("/admin/live-chat/stats", hasPermission(ADMIN_PERM), adminStats);
router.get("/admin/live-chat/access-log", hasPermission(ADMIN_PERM), adminAccessLog);

export default router;
