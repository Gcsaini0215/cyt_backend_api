import mongoose from "mongoose";
const { Schema } = mongoose;

// "Report a problem" / "Suggest a feature" from the therapist portal, answered by the CYT team.
const TherapistFeedbackSchema = new Schema({
  user:       { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  kind:       { type: String, enum: ["problem", "feature", "question", "other"], default: "problem" },
  message:    { type: String, required: true, trim: true, maxlength: 3000 },
  page:       { type: String, default: "", maxlength: 300 },
  status:     { type: String, enum: ["open", "resolved"], default: "open", index: true },
  reply:      { type: String, default: "", maxlength: 3000 },
  repliedAt:  { type: Date, default: null },
  repliedBy:  { type: Schema.Types.ObjectId, ref: "Admin", default: null },
}, { timestamps: true });

export default mongoose.model("TherapistFeedback", TherapistFeedbackSchema);
