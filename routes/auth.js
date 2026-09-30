import { Router } from "express";
import { saveVerificationChecklist, rejectTherapistApplication, requestTherapistReupload, getReuploadRequest, submitReupload, sendPaymentLink, listProfileGaps, requestProfileCompletion, notifyProfileGaps, markRechecked, getCompletionRequest, submitCompletion } from "../controllers/TherapistVerificationController.js";
import { isSuperAdmin, hasPermission } from "../middlewares/authMiddleware.js";
import {
  leadRateLimit,
  loginOtpRequestRateLimit,
  otpVerifyRateLimit,
  nameByEmailRateLimit,
} from "../middlewares/rateLimitMiddleware.js";
import {
  aproveTherapist,
  login,
  register,
  sendForgotPasswordOtp,
  therapistRegister,
  checkTherapistEmail,
  checkTherapistStatus,
  verifyTherapistSubscriptionPayment,
  resendTherapistOtp,
  verifyOtp,
  sendAproveMail,
  adminLogin,
  adminRegister,
  sendOtpToMail,
  verifyOtpAndResetPassword,
  getAdminNameByEmail,
} from "../controllers/AuthController.js";
import { uploadTherapistDocuments, uploadTherapistCompletion } from "../services/fileUpload.js";

const router = Router();

router.get("/test", (req, res, next) => {
  res.status(201).json({
    status: true,
    message: "test api",
    data: {
      name: "Gopichand",
      email: "gcsaini0215@gmail.com",
      phone: "8755512976",
    },
  });
});

router.post("/register", register);

router.post("/send-otp-to-mail", sendOtpToMail);

router.post("/check-therapist-email", checkTherapistEmail);
router.post("/check-therapist-status", leadRateLimit, checkTherapistStatus);
router.post("/verify-therapist-subscription", leadRateLimit, verifyTherapistSubscriptionPayment);
router.post("/resend-therapist-otp", resendTherapistOtp);

router.post(
  "/therapist-registeration",
  uploadTherapistDocuments.fields([
    { name: "resume", maxCount: 1 },
    { name: "qualification_certificate", maxCount: 1 },
    { name: "id_card", maxCount: 1 },
  ]),
  therapistRegister
);

router.get("/aprove-therapist/:userId",hasPermission("therapists"), aproveTherapist);

// Admin review of applications + the therapist's one-time re-upload link
router.patch("/therapist-verification/:id/checklist", hasPermission("therapists"), saveVerificationChecklist);
router.post("/therapist-verification/:id/reject", hasPermission("therapists"), rejectTherapistApplication);
router.post("/therapist-verification/:id/reupload", hasPermission("therapists"), requestTherapistReupload);
router.post("/therapist-verification/:id/payment-link", hasPermission("therapists"), sendPaymentLink);
router.post("/therapist-verification/:id/complete-profile", hasPermission("therapists"), requestProfileCompletion);
router.patch("/therapist-verification/:id/rechecked", hasPermission("therapists"), markRechecked);
router.get("/therapist-profile-gaps", hasPermission("therapists"), listProfileGaps);
router.post("/therapist-profile-gaps/notify", hasPermission("therapists"), notifyProfileGaps);
router.get("/therapist-complete/:token", leadRateLimit, getCompletionRequest);
router.post(
  "/therapist-complete/:token",
  leadRateLimit,
  uploadTherapistCompletion.fields([
    { name: "photo", maxCount: 1 },
    { name: "resume", maxCount: 1 },
    { name: "qualification_certificate", maxCount: 1 },
    { name: "id_card", maxCount: 1 },
  ]),
  submitCompletion
);
router.get("/therapist-reupload/:token", leadRateLimit, getReuploadRequest);
router.post(
  "/therapist-reupload/:token",
  leadRateLimit,
  uploadTherapistDocuments.fields([
    { name: "resume", maxCount: 1 },
    { name: "qualification_certificate", maxCount: 1 },
    { name: "id_card", maxCount: 1 },
  ]),
  submitReupload
);

router.get("/send-aprove-mail/:userId", sendAproveMail); 

router.post("/login", leadRateLimit, loginOtpRequestRateLimit, login);

router.post("/get-admin-name-by-email", nameByEmailRateLimit, getAdminNameByEmail);

router.post("/admin-login", adminLogin);

router.post("/admin-register", isSuperAdmin, adminRegister);

router.post("/send-forgot-password-otp", sendForgotPasswordOtp);

router.post("/verify-otp", otpVerifyRateLimit, verifyOtp);

router.post("/verify-otp-and-reset-password", verifyOtpAndResetPassword);


export default router;
