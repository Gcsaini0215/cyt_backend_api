import mongoose from "mongoose";
const { Schema } = mongoose;

// A client's ABHA (Ayushman Bharat Health Account), linked from "My ABHA" after an OTP check with ABDM.
// One per client. The full ABHA number is kept (needed later to link care contexts for M2) but the
// API only ever returns it masked. Nothing clinical is stored here.
const abhaLinkSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    abhaNumber: { type: String, required: true }, // 14 digits, stored as 91-xxxx-xxxx-xxxx
    abhaAddress: { type: String, default: "" }, // e.g. name@sbx / name@abdm
    name: { type: String, default: "" },
    gender: { type: String, default: "" },
    yearOfBirth: { type: String, default: "" },
    mobileLast4: { type: String, default: "" },
    method: { type: String, enum: ["created-aadhaar", "linked-abha-number"], required: true },
    env: { type: String, enum: ["sandbox", "production"], required: true },
  },
  { timestamps: true }
);

export default mongoose.model("AbhaLink", abhaLinkSchema);
