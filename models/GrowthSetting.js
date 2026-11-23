import mongoose from "mongoose";

/* Admin → Growth 2027 (controllers/GrowthController.js): one document per key.
   key "targets" → data { months: { "2027-03": { total, care, connect, corporate, academy } }, metrics: { … } }
   key "manual"  → data { weeks: { "2026-11-17": { reviews } } } — numbers the team types in each week */
const growthSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true, minimize: false }
);

export default mongoose.model("GrowthSetting", growthSettingSchema);
