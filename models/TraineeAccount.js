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
    verified: { type: Boolean, default: false }, // email confirmed with the code
    // the CYT team approves new accounts before they can sign in
    approval: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: "" },
    // profile the trainee edits in the portal
    photo: { type: String, default: "" }, // file name in uploads/images
    gender: { type: String, default: "" },
    dob: { type: String, default: "" },
    city: { type: String, default: "" },
    college: { type: String, default: "" },
    course: { type: String, default: "" },
    year: { type: String, default: "" },
    bio: { type: String, default: "" },
    linkedin: { type: String, default: "" },
    login_otp: { type: String, default: "", select: false },
    login_otp_at: { type: Date, default: null },
    login_otp_tries: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default model("TraineeAccount", TraineeAccountSchema);
