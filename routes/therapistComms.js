import express from "express";
import { isTherapist, hasPermission } from "../middlewares/authMiddleware.js";
import {
  getInbox, readAnnouncement, completeAction, myPayouts, getPrefs, savePrefs, sendFeedback, myFeedback,
  adminTherapistOptions, adminListAnnouncements, adminCreateAnnouncement, adminDeleteAnnouncement, adminAnnouncementReads,
  adminListActions, adminCreateActions, adminUpdateAction,
  adminListPayouts, adminCreatePayout, adminUpdatePayout, adminDeletePayout,
  adminListFeedback, adminReplyFeedback, adminCommsSummary,
} from "../controllers/TherapistCommsController.js";

const router = express.Router();
const admin = hasPermission("therapists");

// therapist portal
router.get("/therapist-comms/inbox", isTherapist, getInbox);
router.post("/therapist-comms/announcements/:id/read", isTherapist, readAnnouncement);
router.post("/therapist-comms/actions/:id/done", isTherapist, completeAction);
router.get("/therapist-comms/payouts", isTherapist, myPayouts);
router.get("/therapist-comms/prefs", isTherapist, getPrefs);
router.put("/therapist-comms/prefs", isTherapist, savePrefs);
router.get("/therapist-comms/feedback", isTherapist, myFeedback);
router.post("/therapist-comms/feedback", isTherapist, sendFeedback);

// admin panel
router.get("/admin/therapist-comms/summary", admin, adminCommsSummary);
router.get("/admin/therapist-comms/therapists", admin, adminTherapistOptions);
router.get("/admin/therapist-comms/announcements", admin, adminListAnnouncements);
router.post("/admin/therapist-comms/announcements", admin, adminCreateAnnouncement);
router.get("/admin/therapist-comms/announcements/:id/reads", admin, adminAnnouncementReads);
router.delete("/admin/therapist-comms/announcements/:id", admin, adminDeleteAnnouncement);
router.get("/admin/therapist-comms/actions", admin, adminListActions);
router.post("/admin/therapist-comms/actions", admin, adminCreateActions);
router.patch("/admin/therapist-comms/actions/:id", admin, adminUpdateAction);
router.get("/admin/therapist-comms/payouts", admin, adminListPayouts);
router.post("/admin/therapist-comms/payouts", admin, adminCreatePayout);
router.patch("/admin/therapist-comms/payouts/:id", admin, adminUpdatePayout);
router.delete("/admin/therapist-comms/payouts/:id", admin, adminDeletePayout);
router.get("/admin/therapist-comms/feedback", admin, adminListFeedback);
router.patch("/admin/therapist-comms/feedback/:id", admin, adminReplyFeedback);

export default router;
