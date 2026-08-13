import mongoose from "mongoose";
const { Schema } = mongoose;

const probonoReviewSchema = new Schema(
  {
    probono_intern_id: {
      type: Schema.Types.ObjectId,
      ref: "ProbonoIntern",
      required: true,
    },
    name: { type: String, required: true },
    email: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    description: { type: String, required: true },
  },
  { timestamps: true }
);

export default mongoose.model("ProbonoReview", probonoReviewSchema);
