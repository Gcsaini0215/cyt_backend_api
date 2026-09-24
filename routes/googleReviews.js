import { Router } from "express";
import { getGoogleReviews } from "../controllers/GoogleReviewsController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = Router();
router.get("/google-reviews", hasPermission("quotations"), getGoogleReviews);

export default router;
