import mongoose from "mongoose";
const { Schema } = mongoose;

const BankSchema = new Schema(
  {
    ac_name: {
      type: String,
      default: null,
    },
    ac_number: {
      type: String, // was Number, which dropped leading zeros — payouts need the number exactly as typed
      default: null,
      trim: true,
    },
    ifsc: {
      type: String,
      default: null,
    },
    upi: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Bank", BankSchema);
