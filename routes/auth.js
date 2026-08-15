import { Router } from "express";
import { isAdmin, isAuth, isTherapist } from "../middlewares/authMiddleware.js";
import { leadRateLimit } from "../middlewares/rateLimitMiddleware.js";
import {
  aproveTherapist,
  login,
  register,
  sendForgotPasswordOtp,
  therapistRegister,
  checkTherapistEmail,
  checkTherapistStatus,
  resendTherapistOtp,
  verifyOtp,
  sendAproveMail,
  adminLogin,
  adminRegister,
  sendOtpToMail,
  verifyOtpAndResetPassword,
} from "../controllers/AuthController.js";
import { uploadTherapistDocuments } from "../services/fileUpload.js";

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

router.get("/aprove-therapist/:userId",isAdmin, aproveTherapist);

router.get("/send-aprove-mail/:userId", sendAproveMail); 

router.post("/login", leadRateLimit, login);

router.post("/admin-login", adminLogin);

router.post("/admin-register", isAdmin, adminRegister);

router.post("/send-forgot-password-otp", sendForgotPasswordOtp);

router.post("/verify-otp", verifyOtp);

router.post("/verify-otp-and-reset-password", verifyOtpAndResetPassword);


export default router;
