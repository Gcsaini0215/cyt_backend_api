import mongoose from "mongoose";
const { Schema } = mongoose;

// Session pack settings (Admin → Pack Pricing): which packs are sold, at what % off, and how long they
// last. One document (key "default"); helper/sessionBundle.js falls back to 4 = 5%, 6 = 10%, 90 days.
const packPricingSchema = new Schema(
  {
    key: { type: String, default: "default", unique: true },
    packs: { type: [{ size: Number, pct: Number, active: { type: Boolean, default: true } }], default: [] },
    days: { type: Number, default: 90 },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export default mongoose.model("PackPricing", packPricingSchema);
