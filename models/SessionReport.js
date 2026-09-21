import mongoose from "mongoose";
const { Schema } = mongoose;

const sessionReportSchema = new Schema(
  {
    reportNumber: { type: String, required: true, unique: true, trim: true },
    clientName: { type: String, required: true, trim: true },
    age: { type: String, default: "" },
    gender: { type: String, default: "" },
    occupation: { type: String, default: "" },
    maritalStatus: { type: String, default: "" },
    sessionDate: { type: String, required: true },
    sessionMode: { type: String, default: "" },
    therapistName: { type: String, default: "" },
    therapistDesignation: { type: String, default: "" },
    primaryComplaint: { type: String, default: "" },
    mse: { type: String, default: "" },
    observation: { type: String, default: "" },
    riskLevel: { type: String, default: "none" },
    riskNotes: { type: String, default: "" },
    homework: { type: String, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

export default mongoose.model("SessionReport", sessionReportSchema);
