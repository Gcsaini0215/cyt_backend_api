import { Router } from "express";
import { ApplyCoupon, CreateCoupan, DeleteCoupon, GetCoupan, GetCoupans, PublicCoupons, SuggestCoupon, ToggleSatus, UpdateCoupan } from "../controllers/CoupanController.js";
import { isTherapist } from "../middlewares/authMiddleware.js";
import { leadRateLimit } from "../middlewares/rateLimitMiddleware.js";

const router = Router();

router.post("/create", isTherapist, CreateCoupan);

router.get("/get", isTherapist, GetCoupans);

router.get("/get/:id", isTherapist, GetCoupan);

router.post("/update/:id", isTherapist, UpdateCoupan);

router.get("/status/:id", isTherapist, ToggleSatus);

router.delete("/delete/:id", isTherapist, DeleteCoupon);

router.get("/suggest", isTherapist, SuggestCoupon);

// public: the therapist's live offers (profile pop-up + booking page)
router.get("/public/:therapistId", PublicCoupons);

router.post("/apply", leadRateLimit, ApplyCoupon);

export default router;
