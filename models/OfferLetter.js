import mongoose from "mongoose";
const { Schema } = mongoose;

const offeringSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
  },
  { _id: false }
);

// One entry per email actually sent (or attempted) from the app — the outreach history.
const emailLogSchema = new Schema(
  {
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    subject: { type: String, default: "" },
    sentAt: { type: Date, default: Date.now },
    sentBy: { type: String, default: "" }, // admin's name
    ok: { type: Boolean, default: false },
    error: { type: String, default: "" },
    isTest: { type: Boolean, default: false },
  },
  { _id: false }
);

const offerLetterSchema = new Schema(
  {
    number: { type: String, required: true, unique: true, trim: true }, // CYT-OL-2026-0001
    status: { type: String, enum: ["draft", "sent", "replied", "meeting", "won", "lost"], default: "draft" },
    template: { type: String, default: "" },
    date: { type: String, required: true }, // YYYY-MM-DD
    followUpOn: { type: String, default: "" }, // YYYY-MM-DD, optional reminder to chase

    recipient: {
      business: { type: String, required: true, trim: true },
      contactPerson: { type: String, default: "" },
      designation: { type: String, default: "" },
      email: { type: String, default: "" }, // primary email(s), comma separated as typed
      phone: { type: String, default: "" },
      address: { type: String, default: "" },
      industry: { type: String, default: "" },
    },

    subject: { type: String, default: "", trim: true },
    salutation: { type: String, default: "Dear Sir/Madam," },
    opening: { type: String, default: "" },
    offeringsTitle: { type: String, default: "What we can offer" },
    offerings: { type: [offeringSchema], default: [] },
    benefitsTitle: { type: String, default: "Why partner with us" },
    benefits: { type: [String], default: [] },
    offerTitle: { type: String, default: "" },
    offerText: { type: String, default: "" },
    nextSteps: { type: String, default: "" },
    closing: { type: String, default: "Yours sincerely," },
    signatory: {
      name: { type: String, default: "" },
      designation: { type: String, default: "" },
      phone: { type: String, default: "" },
      email: { type: String, default: "" },
    },
    enclosures: { type: [String], default: [] },
    emailMessage: { type: String, default: "" }, // the short cover note that goes in the email body

    emails: { type: [emailLogSchema], default: [] },
    pdfFile: { type: String, default: "" },
    pdfSavedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

offerLetterSchema.index({ createdAt: -1 });
offerLetterSchema.index({ "recipient.business": 1 });

export default mongoose.model("OfferLetter", offerLetterSchema);
