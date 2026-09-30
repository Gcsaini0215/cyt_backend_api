import mongoose from "mongoose";
const { Schema } = mongoose;

// Single settings document for the staff system: office hours and monthly targets.
const StaffSettingSchema = new Schema({
  key:          { type: String, default: "main", unique: true },
  startTime:    { type: String, default: "10:00" }, // IST "HH:MM"
  endTime:      { type: String, default: "19:00" },
  graceMinutes: { type: Number, default: 15 },       // late only after start + grace
  // where the office is: check-ins count as "office" within `radius` metres of this point or from these networks
  office:        { lat: { type: Number, default: null }, lng: { type: Number, default: null }, radius: { type: Number, default: 200 } },
  officeIps:     { type: [String], default: [] },
  enforceOffice: { type: Boolean, default: false },  // office-mode staff can only check in from the office
  // how each person works: "office" (default), "wfh" (anywhere), "hybrid" (WFH on wfhDays, 0 = Sunday)
  modes: [{
    admin:   { type: Schema.Types.ObjectId, ref: "Admin" },
    mode:    { type: String, enum: ["office", "wfh", "hybrid"], default: "office" },
    wfhDays: { type: [Number], default: [] },
    _id: false,
  }],
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
