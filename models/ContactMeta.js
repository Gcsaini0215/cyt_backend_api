import mongoose from "mongoose";

const contactMetaSchema = new mongoose.Schema({
  refId:  { type: String, required: true, unique: true }, // user._id or lead._id (string)
  source: { type: String, enum: ["user", "lead"], required: true },
  status: { type: String, enum: ["new", "contacted", "converted", "lost"], default: "new" },
  notes:  { type: String, default: "" },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("ContactMeta", contactMetaSchema);
