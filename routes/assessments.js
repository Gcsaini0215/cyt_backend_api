import express from "express";
import { isAuth } from "../middlewares/authMiddleware.js";
import { saveAssessment, listAssessments } from "../controllers/AssessmentController.js";

const router = express.Router();
router.post("/assessments", isAuth, saveAssessment);
router.get("/assessments", isAuth, listAssessments);
export default router;
