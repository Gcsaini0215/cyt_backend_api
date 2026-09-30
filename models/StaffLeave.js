import mongoose from "mongoose";
const { Schema } = mongoose;

// A leave request from a team member, approved or rejected by a manager.
const StaffLeaveSchema = new Schema({
  admin:        { type: Schema.Types.ObjectId, ref: "Admin", required: true },
  from:         { type: String, required: true }, // IST "YYYY-MM-DD"
  to:           { type: String, required: true }, // IST "YYYY-MM-DD", >= from
  halfDay:      { type: Boolean, default: false }, // only when from === to
  type:         { type: String, enum: ["casual", "sick", "emergency", "other"], default: "casual" },
  reason:       { type: String, default: "", maxlength: 1000 },
  days:         { type: Number, default: 1 },      // working days asked for (Sundays not counted)
  status:       { type: String, enum: ["pending", "approved", "rejected", "cancelled"], default: "pending" },
  decidedBy:    { type: Schema.Types.ObjectId, ref: "Admin", default: null },
  decidedAt:    { type: Date, default: null },
  decisionNote: { type: String, default: "", maxlength: 500 },
}, { timestamps: true });

StaffLeaveSchema.index({ admin: 1, from: 1 });
StaffLeaveSchema.index({ status: 1, from: 1 });

export default mongoose.model("StaffLeave", StaffLeaveSchema);
