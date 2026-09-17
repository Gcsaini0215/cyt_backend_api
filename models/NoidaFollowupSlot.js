import mongoose from "mongoose";
const { Schema } = mongoose;

/* Admin-curated availability for follow-up sessions at the Noida center —
   separate from the fixed Mon–Sat business-hours grid used for new-client
   bookings, since follow-ups depend on which therapist/slot the admin has
   actually kept open. A document here just means "this date+slot is
   offered for follow-ups"; whether it's taken is derived by checking
   NoidaAppointment for a confirmed booking at the same date+slot. */
const noidaFollowupSlotSchema = new Schema({
  date: { type: String, required: true }, // "YYYY-MM-DD"
  slot: { type: String, required: true }, // e.g. "11:00 AM - 11:45 AM"
}, { timestamps: true });

noidaFollowupSlotSchema.index({ date: 1, slot: 1 }, { unique: true });

export default mongoose.model("NoidaFollowupSlot", noidaFollowupSlotSchema);
