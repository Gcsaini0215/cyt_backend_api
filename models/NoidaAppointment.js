import mongoose from "mongoose";
const { Schema } = mongoose;

/* Standalone Calendly-style booking for the physical Noida therapy
   center — deliberately not linked to Lead/Therapist records, this is
   just "who's coming in, on what date, at what slot." */
const noidaAppointmentSchema = new Schema({
  name:     { type: String, required: true },
  age:      { type: String, default: "" },
  phone:    { type: String, required: true },
  email:    { type: String, default: "" },
  concern:  { type: String, default: "" },
  date:     { type: String, required: true },   // "YYYY-MM-DD", center-local day, not a Date object — avoids TZ drift
  slot:     { type: String, required: true },    // e.g. "11:00 AM - 11:45 AM"
  type:     { type: String, enum: ["new", "followup"], default: "new" },
  status:   { type: String, enum: ["confirmed", "cancelled"], default: "confirmed" },
  adminNote: { type: String, default: "" },
}, { timestamps: true });

noidaAppointmentSchema.index({ date: 1, slot: 1 });

export default mongoose.model("NoidaAppointment", noidaAppointmentSchema);
