import mongoose from "mongoose";

const contactMetaSchema = new mongoose.Schema({
  refId:     { type: String, required: true, unique: true },
  source:    { type: String, enum: ["user", "lead"], required: true },
  status:    { type: String, enum: ["new", "contacted", "converted", "lost"], default: "new" },
  notes:     { type: String, default: "" },
  favourite: { type: Boolean, default: false },
  tags:      { type: [String], default: [] },
  lastEmailedAt: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("ContactMeta", contactMetaSchema);
