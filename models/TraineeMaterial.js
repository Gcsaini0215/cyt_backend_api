import mongoose from "mongoose";
const { Schema } = mongoose;

// Notes the CYT team shares with trainees — worksheets, slides, reading. Sent to everyone or to chosen trainees.
const TraineeMaterialSchema = new Schema({
  title:    { type: String, required: true, trim: true },
  details:  { type: String, default: "" },
  kind:     { type: String, enum: ["worksheet", "ppt", "notes", "other"], default: "notes" },
  file:     { type: String, default: "" },       // stored path under uploads/, e.g. "resources/abc.pdf"
  fileName: { type: String, default: "" },       // original name, for the download label
  link:     { type: String, default: "" },       // or an outside link (Drive, Docs …)
  forAll:   { type: Boolean, default: true },
  emails:   { type: [String], default: [] },     // when not for everyone
  sentBy:   { type: String, default: "" },
}, { timestamps: true });

TraineeMaterialSchema.index({ forAll: 1, createdAt: -1 });
TraineeMaterialSchema.index({ emails: 1 });

export default mongoose.model("TraineeMaterial", TraineeMaterialSchema);
