import mongoose from "mongoose";
const { Schema } = mongoose;

// Work the CYT team sends to a trainee. Sending one task to several trainees makes one row each,
// so every trainee has their own status and reply.
const TraineeTaskSchema = new Schema({
  email:       { type: String, required: true, lowercase: true, trim: true },
  name:        { type: String, default: "" },
  title:       { type: String, required: true, trim: true },
  details:     { type: String, default: "" },
  due:         { type: Date, default: null },
  priority:    { type: String, enum: ["low", "normal", "high"], default: "normal" },
  status:      { type: String, enum: ["todo", "doing", "done"], default: "todo" },
  traineeNote: { type: String, default: "" }, // the trainee's reply / what they did
  link:        { type: String, default: "" }, // link to their work (Drive, Docs …)
  doneAt:      { type: Date, default: null },
  createdBy:   { type: String, default: "" },
}, { timestamps: true });

TraineeTaskSchema.index({ email: 1, createdAt: -1 });

export default mongoose.model("TraineeTask", TraineeTaskSchema);
