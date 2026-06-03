import mongoose from "mongoose";
const { model, Schema } = mongoose;
const FileSchema = new Schema({
  url:          { type: String, required: true },
  fileName:     { type: String, required: true },
  fileSize:     { type: Number, required: true },
  fileType:     { type: String, required: true },
  uploadedAt:   { type: Date,   default: Date.now },
  title:        { type: String, default: "" },
  description:  { type: String, default: "" },
  category:     { type: String, default: "General" },
  icon:         { type: String, default: "📄" },
  isActive:     { type: Boolean, default: true },
  uploadedBy:   { type: String, default: "" },
});
export default model("FileMeta", FileSchema);
