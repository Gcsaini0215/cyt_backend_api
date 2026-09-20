import mongoose from "mongoose";
const { Schema } = mongoose;

/* A client's "let me in right now" request for a slot inside the last-
   minute window (see LAST_MINUTE_WINDOW_MINUTES in NoidaAppointmentController).
   Booking a slot in that window on the public page always goes through one
   of these first — staff has to accept before payment/booking is allowed,
   since a slot this close to start needs a human to confirm the center can
   actually take the client. */
const noidaLastMinuteRequestSchema = new Schema({
  name:     { type: String, required: true },
  age:      { type: String, default: "" },
  phone:    { type: String, required: true },
  email:    { type: String, default: "" },
  concern:  { type: String, default: "" },
  date:     { type: String, required: true },
  slot:     { type: String, required: true },
  type:     { type: String, enum: ["new", "followup"], default: "new" },

  sessionMode: { type: String, enum: ["individual", "couple", "package"], default: "individual" },
  format:      { type: String, enum: ["in-person", "online", "home-visit"], default: "in-person" },
  address:     { type: String, default: "" },
  packageId:   { type: Schema.Types.ObjectId, ref: "NoidaPackage", default: null },
  customSessions: { type: Number, default: 0 },

  status: { type: String, enum: ["pending", "accepted", "rejected", "expired"], default: "pending" },
  requestedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null },
  respondedBy: { type: Schema.Types.ObjectId, ref: "Admin", default: null },
}, { timestamps: true });

noidaLastMinuteRequestSchema.index({ date: 1, slot: 1, status: 1 });

export default mongoose.model("NoidaLastMinuteRequest", noidaLastMinuteRequestSchema);
