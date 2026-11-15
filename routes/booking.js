import { Router } from "express";
import {
  bookTherapist,
  cancelBooking,
  checkRazorpayStatus,
  createRazorpayOrder,
  deleteBooking,
  EndSession,
  startSessionNow,
  joinSession,
  rescheduleSession,
  adminRescheduleSession,
  getBookedSlots,
  releaseBookingSlot,
  getBookingPayInfo,
  getMyPendingBookings,
  getBookings,
  getBookingsForAdmin,
  startSession,
  sendSessionStartCode,
  verifyRazorpayPayment,
} from "../controllers/BookingController.js";
import { isAuthCommon, isTherapist, hasPermission } from "../middlewares/authMiddleware.js";
import { sendGuestEmailOtp, verifyGuestEmailOtp } from "../controllers/GuestOtpController.js";
import { loginOtpRequestRateLimit, otpVerifyRateLimit } from "../middlewares/rateLimitMiddleware.js";
const router = Router();

router.post("/book-therapist", bookTherapist);

router.post("/send-guest-email-otp", loginOtpRequestRateLimit, sendGuestEmailOtp);

router.post("/verify-guest-email-otp", otpVerifyRateLimit, verifyGuestEmailOtp);

// manual UPI (QR + typed transaction ID) removed 2026-11-15: therapy payments go through Razorpay only (audit P0-2)

router.get("/booked-slots/:therapistId", getBookedSlots);

router.post("/booking/:id/release-slot", releaseBookingSlot);

router.get("/booking/:id/pay-info", getBookingPayInfo);

router.get("/get-bookings", isAuthCommon, getBookings);

router.get("/my-pending-bookings", isAuthCommon, getMyPendingBookings);

router.get("/get-booking-admin", hasPermission(["bookings","bdm"]), getBookingsForAdmin);


router.post("/create-razorpay-order", createRazorpayOrder);

router.post("/verify-razorpay-payment", verifyRazorpayPayment);

router.post("/start-session",isTherapist, startSession);
router.post("/start-session/send-code", isTherapist, sendSessionStartCode);
router.post("/start-session-now", isTherapist, startSessionNow);
router.post("/bookings/:id/join", isAuthCommon, joinSession);
router.post("/bookings/:id/reschedule", isTherapist, rescheduleSession);
router.post("/admin/bookings/:id/reschedule", hasPermission("bookings"), adminRescheduleSession);

router.post("/end-session",isTherapist, EndSession);

router.get("/check-razorpay-status", checkRazorpayStatus);

router.delete("/delete-booking/:id", isAuthCommon, deleteBooking);

router.post("/cancel-booking/:id", hasPermission("bookings"), cancelBooking);

export default router;
