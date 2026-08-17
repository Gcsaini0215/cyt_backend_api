import express from "express";
import {
  createTrainee, getTraineeBySlug,
  getAllTrainees, updateTraineeStatus, deleteTrainee,
} from "../controllers/traineeController.js";
import { leadRateLimit } from "../middlewares/rateLimitMiddleware.js";
import { isAdmin } from "../middlewares/authMiddleware.js";
import { uploadTherapistDocuments } from "../services/fileUpload.js";

const router = express.Router();

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
router.get("/admin/trainees", isAdmin, getAllTrainees);
router.patch("/admin/trainees/:id/status", isAdmin, updateTraineeStatus);
router.delete("/admin/trainees/:id", isAdmin, deleteTrainee);
router.get("/trainees/:slug", getTraineeBySlug);

export default router;
