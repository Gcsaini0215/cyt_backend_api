import mongoose from "mongoose";
const { Schema } = mongoose;

const leadSchema = new Schema({
  name: {
    type: String,
    required: true,
  },
  phone: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    required: true,
  },
  concern: {
    type: String,
    required: false,
  },
  source: {
    type: String,
    required: false,
  },
  followup_status: {
    type: String,
    default: null,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("Lead", leadSchema);