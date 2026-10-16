import mongoose from "mongoose";
const { model, Schema } = mongoose;

// One finished self-check (PHQ-9, GAD-7, sleep, PCL-5, Big Five) for a signed-in client — only the
// score and band are kept, never the individual answers.
const AssessmentResultSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    test: { type: String, required: true, enum: ["phq9", "gad7", "sleep", "pcl5", "bigfive"] },
    title: { type: String, default: "" },
    score: { type: Number, default: null },
    max: { type: Number, default: null },
    level: { type: String, default: "" },
    dims: { type: Map, of: Number, default: undefined }, // Big Five: O/C/E/A/N as 0–100
    flag: { type: Boolean, default: false }, // PHQ-9 item 9 above zero
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
AssessmentResultSchema.index({ user: 1, createdAt: -1 });

export default model("AssessmentResult", AssessmentResultSchema);
