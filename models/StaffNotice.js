import mongoose from "mongoose";
const { Schema } = mongoose;

// An announcement for staff. roles empty = everyone; otherwise only staff whose role is listed.
const StaffNoticeSchema = new Schema({
  title:     { type: String, required: true, trim: true, maxlength: 160 },
  body:      { type: String, default: "", maxlength: 4000 },
  roles:     [{ type: Schema.Types.ObjectId, ref: "Role" }],
  important: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
  readBy:    [{ admin: { type: Schema.Types.ObjectId, ref: "Admin" }, at: { type: Date, default: Date.now }, _id: false }],
}, { timestamps: true });

StaffNoticeSchema.index({ createdAt: -1 });

export default mongoose.model("StaffNotice", StaffNoticeSchema);
