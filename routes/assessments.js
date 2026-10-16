import express from "express";
import { isAuth, isTherapist } from "../middlewares/authMiddleware.js";
import { saveAssessment, listAssessments } from "../controllers/AssessmentController.js";
import { myLicences, saveLicence, removeLicence, licensedTherapists } from "../controllers/TherapistLicenceController.js";
import { requestAssessment, myRequests, markDone, therapistRequests, therapistUpcoming, sendForBooking, saveScore, releaseScore } from "../controllers/AssessmentRequestController.js";

const router = express.Router();
router.post("/assessments", isAuth, saveAssessment);
router.get("/assessments", isAuth, listAssessments);

// licences for copyrighted questionnaires
router.get("/assessment-licences/public", licensedTherapists);
router.get("/assessment-licences/mine", isTherapist, myLicences);
router.post("/assessment-licences", isTherapist, saveLicence);
router.delete("/assessment-licences/:tool", isTherapist, removeLicence);

// licensed questionnaires taken before a session
router.post("/assessment-requests/intent", isAuth, requestAssessment);
router.get("/assessment-requests/mine", isAuth, myRequests);
router.post("/assessment-requests/:id/done", isAuth, markDone);
router.get("/assessment-requests/therapist", isTherapist, therapistRequests);
router.get("/assessment-requests/therapist/bookings", isTherapist, therapistUpcoming);
router.post("/assessment-requests/send", isTherapist, sendForBooking);
router.post("/assessment-requests/:id/score", isTherapist, saveScore);
router.post("/assessment-requests/:id/release", isTherapist, releaseScore);
export default router;
