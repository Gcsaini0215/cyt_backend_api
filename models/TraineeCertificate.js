import mongoose from "mongoose";
const { Schema } = mongoose;

// A certificate PDF the CYT team forwards to a trainee; it shows on their portal Certificate page.
const TraineeCertificateSchema = new Schema({
  email:   { type: String, required: true, lowercase: true, trim: true },
  name:    { type: String, default: "" },
  title:   { type: String, default: "Internship Certificate", trim: true },
  note:    { type: String, default: "" },
  file:    { type: String, required: true }, // stored path under uploads/, e.g. "resources/abc.pdf"
  sentBy:  { type: String, default: "" },
}, { timestamps: true });

TraineeCertificateSchema.index({ email: 1, createdAt: -1 });

export default mongoose.model("TraineeCertificate", TraineeCertificateSchema);
