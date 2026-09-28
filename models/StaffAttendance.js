import mongoose from "mongoose";
const { Schema } = mongoose;

// One row per staff member per IST day: when they checked in / out.
const StaffAttendanceSchema = new Schema({
  admin:       { type: Schema.Types.ObjectId, ref: "Admin", required: true },
  date:        { type: String, required: true }, // IST "YYYY-MM-DD"
  checkIn:     { type: Date, default: null },
  checkOut:    { type: Date, default: null },
  lateMinutes: { type: Number, default: 0 },     // minutes after start time + grace, 0 when on time
  note:        { type: String, default: "" },
  editedBy:    { type: Schema.Types.ObjectId, ref: "Admin", default: null }, // set when a manager corrected the times
}, { timestamps: true });

StaffAttendanceSchema.index({ admin: 1, date: 1 }, { unique: true });
StaffAttendanceSchema.index({ date: 1 });

export default mongoose.model("StaffAttendance", StaffAttendanceSchema);
