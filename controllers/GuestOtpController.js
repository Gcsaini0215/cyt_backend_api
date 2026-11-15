import crypto from "crypto";
import expressAsyncHandler from "express-async-handler";
import Otp from "../models/Otp.js";
import { generate6DigitOTP } from "../helper/generate.js";
import { sendMail } from "../helper/mailer.js";
import { otpVerificationEmail } from "../services/mailTemplates.js";

const OTP_TTL_MINUTES = 10;
const MAX_WRONG_TRIES = 5;          // per code — then a new code has to be sent
const PROOF_TTL_MS = 60 * 60 * 1000; // a verified guest email stays good for booking for 1 hour

// ── Signed proof that this browser really verified this email (2026-11-15 audit) ──
// /book-therapist used to trust a client-sent `guest_email_verified: true`, so anyone could
// book (and, after paying, get logged in) as any existing client just by typing their email.
// Now verifyGuestEmailOtp hands back a short-lived HMAC proof and bookTherapist checks it.
const proofSecret = () => `${process.env.JWT_SECRET || ""}|guest-email`;
const proofSig = (email, exp) => crypto.createHmac("sha256", proofSecret()).update(`${email}|${exp}`).digest("base64url");

export const makeGuestEmailProof = (email) => {
  const exp = Date.now() + PROOF_TTL_MS;
  return `${exp}.${proofSig(String(email).trim().toLowerCase(), exp)}`;
};

export const checkGuestEmailProof = (email, proof) => {
  const [exp, sig] = String(proof || "").split(".");
  if (!sig || !(Number(exp) > Date.now())) return false;
  const want = Buffer.from(proofSig(String(email || "").trim().toLowerCase(), exp));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};

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
  // a fresh code starts with a fresh wrong-try count
  await Otp.collection.updateOne({ email: normalizedEmail }, { $set: { wrong_tries: 0 } });

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
  const record = await Otp.collection.findOne({ email: normalizedEmail });

  if (!record) {
    return res.status(400).json({ status: false, message: "Invalid verification code" });
  }

  const ageMinutes = (Date.now() - new Date(record.otp_count).getTime()) / 60000;
  if (ageMinutes > OTP_TTL_MINUTES) {
    return res.status(400).json({ status: false, message: "Verification code expired" });
  }

  if (String(record.otp) !== String(otp)) {
    // stop guessing: after MAX_WRONG_TRIES wrong codes this one is burnt and a new one must be sent
    const tries = (record.wrong_tries || 0) + 1;
    if (tries >= MAX_WRONG_TRIES) {
      await Otp.deleteOne({ _id: record._id });
      return res.status(400).json({ status: false, message: "Too many wrong codes. Please request a new code." });
    }
    await Otp.collection.updateOne({ _id: record._id }, { $set: { wrong_tries: tries } });
    return res.status(400).json({ status: false, message: "Invalid verification code" });
  }

  await Otp.deleteOne({ _id: record._id });
  res.status(200).json({ status: true, message: "Email verified", proof: makeGuestEmailProof(normalizedEmail) });
});
