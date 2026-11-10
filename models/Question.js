import mongoose from "mongoose";
const { Schema } = mongoose;

// "Ask a psychologist": a client's anonymous question, answered by a verified CYT therapist.
// The asker's identity never leaves the backend. A question goes public only if the asker allowed it
// AND an admin published it (admin can edit the public wording to strip anything identifying).
const questionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true }, // asker (client) — never shown publicly
    category: { type: String, default: "other" },
    body: { type: String, required: true }, // the question as asked
    context: { ageRange: { type: String, default: "" }, gender: { type: String, default: "" } },
    allowPublish: { type: Boolean, default: false },
    urgent: { type: Boolean, default: false }, // crisis words found — helplines shown, never published
    status: { type: String, enum: ["open", "answered", "closed"], default: "open" },
    claimedBy: { type: Schema.Types.ObjectId, ref: "Therapists", default: null }, // therapist writing an answer
    claimedAt: { type: Date, default: null },
    answer: {
      text: { type: String, default: "" },
      therapist: { type: Schema.Types.ObjectId, ref: "Therapists", default: null },
      at: { type: Date, default: null },
    },
    // public copy (admin-reviewed)
    published: { type: Boolean, default: false },
    publishedAt: { type: Date, default: null },
    slug: { type: String, default: undefined },
    publicTitle: { type: String, default: "" },
    publicBody: { type: String, default: "" },
    publicAnswer: { type: String, default: "" },
    hidden: { type: Boolean, default: false }, // admin removed it (spam / not suitable)
    helpful: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
  },
  { timestamps: true }
);

questionSchema.index({ slug: 1 }, { unique: true, sparse: true });
questionSchema.index({ published: 1, publishedAt: -1 });
questionSchema.index({ status: 1, createdAt: -1 });
questionSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("Question", questionSchema);
