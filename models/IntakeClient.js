import mongoose from "mongoose";

const DocSchema = new mongoose.Schema({
  id:        { type: String },
  type:      String,
  title:     String,
  content:   String,
  createdAt: String,
  updatedAt: String,
}, { _id: false });

const BillingEntrySchema = new mongoose.Schema({
  sessionNumber:   Number,
  sessionDate:     String,
  sessionDuration: String,
  billingType:     String,
  mrp:             Number,
  charges:         Number,
  paid:            Number,
  packageName:     String,
  packageSessions: Number,
  packageTotal:    Number,
  packagePaid:     Number,
  loggedAt:        String,
}, { _id: false });

const FollowUpEntrySchema = new mongoose.Schema({
  nextSession: String,
  note:        String,
  loggedAt:    String,
}, { _id: false });

const IntakeClientSchema = new mongoose.Schema({
  id:              { type: String, required: true, unique: true },
  name:            String,
  phone:           String,
  email:           String,
  age:             String,
  gender:          String,
  concern:         String,
  therapist:       String,
  sessionType:     String,
  recordType:      String,
  notes:           String,
  intakeDate:      String,
  source:          String,
  createdAt:       String,
  nextSession:     String,
  followUpNote:    String,
  documents:       [DocSchema],
  billingEntries:  [BillingEntrySchema],
  followUpHistory: [FollowUpEntrySchema],
}, { timestamps: false });

export default mongoose.model("IntakeClient", IntakeClientSchema);
