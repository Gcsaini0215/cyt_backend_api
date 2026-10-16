import express from "express";
import { isAuth, isTherapist } from "../middlewares/authMiddleware.js";
import { saveAssessment, listAssessments } from "../controllers/AssessmentController.js";
import { myLicences, saveLicence, removeLicence, licensedTherapists } from "../controllers/TherapistLicenceController.js";

const router = express.Router();
router.post("/assessments", isAuth, saveAssessment);
router.get("/assessments", isAuth, listAssessments);

// licences for copyrighted questionnaires
router.get("/assessment-licences/public", licensedTherapists);
router.get("/assessment-licences/mine", isTherapist, myLicences);
router.post("/assessment-licences", isTherapist, saveLicence);
router.delete("/assessment-licences/:tool", isTherapist, removeLicence);
export default router;
