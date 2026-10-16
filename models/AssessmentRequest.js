import mongoose from "mongoose";
const { model, Schema } = mongoose;

/* A clinical assessment booked with a session: the client answers it on CYT before the session, the
   server scores it (helper/assessmentTests.js) and the psychologist gets the report.
   sent     — waiting for the client to answer
   done     — answered and scored; the psychologist sees the report, the client doesn't see the score
   released — the psychologist went through it with the client; the client can now see the report */
const AssessmentRequestSchema = new Schema(
  {
    client: { type: Schema.Types.ObjectId, ref: "User", required: true },
    therapistUser: { type: Schema.Types.ObjectId, ref: "User", required: true },
    therapist: { type: Schema.Types.ObjectId, ref: "Therapists", required: true },
    booking: { type: Schema.Types.ObjectId, ref: "Booking", default: null },
    tool: { type: String, required: true },
    status: { type: String, default: "sent" },
    answers: { type: [Number], default: undefined },
    result: { type: Schema.Types.Mixed, default: null }, // { score, max, level, color, text, dims, bars, flag }
    note: { type: String, default: "" }, // the psychologist's note to the client, shown on release
    sentAt: Date, doneAt: Date, releasedAt: Date,
  },
  { timestamps: true }
);
AssessmentRequestSchema.index({ client: 1, createdAt: -1 });
AssessmentRequestSchema.index({ therapistUser: 1, createdAt: -1 });
AssessmentRequestSchema.index({ booking: 1 });

export default model("AssessmentRequest", AssessmentRequestSchema);
