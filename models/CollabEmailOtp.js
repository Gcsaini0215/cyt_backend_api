import mongoose from "mongoose";
const { Schema } = mongoose;

/* Email verification for the public /collaborate-noida form, so applications can't be spammed
   with made-up addresses. Codes and tokens are stored hashed; a doc lives at most a day. */
const collabEmailOtpSchema = new Schema({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  codeHash:     { type: String, default: "" },
  codeExpires:  { type: Date, default: null },
  attempts:     { type: Number, default: 0 },     // wrong guesses on the current code
  sentCount:    { type: Number, default: 0 },     // codes sent in the current hour window
  windowStart:  { type: Date, default: Date.now },
  lastSentAt:   { type: Date, default: null },
  tokenHash:    { type: String, default: "" },    // proof of verification, sent with the application
  tokenExpires: { type: Date, default: null },
  purgeAt:      { type: Date, default: () => new Date(Date.now() + 24 * 3600 * 1000) },
});

collabEmailOtpSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("CollabEmailOtp", collabEmailOtpSchema);
