import mongoose from "mongoose";
const { Schema } = mongoose;

// "Work from home" for one day, asked by an office-mode team member and approved by a manager.
const StaffWfhSchema = new Schema({
  admin:        { type: Schema.Types.ObjectId, ref: "Admin", required: true },
  date:         { type: String, required: true }, // IST "YYYY-MM-DD"
  reason:       { type: String, default: "", maxlength: 1000 },
  status:       { type: String, enum: ["pending", "approved", "rejected", "cancelled"], default: "pending" },
  decidedBy:    { type: Schema.Types.ObjectId, ref: "Admin", default: null },
  decidedAt:    { type: Date, default: null },
  decisionNote: { type: String, default: "", maxlength: 500 },
}, { timestamps: true });

StaffWfhSchema.index({ admin: 1, date: 1 });
StaffWfhSchema.index({ status: 1, date: 1 });

export default mongoose.model("StaffWfh", StaffWfhSchema);
