import mongoose from "mongoose";
const { Schema } = mongoose;

// Which optional emails a therapist wants. New-booking emails are always sent.
const TherapistPrefsSchema = new Schema({
  user:          { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  notice_email:  { type: Boolean, default: true },  // announcements from the CYT team
  action_email:  { type: Boolean, default: true },  // requests to update something
  payout_email:  { type: Boolean, default: true },  // a payout was sent
  reply_email:   { type: Boolean, default: true },  // the team replied to a report
}, { timestamps: true });

export default mongoose.model("TherapistPrefs", TherapistPrefsSchema);
