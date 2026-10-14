import mongoose from "mongoose";
const { Schema } = mongoose;

// A payout to a therapist, recorded by the accounts team.
const TherapistPayoutSchema = new Schema({
  user:       { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  amount:     { type: Number, required: true, min: 0 },
  periodFrom: { type: Date, default: null },
  periodTo:   { type: Date, default: null },
  sessions:   { type: Number, default: 0, min: 0 },
  method:     { type: String, enum: ["bank", "upi", "other"], default: "bank" },
  reference:  { type: String, default: "", trim: true, maxlength: 120 }, // UTR / UPI ref
  status:     { type: String, enum: ["pending", "paid"], default: "pending", index: true },
  paidAt:     { type: Date, default: null },
  note:       { type: String, default: "", maxlength: 1000 },
  createdBy:  { type: Schema.Types.ObjectId, ref: "Admin", default: null },
}, { timestamps: true });

export default mongoose.model("TherapistPayout", TherapistPayoutSchema);
