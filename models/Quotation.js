import mongoose from "mongoose";
const { Schema } = mongoose;

const itemSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    qty: { type: Number, default: 1, min: 0 },
    unit: { type: String, default: "" }, // e.g. "session", "month", "workshop"
    rate: { type: Number, default: 0, min: 0 }, // rupees per unit
  },
  { _id: false }
);

const quotationSchema = new Schema(
  {
    number: { type: String, required: true, unique: true, trim: true }, // CYT-QT-2026-0001
    status: { type: String, enum: ["draft", "sent", "accepted", "declined", "expired"], default: "draft" },
    date: { type: String, required: true }, // YYYY-MM-DD
    validUntil: { type: String, default: "" },
    subject: { type: String, default: "", trim: true },
    reference: { type: String, default: "", trim: true },
    client: {
      name: { type: String, required: true, trim: true },
      contactPerson: { type: String, default: "" },
      designation: { type: String, default: "" },
      address: { type: String, default: "" },
      phone: { type: String, default: "" },
      email: { type: String, default: "" },
      gstin: { type: String, default: "" },
    },
    items: { type: [itemSchema], default: [] },
    discountType: { type: String, enum: ["none", "percent", "flat"], default: "none" },
    discountValue: { type: Number, default: 0, min: 0 },
    gstPercent: { type: Number, default: 0, min: 0, max: 100 },
    scope: { type: String, default: "" },
    terms: { type: [String], default: [] },
    paymentInstructions: { type: String, default: "" },
    notes: { type: String, default: "" },
    preparedBy: {
      name: { type: String, default: "" },
      designation: { type: String, default: "" },
    },
    // Recomputed on the server on every save — the PDF and the list both trust these, never the browser.
    totals: {
      subtotal: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      taxable: { type: Number, default: 0 },
      gst: { type: Number, default: 0 },
      grandTotal: { type: Number, default: 0 },
    },
    // The exact PDF that was issued, kept privately on the server (not under the public /uploads folder).
    pdfFile: { type: String, default: "" },
    pdfSavedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "Admin" },
  },
  { timestamps: true }
);

quotationSchema.index({ createdAt: -1 });
quotationSchema.index({ "client.name": 1 });

export default mongoose.model("Quotation", quotationSchema);
