import mongoose from "mongoose";
const { Schema, model } = mongoose;

/* A trainee-portal account made from "Create account" on /supervision-login — before (or without) an
   internship application. Signing in uses an email code; the application (Trainee) is linked by email. */
const TraineeAccountSchema = new Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, default: "", trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: "" },
    verified: { type: Boolean, default: false },
    login_otp: { type: String, default: "", select: false },
    login_otp_at: { type: Date, default: null },
    login_otp_tries: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default model("TraineeAccount", TraineeAccountSchema);
