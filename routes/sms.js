import { Router } from "express";

const router = Router();

// POST /send-otp was removed (2026-11-15 audit P0-4): it sent an SMS through AWS SNS with no
// login and no rate limit, never stored the code, and nothing called it. Login/booking OTPs
// live in auth.js and GuestOtpController.

export default router;
