import mongoose from "mongoose";
const { Schema } = mongoose;

/* Admin's switches for a festival offer (helper/festivalOffer.js has the defaults). One row per offer key;
   a field left unset falls back to the default. */
const festivalOfferSettingSchema = new Schema({
  key:          { type: String, required: true, unique: true }, // e.g. "diwali-2026"
  active:       { type: Boolean, default: true },                // off = page shows "paused", no new purchases
  formats:      { type: [String], default: undefined },          // which modes are on: "in-person", "online"
  bookBy:       { type: String, default: "" },                   // last day to buy, "YYYY-MM-DD" (IST)
  blockedDates: { type: [String], default: undefined },          // no sessions on these days
  validDays:    { type: Number, default: null },                 // both sessions within this many days of buying
  updatedBy:    { type: String, default: "" },
}, { timestamps: true });

export default mongoose.model("FestivalOfferSetting", festivalOfferSettingSchema);
