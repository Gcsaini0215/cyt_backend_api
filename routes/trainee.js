import express from "express";
import {
  createTrainee, createTraineeOrder, getTraineeBySlug,
  getAllTrainees, updateTraineeStatus, deleteTrainee,
  traineeLoginOtp, traineeVerifyOtp, traineeMe, traineeRegister, traineeRegisterVerify,
} from "../controllers/traineeController.js";
import { leadRateLimit } from "../middlewares/rateLimitMiddleware.js";
import { hasPermission } from "../middlewares/authMiddleware.js";
import { uploadTherapistDocuments } from "../services/fileUpload.js";

const router = express.Router();

router.post("/trainees/create-order", leadRateLimit, createTraineeOrder);
router.post(
  "/trainees",
  leadRateLimit,
  uploadTherapistDocuments.fields([
    { name: "resumeFile", maxCount: 1 },
    { name: "collegeId", maxCount: 1 },
    { name: "passportPhoto", maxCount: 1 },
  ]),
  createTrainee
);
router.get("/admin/trainees", hasPermission("probono"), getAllTrainees);
router.patch("/admin/trainees/:id/status", hasPermission("probono"), updateTraineeStatus);
router.delete("/admin/trainees/:id", hasPermission("probono"), deleteTrainee);
// trainee portal sign-in (before /trainees/:slug so "me" isn't read as a slug)
router.post("/trainees/login", leadRateLimit, traineeLoginOtp);
router.post("/trainees/verify-otp", leadRateLimit, traineeVerifyOtp);
router.get("/trainees/me", traineeMe);
router.post("/trainees/register", leadRateLimit, traineeRegister);
router.post("/trainees/register/verify", leadRateLimit, traineeRegisterVerify);
router.get("/trainees/:slug", getTraineeBySlug);

export default router;
