import mongoose from "mongoose";
const { model, Schema } = mongoose;

/* Prices for clinical assessments and the therapist add-on, set in the admin panel (one document,
   key "default"). Any test without a row uses the default fee from helper/assessmentTests.js.
   An offer applies while offerPrice is set and offerTill is empty or still ahead. */
const TestPriceSchema = new Schema(
  {
    tool: { type: String, required: true },
    fee: { type: Number, required: true, min: 0 },
    offerPrice: { type: Number, default: null, min: 0 },
    offerLabel: { type: String, default: "" },
    offerTill: { type: Date, default: null },
    active: { type: Boolean, default: true }, // off = can't be booked
  },
  { _id: false }
);

const AssessmentPricingSchema = new Schema(
  {
    key: { type: String, default: "default", unique: true },
    tests: { type: [TestPriceSchema], default: [] },
    addonPrice: { type: Number, default: null, min: 0 },
    addonOfferPrice: { type: Number, default: null, min: 0 },
    addonOfferLabel: { type: String, default: "" },
    addonOfferTill: { type: Date, default: null },
    therapistShare: { type: Number, default: null, min: 0, max: 1 },
    couponsPrice: { type: Number, default: null, min: 0 }, // therapist "Coupons" upgrade, one-time (null = ₹399)
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export default model("AssessmentPricing", AssessmentPricingSchema);
