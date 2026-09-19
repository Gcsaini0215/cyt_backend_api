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

// Pre-auth "is this you?" name lookup on the admin login screen. No OTP/
// captcha gates this yet, so it's the easiest endpoint to script against
// for email enumeration — keep it tight and separate from the OTP limiters.
export const nameByEmailRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 lookups per IP per 15 minutes
  message: {
    status: false,
    message: "Too many requests. Please wait a few minutes and try again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Same idea, for the Noida follow-up phone lookup on the public site.
export const phoneLookupRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // 15 lookups per IP per 15 minutes
  message: {
    status: false,
    message: "Too many requests. Please wait a few minutes and try again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// The public last-minute-request waiting screen polls this every few
// seconds for up to 10 minutes — needs a much looser cap than a one-shot
// lookup, but still bounded per IP.
export const pollingRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 150, // ~1 poll every 2s for the full window
  message: {
    status: false,
    message: "Too many requests. Please wait a moment and try again.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});