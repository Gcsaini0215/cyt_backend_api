import mongoose from "mongoose";
const { Schema } = mongoose;

/* Therapist reflection journal (2026-11-20, owner): the therapist's own private countertransference notes
   after a session — feelings, body, the pull to act, "whose feeling is it", what it may say about the work,
   a plan and self-care. Only the therapist can read it: no admin route, and the free text is encrypted at
   rest (helper/googleMeet.js encrypt). Chips / numbers stay plain so the therapist's pattern view can count them. */
const schema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    feelings: [{ type: String }],
    intensity: { type: Number, min: 0, max: 10, default: 5 },
    body: [{ type: String }],
    pulls: [{ type: String }],
    whose: { type: String, default: "" }, // mine | client | both | unsure
    care: [{ type: String }],
    supervision: { type: Boolean, default: false },
    secret: { type: String, default: "" }, // encrypted JSON: { label, moment, story, meaning, plan }
  },
  { timestamps: true }
);
schema.index({ user: 1, createdAt: -1 });
export default mongoose.model("TherapistReflection", schema);
