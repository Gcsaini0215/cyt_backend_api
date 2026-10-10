import { Router } from "express";
import {
  getCollabMeta, submitCollabApplication, sendCollabEmailOtp, verifyCollabEmailOtp, getCollabApplications, updateCollabApplication, sendCollabHours, deleteCollabApplication,
  getCollabRoom, setCollabRoomSlot,
} from "../controllers/CollabController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";
import { collabApplyRateLimit, collabOtpRateLimit, otpVerifyRateLimit } from "../middlewares/rateLimitMiddleware.js";

const router = Router();

// public: /collaborate-noida page
router.get("/collab-applications/meta", getCollabMeta);
router.post("/collab-applications/email-otp", collabOtpRateLimit, sendCollabEmailOtp);
router.post("/collab-applications/email-otp/verify", otpVerifyRateLimit, verifyCollabEmailOtp);
router.post("/collab-applications", collabApplyRateLimit, submitCollabApplication);

// admin: screening + the single room's weekly timetable
router.get("/collab-applications", hasPermission("noidaCenter"), getCollabApplications);
router.patch("/collab-applications/:id", hasPermission("noidaCenter"), updateCollabApplication);
router.post("/collab-applications/:id/send-hours", hasPermission("noidaCenter"), sendCollabHours);
router.delete("/collab-applications/:id", hasPermission("noidaCenter"), deleteCollabApplication);
router.get("/collab-room", hasPermission("noidaCenter"), getCollabRoom);
router.put("/collab-room/slot", hasPermission("noidaCenter"), setCollabRoomSlot);

export default router;
