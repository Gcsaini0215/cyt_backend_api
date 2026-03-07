import mongoose from "mongoose";
const { Schema } = mongoose;

const clinicLogSchema = new Schema(
  {
    therapist: {
      type: Schema.Types.ObjectId,
      ref: "Users",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      default: "",
    },
    phone: {
      type: String,
      required: true,
    },
    date: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
    amount: {
      type: String,
      required: true,
    },
    remainingAmount: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      default: "Paid",
    },
    therapist_name: String,
    therapist_type: String,
    emailSent: {
      type: Boolean,
      default: false
    },
  },
  { timestamps: true }
);

export default mongoose.model("ClinicLog", clinicLogSchema);
