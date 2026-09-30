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
  // where the check-in / check-out happened: "office" | "wfh" | "outside" (not at the office, not WFH) | "unknown"
  inPlace:      { type: String, default: "" },
  inLoc:        { lat: Number, lng: Number, acc: Number },
  inIp:         { type: String, default: "" },
  inDistance:   { type: Number, default: null }, // metres from the office, when both are known
  outPlace:     { type: String, default: "" },
  outLoc:       { lat: Number, lng: Number, acc: Number },
  earlyMinutes: { type: Number, default: 0 },    // left this many minutes before the end of the shift
  autoOut:      { type: Boolean, default: false }, // checked out by the system because they forgot
}, { timestamps: true });

StaffAttendanceSchema.index({ admin: 1, date: 1 }, { unique: true });
StaffAttendanceSchema.index({ date: 1 });

export default mongoose.model("StaffAttendance", StaffAttendanceSchema);
