import mongoose from "mongoose";
const { model, Schema } = mongoose;

const TraineeSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    city: { type: String, default: "" },
    college: { type: String, default: "" },
    degree: { type: String, default: "" },
    specialization: { type: String, default: "" },
    internType: { type: [String], default: [] },
    mode: { type: String, default: "" },
    duration: { type: String, default: "" },
    hours: { type: String, default: "" },
    programFee: { type: Number, default: null },
    transactionId: { type: String, default: "" },
    availableFrom: { type: String, default: "" },
    motivation: { type: String, default: "" },
    status: { type: String, enum: ["pending", "active", "completed", "rejected"], default: "pending" },
  },
  { timestamps: true }
);

export default model("Trainee", TraineeSchema);
