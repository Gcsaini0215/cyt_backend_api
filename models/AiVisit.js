import mongoose from "mongoose";
const { Schema, model } = mongoose;

/* A visit to the public site that came from an AI assistant (ChatGPT, Perplexity, Gemini, Copilot,
   Claude …) — told apart by the referrer or the utm_source the assistant adds to its links.
   One row per arrival; lead / booked flip to true if the same browser (vid) later sends an enquiry
   or books within 30 days. Shown on the admin Overview. */
const AiVisitSchema = new Schema(
  {
    source: { type: String, required: true, enum: ["chatgpt", "perplexity", "gemini", "copilot", "claude", "other"] },
    landing: { type: String, default: "/" }, // page they arrived on (path only)
    vid: { type: String, default: "" },      // anonymous browser id (no personal data)
    day: { type: String, required: true },   // YYYY-MM-DD, India time
    lead: { type: Boolean, default: false },
    booked: { type: Boolean, default: false },
  },
  { timestamps: true }
);
AiVisitSchema.index({ day: 1 });
AiVisitSchema.index({ vid: 1, createdAt: -1 });

export default model("AiVisit", AiVisitSchema);
