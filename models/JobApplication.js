import mongoose from "mongoose";
const { Schema } = mongoose;

/* Someone who applied from /careers. The resume sits in uploads/documents (private) and is
   opened only through the admin download route. */
const jobApplicationSchema = new Schema({
  job: { type: Schema.Types.ObjectId, ref: "JobOpening", default: null },
  jobTitle: { type: String, default: "" },        // kept even if the opening is deleted later
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, required: true, trim: true },
  city: { type: String, default: "", trim: true },
  experience: { type: String, default: "", trim: true },
  currentRole: { type: String, default: "", trim: true },
  qualification: { type: String, default: "", trim: true },
  rciNumber: { type: String, default: "", trim: true },
  link: { type: String, default: "", trim: true },  // LinkedIn / portfolio / Instagram
  noticePeriod: { type: String, default: "", trim: true },
  message: { type: String, default: "", trim: true },
  resume: { type: String, default: "" },            // stored file name in uploads/documents
  resumeName: { type: String, default: "" },        // the applicant's own file name
  status: { type: String, enum: ["new", "shortlisted", "interview", "hired", "rejected"], default: "new" },
  notes: [{ text: String, by: String, at: { type: Date, default: Date.now } }],
}, { timestamps: true });

jobApplicationSchema.index({ createdAt: -1 });
jobApplicationSchema.index({ job: 1, status: 1 });

export default mongoose.model("JobApplication", jobApplicationSchema);
