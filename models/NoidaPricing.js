import mongoose from "mongoose";
const { Schema } = mongoose;

/* Singleton settings document — one row holds the admin-configured price
   (in rupees) for every session-mode × format combination at the Noida
   center. Always looked up as the single existing doc (or created with
   these defaults on first read); there's no admin UI for adding new
   combinations, just editing the six numbers. */
const noidaPricingSchema = new Schema({
  individual_inperson:  { type: Number, default: 999 },
  individual_online:    { type: Number, default: 799 },
  individual_homevisit: { type: Number, default: 1999 },
  couple_inperson:      { type: Number, default: 1499 },
  couple_online:        { type: Number, default: 1199 },
  couple_homevisit:     { type: Number, default: 2499 },
  platformFee:          { type: Number, default: 20 },
}, { timestamps: true });

export default mongoose.model("NoidaPricing", noidaPricingSchema);
