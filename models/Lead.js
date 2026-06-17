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
    required: false,
    default: "",
  },
  concern: {
    type: String,
    required: false,
  },
  location: {
    type: String,
    required: false,
  },
  message: {
    type: String,
    required: false,
  },
  source: {
    type: String,
    required: false,
  },
  data: {
    type: Object,
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