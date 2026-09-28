import mongoose from "mongoose";
const { Schema } = mongoose;

// Single settings document for the staff system: office hours and monthly targets.
const StaffSettingSchema = new Schema({
  key:          { type: String, default: "main", unique: true },
  startTime:    { type: String, default: "10:00" }, // IST "HH:MM"
  endTime:      { type: String, default: "19:00" },
  graceMinutes: { type: Number, default: 15 },       // late only after start + grace
  // monthly targets per staff member; month "YYYY-MM"
  targets: [{
    admin:       { type: Schema.Types.ObjectId, ref: "Admin" },
    month:       { type: String },
    bookings:    { type: Number, default: 0 },
    collections: { type: Number, default: 0 },
    leads:       { type: Number, default: 0 },
    _id: false,
  }],
}, { timestamps: true });

export default mongoose.model("StaffSetting", StaffSettingSchema);
