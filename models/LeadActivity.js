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
