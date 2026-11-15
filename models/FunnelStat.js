import mongoose from "mongoose";
const { Schema, model } = mongoose;
/* Booking funnel counts — one row per day (India time). No personal data at all: just how many
   times each step happened, split by guest/member and online/in-person.
   counts.<event>__<guest|member>__<online|inperson|na> = n   (see controllers/FunnelController.js) */
const FunnelStatSchema = new Schema(
  {
    day: { type: String, required: true, unique: true }, // YYYY-MM-DD, IST
    counts: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: false, minimize: false }
);
export default model("FunnelStat", FunnelStatSchema);
