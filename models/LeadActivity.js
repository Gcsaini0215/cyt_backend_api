import mongoose from "mongoose";
const { Schema } = mongoose;

/* One row per status change a team member makes on a lead — the audit
   trail behind the superadmin "Lead Activity" page. Kept as its own
   collection (rather than embedded in Lead) so the activity feed across
   all leads can be queried/sorted/paginated directly. */
const leadActivitySchema = new Schema({
  lead: {
    type: Schema.Types.ObjectId,
    ref: "Lead",
    required: true,
  },
  status: {
    type: String,
    enum: ["new", "contacted", "converted", "lost"],
    required: true,
  },
  // "status" = a stage change; "pick" / "release" / "assign" = who owns the lead; "note" = a team note
  action: {
    type: String,
    enum: ["status", "pick", "release", "assign", "note"],
    default: "status",
  },
  remark: {
    type: String,
    required: false,
    default: "",
  },
  admin: {
    type: Schema.Types.ObjectId,
    ref: "Admin",
    required: true,
  },
  adminName: {
    type: String,
    required: true,
  },
}, { timestamps: true });

leadActivitySchema.index({ createdAt: -1 });

export default mongoose.model("LeadActivity", leadActivitySchema);
