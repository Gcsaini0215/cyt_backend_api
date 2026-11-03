import mongoose from "mongoose";
const { Schema } = mongoose;

// A certificate or letter the CYT team issued from admin /certificates. Its number runs per type and year
// (CYT/INT/2026/0001) and its random code is what the QR opens: /verify-certificate/<code>, so a college can
// check it. Numbers can be guessed, codes can't, so only the code shows the details.
const issuedCertificateSchema = new Schema(
  {
    certNumber: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true },
    type: { type: String, enum: ["internship", "experience", "lor"], required: true },
    salutation: { type: String, default: "" },
    name: { type: String, required: true, trim: true },
    role: { type: String, default: "", trim: true }, // internship area, or the job title
    hours: { type: String, default: "" },
    startDate: { type: String, default: "" }, // YYYY-MM-DD
    endDate: { type: String, default: "" },
    issueDate: { type: String, default: "" },
    signatoryName: { type: String, default: "" },
    signatoryDesignation: { type: String, default: "" },
    email: { type: String, default: "", lowercase: true, trim: true },
    phone: { type: String, default: "" },
    emailedAt: Date,
    revoked: { type: Boolean, default: false },
    revokedReason: { type: String, default: "" },
    legacy: { type: Boolean, default: false }, // moved from the old browser-only list, number kept as it was
    issuedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

issuedCertificateSchema.index({ createdAt: -1 });

export default mongoose.model("IssuedCertificate", issuedCertificateSchema);
