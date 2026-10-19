import mongoose from "mongoose";
const { Schema, model } = mongoose;

/* One collaboration / outreach email sent from the admin (Outreach Email page). `data` is the form as
   typed (re-opened with "Use again"); the HTML is rebuilt from it, so it isn't stored. */
const OutreachEmailSchema = new Schema(
  {
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    subject: { type: String, default: "" },
    preset: { type: String, default: "general" },
    organisation: { type: String, default: "" },
    data: { type: Schema.Types.Mixed, default: {} },
    test: { type: Boolean, default: false }, // a test copy to the admin's own inbox
    status: { type: String, enum: ["sent", "failed"], default: "sent" },
    error: { type: String, default: "" },
    messageId: { type: String, default: "" },
    sentBy: { type: String, default: "" },
  },
  { timestamps: true }
);
OutreachEmailSchema.index({ createdAt: -1 });

export default model("OutreachEmail", OutreachEmailSchema);
