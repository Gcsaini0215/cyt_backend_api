import mongoose from "mongoose";
const { model, Schema } = mongoose;

// One finished self-check (PHQ-9, GAD-7, sleep, PCL-5, Big Five) for a signed-in client — only the
// score and band are kept, never the individual answers.
const AssessmentResultSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    test: { type: String, required: true, enum: ["phq9", "gad7", "sleep", "pcl5", "bigfive", "dass21", "k10", "phq15", "audit", "asrs", "epds", "cbi", "rses"] },
    title: { type: String, default: "" },
    score: { type: Number, default: null },
    max: { type: Number, default: null },
    level: { type: String, default: "" },
    dims: { type: Map, of: Number, default: undefined }, // several scores: Big Five O/C/E/A/N, DASS-21 D/A/S, CBI personal/work
    flag: { type: Boolean, default: false }, // self-harm item above zero (PHQ-9 item 9, EPDS item 10)
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
AssessmentResultSchema.index({ user: 1, createdAt: -1 });

export default model("AssessmentResult", AssessmentResultSchema);
