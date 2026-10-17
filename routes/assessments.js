import express from "express";
import { isAuth, isAuthCommon, isTherapist, hasPermission, isSuperAdmin } from "../middlewares/authMiddleware.js";
import { saveAssessment, listAssessments } from "../controllers/AssessmentController.js";
import { myRequests, takeRequest, submitRequest, therapistRequests, reportRequest, releaseRequest, verifyReport, createSelfOrder, verifySelfPayment } from "../controllers/AssessmentRequestController.js";
import { myAddons, createAddonOrder, verifyAddonPayment, assessmentProviders, saveAddonDetails, saveAddonConsent, adminAddons, adminAddonAction } from "../controllers/TherapistAddonController.js";
import { publicPricing, adminPricing, saveAdminPricing } from "../controllers/AssessmentPricingController.js";

const router = express.Router();
// free self-checks (client history)
router.post("/assessments", isAuth, saveAssessment);
router.get("/assessments", isAuth, listAssessments);

// clinical assessments booked with a session
router.get("/assessment-pricing", publicPricing);
router.get("/assessment-providers", assessmentProviders);
router.get("/assessment-requests/mine", isAuth, myRequests);
router.get("/assessment-requests/therapist", isTherapist, therapistRequests);
router.get("/assessment-requests/:id/take", isAuth, takeRequest);
router.post("/assessment-requests/:id/submit", isAuth, submitRequest);
router.get("/assessment-requests/:id/report", isAuthCommon, reportRequest);
router.post("/assessment-requests/:id/release", isTherapist, releaseRequest);
router.get("/assessment-verify/:id", verifyReport);
// an assessment on its own (no psychologist): pay → take → automatic report
router.post("/assessment-self/order", isAuth, createSelfOrder);
router.post("/assessment-self/verify", isAuth, verifySelfPayment);

// therapist add-on (Clinical Assessments, yearly)
router.get("/therapist-addon", isTherapist, myAddons);
router.post("/therapist-addon/order", isTherapist, createAddonOrder);
router.post("/therapist-addon/verify", isTherapist, verifyAddonPayment);
router.post("/therapist-addon/details", isTherapist, saveAddonDetails);
router.post("/therapist-addon/consent", isTherapist, saveAddonConsent);

// admin: prices and offers
router.get("/admin/assessment-pricing", hasPermission("therapists"), adminPricing);
router.put("/admin/assessment-pricing", isSuperAdmin, saveAdminPricing);
router.get("/admin/assessment-addons", hasPermission("therapists"), adminAddons);
router.post("/admin/assessment-addons/:userId", hasPermission("therapists"), adminAddonAction);
export default router;
