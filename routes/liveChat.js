import { Router } from "express";
import { isAuthCommon, hasPermission } from "../middlewares/authMiddleware.js";
import {
  getConsent, giveConsent, listThreads, unreadCount, startThread, getThread, sendMessage, markRead, deleteMessage,
  getSettings, saveSettings, therapistChatInfo, pushSubscribe, supportThread, adminReply, adminTherapists, adminAssign, clearChat, adminClear, adminDelete, typing, adminTyping, adminPushSubscribe, adminClaim, adminStatus, adminAddNote, adminDeleteNote, adminCannedList, adminCannedSave, adminCannedDelete, adminContext, adminTeam, editMessage, reactMessage, bookingCard, searchThread, adminSearchThread, rateThread, stream, adminThreads, adminThread, adminStats, adminAccessLog, ADMIN_PERM,
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
router.post("/live-chat/support", isAuthCommon, supportThread);
router.get("/live-chat/threads/:id", isAuthCommon, getThread);
router.post("/live-chat/threads/:id/messages", isAuthCommon, sendMessage);
router.post("/live-chat/threads/:id/read", isAuthCommon, markRead);
router.post("/live-chat/threads/:id/typing", isAuthCommon, typing);
// Phase C (2026-11-25)
router.put("/live-chat/messages/:id", isAuthCommon, editMessage);
router.post("/live-chat/messages/:id/react", isAuthCommon, reactMessage);
router.post("/live-chat/threads/:id/booking-card", isAuthCommon, bookingCard);
router.get("/live-chat/threads/:id/search", isAuthCommon, searchThread);
router.post("/live-chat/threads/:id/rate", isAuthCommon, rateThread);
router.post("/live-chat/threads/:id/clear", isAuthCommon, clearChat);
router.delete("/live-chat/messages/:id", isAuthCommon, deleteMessage);
router.post("/live-chat/push-subscribe", isAuthCommon, pushSubscribe);
router.get("/live-chat/settings", isAuthCommon, getSettings);
router.put("/live-chat/settings", isAuthCommon, saveSettings);

// admin: the complete record (page:/chat-monitor on the admin's role, or super admin)
router.get("/admin/live-chat/threads", hasPermission(ADMIN_PERM), adminThreads);
router.get("/admin/live-chat/threads/:id", hasPermission(ADMIN_PERM), adminThread);
router.get("/admin/live-chat/stats", hasPermission(ADMIN_PERM), adminStats);
router.get("/admin/live-chat/access-log", hasPermission(ADMIN_PERM), adminAccessLog);
router.post("/admin/live-chat/threads/:id/messages", hasPermission(ADMIN_PERM), adminReply);
router.post("/admin/live-chat/threads/:id/assign", hasPermission(ADMIN_PERM), adminAssign);
router.get("/admin/live-chat/therapists", hasPermission(ADMIN_PERM), adminTherapists);
router.post("/admin/live-chat/threads/:id/clear", hasPermission(ADMIN_PERM), adminClear);
router.post("/admin/live-chat/threads/:id/delete", hasPermission(ADMIN_PERM), adminDelete);
router.post("/admin/live-chat/threads/:id/typing", hasPermission(ADMIN_PERM), adminTyping);
router.post("/admin/live-chat/push-subscribe", hasPermission(ADMIN_PERM), adminPushSubscribe);
// Phase B (2026-11-25): team tools
router.post("/admin/live-chat/threads/:id/claim", hasPermission(ADMIN_PERM), adminClaim);
router.post("/admin/live-chat/threads/:id/status", hasPermission(ADMIN_PERM), adminStatus);
router.post("/admin/live-chat/threads/:id/notes", hasPermission(ADMIN_PERM), adminAddNote);
router.delete("/admin/live-chat/notes/:id", hasPermission(ADMIN_PERM), adminDeleteNote);
router.get("/admin/live-chat/threads/:id/context", hasPermission(ADMIN_PERM), adminContext);
router.get("/admin/live-chat/canned", hasPermission(ADMIN_PERM), adminCannedList);
router.post("/admin/live-chat/canned", hasPermission(ADMIN_PERM), adminCannedSave);
router.put("/admin/live-chat/canned/:id", hasPermission(ADMIN_PERM), adminCannedSave);
router.delete("/admin/live-chat/canned/:id", hasPermission(ADMIN_PERM), adminCannedDelete);
router.get("/admin/live-chat/team", hasPermission(ADMIN_PERM), adminTeam);
router.get("/admin/live-chat/threads/:id/search", hasPermission(ADMIN_PERM), adminSearchThread);

export default router;
