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

  // "Custom package": the client picks how many sessions they want (within
  // min..max) and pays sessions x perSessionPrice — for anyone who needs fewer
  // or more than the fixed packages.
  customPackage: {
    enabled:         { type: Boolean, default: false },
    perSessionPrice: { type: Number, default: 0 },
    minSessions:     { type: Number, default: 2 },
    maxSessions:     { type: Number, default: 20 },
  },

  // Which live therapists clients can ask for when booking at CYT Noida (picked by the admin).
  therapists: [{ type: Schema.Types.ObjectId, ref: "Therapists" }],
  // Master switch for the therapist choice on the booking screens. Off = clients see nothing
  // about therapists at all (not even "No preference").
  therapistChoice: { type: Boolean, default: true },

  // Auto-assigned + emailed the moment a new booking comes in, before any
  // admin manually reassigns it — lets one team member own first response
  // without someone having to notice and assign it by hand.
  defaultAssignee:      { type: Schema.Types.ObjectId, ref: "Admin", default: null },
}, { timestamps: true });

export default mongoose.model("NoidaPricing", noidaPricingSchema);
