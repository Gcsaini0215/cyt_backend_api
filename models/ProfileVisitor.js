import mongoose from "mongoose";
const { Schema, model } = mongoose;

/* "Has this browser already viewed this profile today, and how often?" — unique visitors per day, and at most
   MAX_VIEWS_PER_VISITOR views counted per browser per profile per day.
   Only a random browser id is kept (no IP, no personal data) and rows expire after 3 days. */
const ProfileVisitorSchema = new Schema({
  therapist: { type: Schema.Types.ObjectId, required: true },
  day: { type: String, required: true },
  vid: { type: String, required: true },
  n: { type: Number, default: 0 }, // views counted from this browser today (max 3)
  at: { type: Date, default: Date.now },
});
ProfileVisitorSchema.index({ therapist: 1, day: 1, vid: 1 }, { unique: true });
ProfileVisitorSchema.index({ at: 1 }, { expireAfterSeconds: 3 * 86400 });

export default model("ProfileVisitor", ProfileVisitorSchema);
