import mongoose from "mongoose";
const { Schema } = mongoose;

/* A health professional applying to practise at CYT Noida on a booking basis (70% to them,
   30% to CYT, paid weekly). Filled on the public /collaborate-noida page; screened in the
   admin "Collaborations" page. `availability` is only their preference — the final, clash-free
   room timing is assigned after screening (see CollabRoomSlot). */
const collabApplicationSchema = new Schema({
  name:            { type: String, required: true, trim: true, maxlength: 80 },
  phone:           { type: String, required: true, trim: true },  // 10 digits
  email:           { type: String, default: "", trim: true, lowercase: true, maxlength: 120 },
  role:            { type: String, required: true, trim: true, maxlength: 60 },
  qualification:   { type: String, default: "", trim: true, maxlength: 200 },
  // where they practise today: kind = clinic | hospital | centre | online | other, plus its name and area/city
  currentPractice: { kind: { type: String, default: "" }, name: { type: String, default: "" }, location: { type: String, default: "" } },
  registrationNo:  { type: String, default: "", trim: true, maxlength: 80 },
  experienceYears: { type: Number, default: 0, min: 0, max: 60 },
  specialisations: { type: [String], default: [] },
  languages:       { type: [String], default: [] },
  sessionFee:      { type: Number, default: null },            // what they'd like a session to cost
  // preferred weekly timing: day 0 (Sun) – 6 (Sat), hours = slot start hour (10 → 10–11 AM)
  availability:    { type: [{ _id: false, day: { type: Number, min: 0, max: 6 }, hours: [Number] }], default: [] },
  flexibility:     { type: String, enum: ["fixed", "some", "flexible"], default: "some" },
  about:           { type: String, default: "", trim: true, maxlength: 1500 },
  profileLink:     { type: String, default: "", trim: true, maxlength: 300 },
  agreedTerms:     { type: Boolean, default: false },
  readHowItWorksAt: { type: Date, default: null },
  emailVerifiedAt: { type: Date, default: null },
  hoursSentAt:     { type: Date, default: null },             // confirmed room hours emailed to them             // email confirmed with a one-time code            // informed consent ticked in the "How it works" modal
  source:          { type: String, default: "", maxlength: 120 },
  status:          { type: String, enum: ["new", "screening", "approved", "rejected", "on_hold"], default: "new" },
  notes:           { type: [{ _id: false, text: String, by: String, at: { type: Date, default: Date.now } }], default: [] },
  statusChangedAt: { type: Date, default: null },
}, { timestamps: true });

collabApplicationSchema.index({ status: 1, createdAt: -1 });
collabApplicationSchema.index({ phone: 1 });

export default mongoose.model("CollabApplication", collabApplicationSchema);
