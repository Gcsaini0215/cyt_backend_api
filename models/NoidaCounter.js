import mongoose from "mongoose";
const { Schema } = mongoose;

// Tiny atomic counters (e.g. the next client number).
const noidaCounterSchema = new Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

export default mongoose.model("NoidaCounter", noidaCounterSchema);
