import { Router } from "express";
import {
  bookTherapist,
  checkRazorpayStatus,
  createRazorpayOrder,
  deleteBooking,
  EndSession,
  generatePaymentQR,
  getBookings,
  getBookingsForAdmin,
  saveTransactionId,
  startSession,
  verifyRazorpayPayment,
} from "../controllers/BookingController.js";
import { isAdmin, isAuth, isAuthCommon, isTherapist } from "../middlewares/authMiddleware.js";
import { sendGuestEmailOtp, verifyGuestEmailOtp } from "../controllers/GuestOtpController.js";
const router = Router();

router.post("/book-therapist", bookTherapist);

router.post("/send-guest-email-otp", sendGuestEmailOtp);

router.post("/verify-guest-email-otp", verifyGuestEmailOtp);

router.get("/get-payment/:id", generatePaymentQR);

router.get("/get-bookings", isAuthCommon, getBookings);

router.get("/get-booking-admin", isAdmin, getBookingsForAdmin);

router.post("/save-payment", saveTransactionId);

router.post("/create-razorpay-order", createRazorpayOrder);

router.post("/verify-razorpay-payment", verifyRazorpayPayment);

router.post("/start-session",isTherapist, startSession);

router.post("/end-session",isTherapist, EndSession);

router.get("/check-razorpay-status", checkRazorpayStatus);

router.delete("/delete-booking/:id", isAuthCommon, deleteBooking);

export default router;
