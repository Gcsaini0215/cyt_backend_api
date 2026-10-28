import mongoose from "mongoose";
const { Schema } = mongoose;

// An achievement a therapist has unlocked on CYT (helper/achievements.js) — kept once earned, with the
// numbers at that moment and a public code that verifies the certificate (/verify-achievement/<code>).
const therapistAchievementSchema = new Schema(
  {
    therapist: { type: Schema.Types.ObjectId, ref: "Therapists", required: true },
    key: { type: String, required: true },
    code: { type: String, required: true, unique: true },
    unlockedAt: { type: Date, default: Date.now },
    stats: { sessions: Number, goodReviews: Number, avgRating: Number, months: Number },
  },
  { timestamps: true }
);

therapistAchievementSchema.index({ therapist: 1, key: 1 }, { unique: true });

export default mongoose.model("TherapistAchievement", therapistAchievementSchema);
