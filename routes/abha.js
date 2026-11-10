import express from "express";
import { isAuth } from "../middlewares/authMiddleware.js";
import { myAbha, requestOtp, verifyOtp, unlinkAbha } from "../controllers/AbhaController.js";

// Client "My ABHA" (ABDM M1). Clients only (isAuth = role 0).
const router = express.Router();

router.get("/abha/me", isAuth, myAbha);
router.post("/abha/otp", isAuth, requestOtp);
router.post("/abha/verify", isAuth, verifyOtp);
router.delete("/abha/me", isAuth, unlinkAbha);

export default router;
