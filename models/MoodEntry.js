import mongoose from "mongoose";
const { Schema } = mongoose;

// The client's daily mood check-in on My Space (1 = low … 5 = great), one per IST day. Only the client sees it.
const moodEntrySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    day: { type: String, required: true }, // YYYY-MM-DD (IST)
    v: { type: Number, min: 1, max: 5, required: true },
  },
  { timestamps: true }
);

moodEntrySchema.index({ user: 1, day: 1 }, { unique: true });

export default mongoose.model("MoodEntry", moodEntrySchema);
