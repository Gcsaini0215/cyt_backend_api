import mongoose from "mongoose";
const { Schema, model } = mongoose;

/* One row per therapist per day (IST) — how their public profile is doing.
   views: profile opened · visitors: different people (by a browser id) · impressions: their card shown
   in the directory / search · book / contact / share: clicks on the profile · sources: where views came from. */
const ProfileStatSchema = new Schema(
  {
    therapist: { type: Schema.Types.ObjectId, ref: "Therapists", required: true },
    day: { type: String, required: true }, // YYYY-MM-DD, India time
    views: { type: Number, default: 0 },
    visitors: { type: Number, default: 0 },
    impressions: { type: Number, default: 0 },
    book: { type: Number, default: 0 },
    contact: { type: Number, default: 0 },
    share: { type: Number, default: 0 },
    sources: {
      google: { type: Number, default: 0 },
      directory: { type: Number, default: 0 },
      home: { type: Number, default: 0 },
      city: { type: Number, default: 0 },
      blog: { type: Number, default: 0 },
      social: { type: Number, default: 0 },
      direct: { type: Number, default: 0 },
      other: { type: Number, default: 0 },
    },
  },
  { timestamps: false }
);
ProfileStatSchema.index({ therapist: 1, day: 1 }, { unique: true });
ProfileStatSchema.index({ day: 1 });

export default model("ProfileStat", ProfileStatSchema);
