import mongoose from "mongoose";
const { Schema } = mongoose;

// Internship settings the CYT team controls from the admin (single document, key "main").
// offTracks: tracks switched off — hidden from the application form and the trainee portal plan chooser.
const TraineeSettingSchema = new Schema({
  key: { type: String, default: "main", unique: true },
  offTracks: { type: [String], default: [] },
  updatedBy: { type: String, default: "" },
}, { timestamps: true });

export default mongoose.model("TraineeSetting", TraineeSettingSchema);
