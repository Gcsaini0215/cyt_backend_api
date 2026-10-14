import mongoose from "mongoose";
const { Schema } = mongoose;

// A notice from the CYT team to therapists. city empty = all therapists; otherwise only therapists
// whose profile location contains that city. Read receipts are per therapist user.
const TherapistAnnouncementSchema = new Schema({
  title:     { type: String, required: true, trim: true, maxlength: 160 },
  body:      { type: String, default: "", maxlength: 4000 },
  link:      { type: String, default: "", maxlength: 500 },
  linkLabel: { type: String, default: "", maxlength: 60 },
  city:      { type: String, default: "", trim: true, maxlength: 80 },
  important: { type: Boolean, default: false },
  emailed:   { type: Number, default: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
  readBy:    [{ user: { type: Schema.Types.ObjectId, ref: "User" }, at: { type: Date, default: Date.now }, _id: false }],
}, { timestamps: true });

TherapistAnnouncementSchema.index({ createdAt: -1 });

export default mongoose.model("TherapistAnnouncement", TherapistAnnouncementSchema);
