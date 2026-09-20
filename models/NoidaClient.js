import mongoose from "mongoose";
const { Schema } = mongoose;

/* One row per client (identified by phone) with a permanent client number
   such as CYTN-0007. It is handed out the first time the client is added —
   by a booking or by a package credit — and never changes after that. */
const noidaClientSchema = new Schema({
  phone: { type: String, required: true, unique: true, trim: true },
  code:  { type: String, required: true, unique: true },
  seq:   { type: Number, required: true },
  name:  { type: String, default: "" },
}, { timestamps: true });

export default mongoose.model("NoidaClient", noidaClientSchema);
