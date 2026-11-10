import mongoose from "mongoose";
const { Schema } = mongoose;

// A therapist's Google Business Profile ("psychologist near me" on Google Maps), set up with the
// step-by-step guide on the therapist dashboard (site /therapists/google-listing). Only for therapists
// with a real clinic. CYT tracks the status; the listing itself belongs to the therapist on Google.
const googleListingSchema = new Schema(
  {
    therapist: { type: Schema.Types.ObjectId, ref: "Therapists", required: true, unique: true },
    status: { type: String, enum: ["not-started", "in-progress", "submitted", "verified", "live"], default: "not-started" },
    mapsUrl: { type: String, default: "" }, // their listing on Google Maps
    note: { type: String, default: "" },    // admin note
  },
  { timestamps: true }
);

export default mongoose.model("GoogleListing", googleListingSchema);
