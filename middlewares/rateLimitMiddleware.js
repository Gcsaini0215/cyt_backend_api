import rateLimit from "express-rate-limit";

export const leadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 500 requests per windowMs
  message: {
    status: false,
    message: "Too many lead submissions from this IP, please try again after 15 minutes.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Bot / abuse protection for the OTP login flow. Keyed by client IP
// (app has `trust proxy` set, so this is the real client, not nginx).
// Per-user limits (otp_count, 30s throttle) still apply on top of these.
export const loginOtpRequestRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 8, // 8 OTP-send requests per IP per minute
  message: {
    status: false,
    message: "Too many login attempts. Please wait a minute and try again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const otpVerifyRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15, // 15 OTP verification attempts per IP per 10 minutes
  message: {
    status: false,
    message: "Too many OTP attempts. Please wait a few minutes and try again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});