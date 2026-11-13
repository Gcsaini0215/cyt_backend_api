import mongoose from "mongoose";
const { Schema } = mongoose;

// "Cycle & Mood Care" on My Space: whether the section is for this client, and their cycle settings.
// Private to the client — no therapist or admin route reads it.
const cycleProfileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    menstruates: { type: Boolean, default: null }, // answered "do you get periods?" (null = not asked)
    dismissed: { type: Boolean, default: false }, // "not for me" — the My Space card stops showing
    enabled: { type: Boolean, default: false }, // set up and switched on
    consentAt: { type: Date, default: null },
    lastStart: { type: String, default: "" }, // YYYY-MM-DD the client entered at set-up (logs refine it)
    cycleLen: { type: Number, default: 28, min: 15, max: 60 },
    periodLen: { type: Number, default: 5, min: 1, max: 12 },
    goals: { type: [String], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model("CycleProfile", cycleProfileSchema);
