import mongoose from "mongoose";
const { Schema } = mongoose;

/* Admin-curated availability for the Noida center — covers both fresh
   intake ("new") and follow-up ("followup") bookings. A document here
   just means "this date+slot is offered for this booking type"; whether
   it's actually taken is derived by checking NoidaAppointment for a
   confirmed booking at the same date+slot (shared across both types,
   since the center only has one physical slot at a time regardless of
   which pool it was opened under). */
const noidaFollowupSlotSchema = new Schema({
  date: { type: String, required: true }, // "YYYY-MM-DD"
  slot: { type: String, required: true }, // e.g. "11:00 AM - 12:00 PM"
  type: { type: String, enum: ["new", "followup"], default: "followup" },
}, { timestamps: true });

noidaFollowupSlotSchema.index({ date: 1, slot: 1, type: 1 }, { unique: true });

export default mongoose.model("NoidaFollowupSlot", noidaFollowupSlotSchema);
