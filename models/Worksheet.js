import mongoose from "mongoose";
const { Schema } = mongoose;

/* Therapist Toolkit worksheets (CBT ABCD thought log first).
   WorksheetLink  — a therapist's shareable link (/worksheet/<code>): whoever opens it sees the worksheet with that
                    therapist's name and a Book button that books THAT therapist.
   WorksheetEntry — one person's filled worksheet, kept in their client dashboard. Private to the client and the
                    therapist it came from; the therapist sees the answers only once the client sends it. */

const worksheetLinkSchema = new Schema(
  {
    code: { type: String, required: true, unique: true }, // short, in the URL
    tool: { type: String, required: true, default: "abcd" },
    therapist: { type: Schema.Types.ObjectId, ref: "Therapists", required: true },
    therapistUser: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    note: { type: String, default: "", maxlength: 300 }, // shown on top of the worksheet ("fill this when …")
    forClient: { type: Schema.Types.ObjectId, ref: "User", default: null }, // sent straight to one client
    opens: { type: Number, default: 0 },
    starts: { type: Number, default: 0 },
    bookClicks: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const worksheetEntrySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tool: { type: String, required: true, default: "abcd" },
    link: { type: Schema.Types.ObjectId, ref: "WorksheetLink", default: null },
    therapist: { type: Schema.Types.ObjectId, ref: "Therapists", default: null },
    therapistUser: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    note: { type: String, default: "" }, // the therapist's note, copied when it starts
    data: { type: Object, default: {} },
    step: { type: Number, default: 0 },
    status: { type: String, enum: ["assigned", "draft", "submitted", "reviewed"], default: "draft" },
    submittedAt: { type: Date, default: null },
    feedback: { type: String, default: "", maxlength: 2000 },
    reviewedAt: { type: Date, default: null },
    flag: { type: Boolean, default: false }, // words about self-harm — the therapist is alerted, the client sees Tele-MANAS
  },
  { timestamps: true }
);
worksheetEntrySchema.index({ user: 1, updatedAt: -1 });
worksheetEntrySchema.index({ therapistUser: 1, status: 1, updatedAt: -1 });

export const WorksheetLink = mongoose.model("WorksheetLink", worksheetLinkSchema);
export const WorksheetEntry = mongoose.model("WorksheetEntry", worksheetEntrySchema);
