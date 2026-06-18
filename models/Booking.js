import mongoose from "mongoose";
const { Schema } = mongoose;

const bookingSchema = new Schema({
  client: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  therapist: {
    type: Schema.Types.ObjectId,
    ref: "Therapists",
    required: true,
  },
  transaction: {
    type: Schema.Types.ObjectId,
    ref: "Transaction"
  },
  service: {
    type: String,
    required: true,
  },
  notes: {
    type: String,
    default: "",
  },
  file: {
    type: String,
    default: "",
  },
  format: {
    type: String,
    required: true,
  },
  whom: {
    type: String,
    default:"Whom"
  },
  cname: {
    type: String,
    default: "",
  },
  amount: {
    type: Schema.Types.Decimal128,
    required: true,
  },
  relation_with_client: {
    type: String,
    default: "",
  },
  otp: {
    type: Number,
    required: true
  },
  age: {
    type: Number,
    default: null,
  },
  booking_date: {
    type: Date,
    required: true,
    default: Date.now,
  },

  session_started_at: {
    type: Date,
    default: null,
  },

  session_completed_at: {
    type: Date,
    default: null,
  },
  status: {
    type: String,
    default: "New",
  },
});

export default mongoose.model("Booking", bookingSchema);
