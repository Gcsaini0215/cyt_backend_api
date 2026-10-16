import mongoose from "mongoose";
import { LICENSED_TOOLS } from "./TherapistLicence.js";
const { model, Schema } = mongoose;

/* A licensed questionnaire a client takes with a licensed psychologist, before their session.
   intent   — the client tapped "Book" for this questionnaire; becomes "sent" when the booking is paid
   sent     — the client can open the psychologist's licensed form
   done     — the client says they've filled it in
   scored   — the psychologist recorded the score (hidden from the client)
   released — the psychologist went through it with the client; the client can now see the score */
const AssessmentRequestSchema = new Schema(
  {
    client: { type: Schema.Types.ObjectId, ref: "User", required: true },
    therapistUser: { type: Schema.Types.ObjectId, ref: "User", required: true },
    therapist: { type: Schema.Types.ObjectId, ref: "Therapists", required: true },
    booking: { type: Schema.Types.ObjectId, ref: "Booking", default: null },
    tool: { type: String, required: true, enum: LICENSED_TOOLS },
    status: { type: String, enum: ["intent", "sent", "done", "scored", "released"], default: "intent" },
    score: { type: Number, default: null },
    max: { type: Number, default: null },
    level: { type: String, default: "" },
    note: { type: String, default: "" }, // the psychologist's note to the client, shown on release
    sentAt: Date, doneAt: Date, scoredAt: Date, releasedAt: Date,
  },
  { timestamps: true }
);
AssessmentRequestSchema.index({ client: 1, createdAt: -1 });
AssessmentRequestSchema.index({ therapistUser: 1, createdAt: -1 });
AssessmentRequestSchema.index({ booking: 1 });

export default model("AssessmentRequest", AssessmentRequestSchema);
