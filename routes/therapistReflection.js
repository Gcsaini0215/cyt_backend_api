import express from "express";
import { isTherapist } from "../middlewares/authMiddleware.js";
import { listReflections, addReflection, deleteReflection } from "../controllers/TherapistReflectionController.js";

// Therapist's private reflection journal (controllers/TherapistReflectionController.js)
const router = express.Router();
router.get("/therapist-reflections", isTherapist, listReflections);
router.post("/therapist-reflections", isTherapist, addReflection);
router.delete("/therapist-reflections/:id", isTherapist, deleteReflection);
export default router;
