import mongoose from "mongoose";
const { Schema } = mongoose;

const RoleSchema = new Schema({
  name:        { type: String, required: true, unique: true, trim: true },
  permissions: { type: [String], default: [] },
  color:       { type: String, default: "#228756" },
  createdBy:   { type: Schema.Types.ObjectId, ref: "Admin", default: null },
}, { timestamps: true });

export default mongoose.model("Role", RoleSchema);
