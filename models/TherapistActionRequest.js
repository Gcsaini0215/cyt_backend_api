import mongoose from "mongoose";
const { Schema } = mongoose;

// Something the CYT team asks one therapist to do ("Upload your RCI certificate"), with an
// optional deadline. One document per therapist so each has its own status.
const TherapistActionRequestSchema = new Schema({
  user:      { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  title:     { type: String, required: true, trim: true, maxlength: 160 },
  body:      { type: String, default: "", maxlength: 2000 },
  link:      { type: String, default: "", maxlength: 500 },
  dueDate:   { type: Date, default: null },
  status:    { type: String, enum: ["open", "done", "cancelled"], default: "open", index: true },
  doneAt:    { type: Date, default: null },
  doneNote:  { type: String, default: "", maxlength: 1000 },
  batch:     { type: String, default: "" }, // groups requests sent together
  createdBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
}, { timestamps: true });

export default mongoose.model("TherapistActionRequest", TherapistActionRequestSchema);
