import express from "express";
import { myBundles, packOptions, adminBundles, extendBundle } from "../controllers/SessionBundleController.js";
import { myMoods, saveMood } from "../controllers/MoodController.js";
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
export default router;
