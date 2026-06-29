import mongoose from "mongoose";

const AppointmentRequestSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  phone:         { type: String, required: true },
  email:         { type: String, default: "" },
  concern:       { type: String, default: "" },
  preferredTime: { type: String, default: "" },
  message:       { type: String, default: "" },
  status:        { type: String, default: "pending" }, // pending | confirmed | rescheduled | cancelled
  confirmedTime: { type: String, default: "" },
  adminNote:     { type: String, default: "" },
  source:        { type: String, default: "website" },
  therapistId:   { type: String, default: "" },
  therapistName: { type: String, default: "" },
}, { timestamps: true });

export default mongoose.model("AppointmentRequest", AppointmentRequestSchema);
