import express from "express";
import { createTrainee, getTraineeBySlug } from "../controllers/traineeController.js";
import { leadRateLimit } from "../middlewares/rateLimitMiddleware.js";

const router = express.Router();

router.post("/trainees", leadRateLimit, createTrainee);
router.get("/trainees/:slug", getTraineeBySlug);

export default router;
