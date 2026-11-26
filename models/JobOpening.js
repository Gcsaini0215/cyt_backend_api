import mongoose from "mongoose";
const { Schema } = mongoose;

/* A job on the website's /careers page. Set up from admin → Settings → Careers. */
const jobOpeningSchema = new Schema({
  title: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, trim: true },
  department: { type: String, default: "Marketing", trim: true },   // Marketing, Clinical, Operations, Technology, Other
  type: { type: String, default: "Full-time", trim: true },         // Full-time, Part-time, Internship, Freelance, Contract
  location: { type: String, default: "Noida", trim: true },         // Noida, Remote, Hybrid…
  experience: { type: String, default: "", trim: true },            // "0–2 years"
  salary: { type: String, default: "", trim: true },                // optional, shown only when filled
  summary: { type: String, default: "", trim: true },
  responsibilities: { type: [String], default: [] },
  requirements: { type: [String], default: [] },
  // therapist roles ask for the RCI number / qualification on the form
  clinical: { type: Boolean, default: false },
  isOpen: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
}, { timestamps: true });

jobOpeningSchema.index({ isOpen: 1, order: 1 });

export default mongoose.model("JobOpening", jobOpeningSchema);
