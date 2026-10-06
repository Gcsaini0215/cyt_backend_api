import mongoose from "mongoose";
const { Schema } = mongoose;

/* A client's review of their session at CYT Noida. Asked for after the desk marks the
   session "Done" (email link, or a WhatsApp link the desk sends); written on the public
   /noida-review/<token> page; shown on the booking page only once an admin approves it. */
const noidaReviewSchema = new Schema({
  appointment:   { type: Schema.Types.ObjectId, ref: "NoidaAppointment", required: true, unique: true },
  name:          { type: String, default: "" },   // as booked; shown as "Riya S." when showName
  phone:         { type: String, default: "" },
  rating:        { type: Number, required: true, min: 1, max: 5 },
  text:          { type: String, default: "", maxlength: 1500 },
  showName:      { type: Boolean, default: true },
  therapistName: { type: String, default: "" },
  sessionDate:   { type: String, default: "" },   // "YYYY-MM-DD"
  status:        { type: String, enum: ["pending", "approved", "hidden"], default: "pending" },
  decidedBy:     { type: String, default: "" },
  decidedAt:     { type: Date, default: null },
}, { timestamps: true });

noidaReviewSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("NoidaReview", noidaReviewSchema);
