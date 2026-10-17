import mongoose from "mongoose";
const { model, Schema } = mongoose;

// Paid profile upgrades a therapist buys on top of their listing package.
// assessmentsTill — "Clinical Assessments" add-on (₹499/year): they can be booked for clinical assessments.
const TherapistAddonSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true }, // therapist's user id
    assessmentsTill: { type: Date, default: null },
    regNo: { type: String, default: "" }, // registration / licence no. printed on assessment reports (e.g. RCI CRR no.)
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
