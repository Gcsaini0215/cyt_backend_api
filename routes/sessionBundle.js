import express from "express";
import { myBundles, packOptions, adminBundles, extendBundle } from "../controllers/SessionBundleController.js";
import { myMoods, saveMood } from "../controllers/MoodController.js";
import { getMyNote, saveMyNote } from "../controllers/SessionNoteController.js";
import { isAuth, hasPermission } from "../middlewares/authMiddleware.js";

const router = express.Router();
// session packs (helper/sessionBundle.js)
router.get("/session-packs", packOptions);
router.get("/my-bundles", isAuth, myBundles);
router.get("/admin/session-packs", hasPermission(["bookings", "clients"]), adminBundles);
router.post("/admin/session-packs/:id/extend", hasPermission("bookings"), extendBundle);
// My Space mood check-in
router.get("/my-moods", isAuth, myMoods);
router.post("/my-moods", isAuth, saveMood);
// the client's private notes for a session
router.get("/my-session-notes/:bookingId", isAuth, getMyNote);
router.put("/my-session-notes/:bookingId", isAuth, saveMyNote);
export default router;
