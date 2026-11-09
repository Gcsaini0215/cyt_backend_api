import express from "express";
import { isTherapist, hasPermission } from "../middlewares/authMiddleware.js";
import { postProfileEvent, postImpressions, myProfileInsights, adminProfileStats, postPresence, myLiveViewers, profileLinkQr } from "../controllers/ProfileStatController.js";

const router = express.Router();

// public — sent by the site (profile page, directory); bots and a therapist viewing their own profile aren't counted
router.post("/profile-stats/event", postProfileEvent);
router.post("/profile-stats/impressions", postImpressions);
router.post("/profile-stats/presence", postPresence);
// QR code PNG for a therapist's own booking link (only chooseyourtherapist.in/t/... links)
router.get("/profile-link/qr", profileLinkQr);

// therapist dashboard
router.get("/profile-stats/me", isTherapist, myProfileInsights);
router.get("/profile-stats/live", isTherapist, myLiveViewers);

// admin Therapists page
router.get("/admin/profile-stats", hasPermission("therapists"), adminProfileStats);

export default router;
