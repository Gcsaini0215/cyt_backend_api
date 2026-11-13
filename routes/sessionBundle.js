import express from "express";
import { myBundles, packOptions, adminBundles, extendBundle, adminPackPricing, savePackPricing } from "../controllers/SessionBundleController.js";
import { myMoods, saveMood } from "../controllers/MoodController.js";
import { myCycle, saveCycleProfile, saveCycleLog, deleteMyCycle } from "../controllers/CycleController.js";
import { getMyNote, saveMyNote } from "../controllers/SessionNoteController.js";
import { isAuth, isAuthCommon, hasPermission, isSuperAdmin } from "../middlewares/authMiddleware.js";

const router = express.Router();
// session packs (helper/sessionBundle.js)
router.get("/session-packs", packOptions);
router.get("/my-bundles", isAuth, myBundles);
router.get("/admin/session-packs", hasPermission(["bookings", "clients"]), adminBundles);
router.post("/admin/session-packs/:id/extend", hasPermission("bookings"), extendBundle);
router.get("/admin/pack-pricing", hasPermission(["bookings", "clients"]), adminPackPricing);
router.put("/admin/pack-pricing", isSuperAdmin, savePackPricing);
// My Space mood check-in
router.get("/my-moods", isAuthCommon, myMoods);
router.post("/my-moods", isAuthCommon, saveMood);
// Cycle & Mood Care (private period + mood tracker)
router.get("/my-cycle", isAuthCommon, myCycle);
router.put("/my-cycle/profile", isAuthCommon, saveCycleProfile);
router.put("/my-cycle/log", isAuthCommon, saveCycleLog);
router.delete("/my-cycle", isAuthCommon, deleteMyCycle);
// the client's private notes for a session
router.get("/my-session-notes/:bookingId", isAuth, getMyNote);
router.put("/my-session-notes/:bookingId", isAuth, saveMyNote);
export default router;
