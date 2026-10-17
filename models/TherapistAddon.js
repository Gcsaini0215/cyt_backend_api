import mongoose from "mongoose";
const { model, Schema } = mongoose;

// Paid profile upgrades a therapist buys on top of their listing package.
// assessmentsTill — "Clinical Assessments" add-on (6 months): they can be booked for clinical assessments.
// Buying goes in steps: details sent → approved by an admin → informed consent signed → paid.
const TherapistAddonSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true }, // therapist's user id
    assessmentsTill: { type: Date, default: null },
    regNo: { type: String, default: "" }, // registration / licence no. printed on assessment reports (e.g. RCI CRR no.)
    signature: { type: String, default: "" }, // PNG/JPEG data URL, printed on released reports once verified
    noRegNo: { type: Boolean, default: false }, // no registration no. — qualification below is checked instead
    credential: { type: String, default: "" }, // e.g. "M.A. Clinical Psychology, University of Delhi"
    // clients see the therapist for assessments only after an admin has checked the reg. no. and the payment;
    // a free activation or a changed reg. no. needs a fresh check
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: String, default: "" },
    rejectNote: { type: String, default: "" }, // why an admin sent the details back
    reviewedAt: { type: Date, default: null },
    // informed consent the therapist accepts after approval and before paying
    consentAt: { type: Date, default: null },
    consentName: { type: String, default: "" }, // full name typed as the e-signature
    consentVersion: { type: String, default: "" },
    consentIp: { type: String, default: "" },
    lastSource: { type: String, default: "" }, // "paid" | "free" | "revoked"
    lastAmount: { type: Number, default: null },
    lastPaymentId: { type: String, default: "" },
    lastPaidAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One Razorpay order for an add-on — activated once (pending → paid), from the browser verify.
const TherapistAddonOrderSchema = new Schema(
  {
    orderId: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    addon: { type: String, enum: ["assessments"], default: "assessments" },
    amount: { type: Number, required: true }, // rupees
    status: { type: String, enum: ["pending", "paid"], default: "pending" },
    paymentId: { type: String, default: "" },
  },
  { timestamps: true }
);

export const TherapistAddonOrder = model("TherapistAddonOrder", TherapistAddonOrderSchema);
export default model("TherapistAddon", TherapistAddonSchema);
