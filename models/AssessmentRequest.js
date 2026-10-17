import mongoose from "mongoose";
const { model, Schema } = mongoose;

/* A clinical assessment booked with a session: the client answers it on CYT before the session, the
   server scores it (helper/assessmentTests.js) and the psychologist gets the report.
   sent     — waiting for the client to answer
   done     — answered and scored; the psychologist sees the report, the client doesn't see the score
   released — the psychologist went through it with the client; the client can now see the report
   selfOnly — bought on its own from /self-assessment, no psychologist: the automatic report is released
              to the client as soon as they submit */
const AssessmentRequestSchema = new Schema(
  {
    client: { type: Schema.Types.ObjectId, ref: "User", required: true },
    therapistUser: { type: Schema.Types.ObjectId, ref: "User", default: null },
    therapist: { type: Schema.Types.ObjectId, ref: "Therapists", default: null },
    selfOnly: { type: Boolean, default: false },
    amount: { type: Number, default: null }, // what the client paid (assessment only)
    paymentId: { type: String, default: "" },
    booking: { type: Schema.Types.ObjectId, ref: "Booking", default: null },
    tool: { type: String, required: true },
    status: { type: String, default: "sent" },
    answers: { type: [Number], default: undefined },
    result: { type: Schema.Types.Mixed, default: null }, // { score, max, level, color, text, dims, bars, flag }
    note: { type: String, default: "" }, // the psychologist's summary for the client, shown on release
    notes: { type: Schema.Types.Mixed, default: null }, // { observations, recommendations, followUp, referral }
    signedBy: { type: Schema.Types.Mixed, default: null }, // { name, profileType, regNo } frozen at release
    sentAt: Date, doneAt: Date, releasedAt: Date,
  },
  { timestamps: true }
);
AssessmentRequestSchema.index({ client: 1, createdAt: -1 });
AssessmentRequestSchema.index({ therapistUser: 1, createdAt: -1 });
AssessmentRequestSchema.index({ booking: 1 });

export default model("AssessmentRequest", AssessmentRequestSchema);

// Razorpay order for an assessment bought on its own (no session) — pending → paid once.
const AssessmentOrderSchema = new Schema(
  {
    orderId: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tool: { type: String, required: true },
    amount: { type: Number, required: true }, // rupees
    status: { type: String, enum: ["pending", "paid"], default: "pending" },
    paymentId: { type: String, default: "" },
    request: { type: Schema.Types.ObjectId, ref: "AssessmentRequest", default: null },
  },
  { timestamps: true }
);
export const AssessmentOrder = model("AssessmentOrder", AssessmentOrderSchema);
