import { Router } from "express";
import {
  bookTherapist,
  createRazorpayOrder,
  EndSession,
  generatePaymentQR,
  getBookings,
  getBookingsForAdmin,
  saveTransactionId,
  startSession,
  verifyRazorpayPayment,
} from "../controllers/BookingController.js";
import { isAdmin, isAuth, isAuthCommon, isTherapist } from "../middlewares/authMiddleware.js";
const router = Router();

router.post("/book-therapist", bookTherapist);

router.get("/get-payment/:id", generatePaymentQR);

router.get("/get-bookings", isAuthCommon, getBookings);

router.get("/get-booking-admin", isAdmin, getBookingsForAdmin);

router.post("/save-payment", saveTransactionId);

router.post("/create-razorpay-order", createRazorpayOrder);

router.post("/verify-razorpay-payment", verifyRazorpayPayment);

router.post("/start-session",isTherapist, startSession);

router.post("/end-session",isTherapist, EndSession);

export default router;
