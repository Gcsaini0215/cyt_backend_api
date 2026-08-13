import mongoose from "mongoose";
const { model, Schema } = mongoose;

const ProbonoInternSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, default: "" },
    photo: { type: String, default: "" },
    intro: { type: String, default: "" },
    bio: { type: String, default: "" },
    concerns: { type: [String], default: [] },
    availableDays: { type: [String], default: [] },
    roleLabel: { type: String, default: "Trainee Psychologist" },
    rating: { type: Number, default: 5 },
    requestsSent: { type: Number, default: 0 },
    connected: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default model("ProbonoIntern", ProbonoInternSchema);
