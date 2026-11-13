import mongoose from "mongoose";
const { Schema } = mongoose;

// One day of the client's cycle tracker (flow + symptoms + a short note). Mood lives in MoodEntry.
const cycleLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    day: { type: String, required: true }, // YYYY-MM-DD (IST)
    flow: { type: Number, default: 0, min: 0, max: 4 }, // 0 none · 1 spotting · 2 light · 3 medium · 4 heavy
    symptoms: { type: [String], default: [] },
    note: { type: String, default: "", maxlength: 280 },
  },
  { timestamps: true }
);

cycleLogSchema.index({ user: 1, day: 1 }, { unique: true });

export default mongoose.model("CycleLog", cycleLogSchema);
