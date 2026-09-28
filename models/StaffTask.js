import mongoose from "mongoose";
const { Schema } = mongoose;

// A piece of work a manager gives a staff member.
const StaffTaskSchema = new Schema({
  title:     { type: String, required: true, trim: true, maxlength: 200 },
  note:      { type: String, default: "", maxlength: 2000 },
  assignee:  { type: Schema.Types.ObjectId, ref: "Admin", required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
  due:       { type: String, default: "" }, // IST "YYYY-MM-DD", "" = no deadline
  priority:  { type: String, enum: ["low", "normal", "high"], default: "normal" },
  status:    { type: String, enum: ["open", "done"], default: "open" },
  doneAt:    { type: Date, default: null },
  doneNote:  { type: String, default: "", maxlength: 1000 },
}, { timestamps: true });

StaffTaskSchema.index({ assignee: 1, status: 1, due: 1 });

export default mongoose.model("StaffTask", StaffTaskSchema);
