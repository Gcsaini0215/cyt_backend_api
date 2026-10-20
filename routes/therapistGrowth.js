import express from "express";
import { isTherapist } from "../middlewares/authMiddleware.js";
import { myGrowth, setGoal, emailFollowup, markNudged } from "../controllers/TherapistGrowthController.js";

const router = express.Router();

// therapist dashboard: follow-ups, earnings goal, Top-therapist badge, booking demand
router.get("/therapist-growth/me", isTherapist, myGrowth);
router.put("/therapist-growth/goal", isTherapist, setGoal);
router.post("/therapist-growth/followups/:clientId/email", isTherapist, emailFollowup);
router.post("/therapist-growth/followups/:clientId/nudged", isTherapist, markNudged);

export default router;
