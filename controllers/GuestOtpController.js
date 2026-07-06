import expressAsyncHandler from "express-async-handler";
import Otp from "../models/Otp.js";
import { generate6DigitOTP } from "../helper/generate.js";
import { sendMail } from "../helper/mailer.js";
import { otpVerificationEmail } from "../services/mailTemplates.js";

const OTP_TTL_MINUTES = 10;

export const sendGuestEmailOtp = expressAsyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.status(400).json({ status: false, message: "Valid email is required" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const otp = generate6DigitOTP();

  await Otp.findOneAndUpdate(
    { email: normalizedEmail },
    { email: normalizedEmail, otp, otp_count: new Date().toISOString() },
    { upsert: true }
  );

  const sent = await sendMail(
    normalizedEmail,
    "Your verification code — Choose Your Therapist",
    `Your verification code is ${otp}. It expires in ${OTP_TTL_MINUTES} minutes.`,
    otpVerificationEmail(otp),
    "Choose Your Therapist"
  );

  if (!sent) {
    return res.status(500).json({ status: false, message: "Failed to send verification email" });
  }

  res.status(200).json({ status: true, message: "Verification code sent" });
});

export const verifyGuestEmailOtp = expressAsyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ status: false, message: "Email and OTP are required" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const record = await Otp.findOne({ email: normalizedEmail });

  if (!record || String(record.otp) !== String(otp)) {
    return res.status(400).json({ status: false, message: "Invalid verification code" });
  }

  const ageMinutes = (Date.now() - new Date(record.otp_count).getTime()) / 60000;
  if (ageMinutes > OTP_TTL_MINUTES) {
    return res.status(400).json({ status: false, message: "Verification code expired" });
  }

  await Otp.deleteOne({ _id: record._id });
  res.status(200).json({ status: true, message: "Email verified" });
});
