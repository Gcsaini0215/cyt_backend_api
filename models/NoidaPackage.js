import mongoose from "mongoose";
const { Schema } = mongoose;

/* Admin-defined multi-session bundles (e.g. "5 Sessions — ₹4999"). A
   client buying one pays the package price up front and books their
   first session through the normal flow; the package is just recorded
   against that first NoidaAppointment (see packageId/packageName there)
   — later sessions are scheduled the same way any follow-up is, the
   team tracks how many of the bundle are left manually via adminNote. */
const noidaPackageSchema = new Schema({
  name:         { type: String, required: true },   // e.g. "5-Session Package"
  sessionsCount: { type: Number, required: true, min: 1 },
  price:        { type: Number, required: true, min: 0 }, // flat rupees for the whole bundle
  active:       { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model("NoidaPackage", noidaPackageSchema);
