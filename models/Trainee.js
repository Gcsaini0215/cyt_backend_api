import mongoose from "mongoose";
const { model, Schema } = mongoose;

const TraineeSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    city: { type: String, default: "" },
    gender: { type: String, default: "" },
    dob: { type: String, default: "" },
    college: { type: String, default: "" },
    degree: { type: String, default: "" },
    specialization: { type: String, default: "" },
    year: { type: String, default: "" },
    internType: { type: [String], default: [] },
    mode: { type: String, default: "" },
    duration: { type: String, default: "" },
    hours: { type: String, default: "" },
    programFee: { type: Number, default: null },
    transactionId: { type: String, default: "" },
    // "razorpay" = paid + signature-verified here; "upi-manual" = legacy self-reported UTR (unverified)
    paymentMethod: { type: String, default: "" },
    paymentStatus: { type: String, default: "" }, // "paid" | "unverified"
    razorpayOrderId: { type: String, default: "" },
    razorpayPaymentId: { type: String, default: "", index: true },
    availableFrom: { type: String, default: "" },
    motivation: { type: String, default: "" },
    resume: { type: String, default: "" },
    collegeId: { type: String, default: "" },
    passportPhoto: { type: String, default: "" },
    status: { type: String, enum: ["pending", "active", "completed", "rejected"], default: "pending" },
  },
  { timestamps: true }
);

export default model("Trainee", TraineeSchema);
