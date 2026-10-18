import { Router } from "express";
import { ApplyCoupon, CreateCoupan, DeleteCoupon, GetCoupan, GetCoupans, PublicCoupons, SuggestCoupon, ToggleSatus, UpdateCoupan } from "../controllers/CoupanController.js";
import { isTherapist, hasPermission, isSuperAdmin } from "../middlewares/authMiddleware.js";
import { myCouponsAddon, createCouponsOrder, verifyCouponsPayment, adminCouponsAddon, adminCouponsAction, adminCouponsPrice } from "../controllers/CouponAddonController.js";
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

// Coupons upgrade (one-time): the therapist's status + Razorpay payment
router.get("/addon", isTherapist, myCouponsAddon);
router.post("/addon/order", isTherapist, createCouponsOrder);
router.post("/addon/verify", isTherapist, verifyCouponsPayment);

// admin: who has it, unlock free / turn off, and the price (Super Admin)
router.get("/admin/addon", hasPermission("therapists"), adminCouponsAddon);
router.post("/admin/addon/:userId", hasPermission("therapists"), adminCouponsAction);
router.put("/admin/addon-price", isSuperAdmin, adminCouponsPrice);

export default router;
