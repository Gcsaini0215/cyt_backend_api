import express from "express";
import { isTherapist } from "../middlewares/authMiddleware.js";
import { googleStatus, googleConnect, googleCallback, googleDisconnect, googleTest } from "../controllers/GoogleController.js";

const router = express.Router();
router.get("/google/status", isTherapist, googleStatus);
router.get("/google/connect", isTherapist, googleConnect);
router.get("/google/callback", googleCallback);
router.post("/google/disconnect", isTherapist, googleDisconnect);
router.post("/google/test", isTherapist, googleTest);
export default router;
