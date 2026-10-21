import mongoose from "mongoose";
const { Schema } = mongoose;

// One row per trainee per IST day: when they checked in (joined) and checked out (left).
// Trainees are keyed by email — it is the same for portal accounts and internship applications.
const TraineeAttendanceSchema = new Schema({
  email:    { type: String, required: true, lowercase: true, trim: true },
  name:     { type: String, default: "" },
  date:     { type: String, required: true }, // IST "YYYY-MM-DD"
  checkIn:  { type: Date, default: null },
  checkOut: { type: Date, default: null },
  note:     { type: String, default: "" },     // what they worked on, written at check-out
  autoOut:  { type: Boolean, default: false }, // closed by the system because they forgot to check out
}, { timestamps: true });

TraineeAttendanceSchema.index({ email: 1, date: 1 }, { unique: true });
TraineeAttendanceSchema.index({ date: 1 });

export default mongoose.model("TraineeAttendance", TraineeAttendanceSchema);
