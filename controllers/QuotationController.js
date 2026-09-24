import expressAsyncHandler from "express-async-handler";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Quotation from "../models/Quotation.js";
import NoidaCounter from "../models/NoidaCounter.js"; // generic atomic counter collection

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Outside /uploads on purpose: that folder is served publicly; quotations carry client details and prices.
const PDF_DIR = path.resolve(__dirname, "..", "private", "quotations");
fs.mkdirSync(PDF_DIR, { recursive: true });

const MAX_ITEMS = 60;
const MAX_TERMS = 30;
const STATUSES = ["draft", "sent", "accepted", "declined", "expired"];

const str = (v, max = 2000) => String(v ?? "").trim().slice(0, max);
const num = (v, min = 0, max = 1e9) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
};
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export const computeTotals = (items, discountType, discountValue, gstPercent) => {
  const subtotal = round2(items.reduce((s, it) => s + it.qty * it.rate, 0));
  let discount = 0;
  if (discountType === "percent") discount = (subtotal * Math.min(100, discountValue)) / 100;
  else if (discountType === "flat") discount = Math.min(subtotal, discountValue);
  discount = round2(discount);
  const taxable = round2(subtotal - discount);
  const gst = round2((taxable * gstPercent) / 100);
  return { subtotal, discount, taxable, gst, grandTotal: round2(taxable + gst) };
};

// Whitelist + sanitise everything from the browser; totals are recomputed here.
const build = (b = {}) => {
  const items = (Array.isArray(b.items) ? b.items : [])
    .slice(0, MAX_ITEMS)
    .map((it) => ({
      title: str(it?.title, 200),
      description: str(it?.description, 1000),
      qty: num(it?.qty, 0, 1e6),
      unit: str(it?.unit, 30),
      rate: num(it?.rate, 0, 1e9),
    }))
    .filter((it) => it.title);
  const discountType = ["none", "percent", "flat"].includes(b.discountType) ? b.discountType : "none";
  const discountValue = discountType === "none" ? 0 : num(b.discountValue, 0, 1e9);
  const gstPercent = num(b.gstPercent, 0, 100);
  return {
    status: STATUSES.includes(b.status) ? b.status : undefined,
    date: str(b.date, 10),
    validUntil: str(b.validUntil, 10),
    subject: str(b.subject, 300),
    reference: str(b.reference, 200),
    client: {
      name: str(b.client?.name, 200),
      contactPerson: str(b.client?.contactPerson, 150),
      designation: str(b.client?.designation, 150),
      address: str(b.client?.address, 500),
      phone: str(b.client?.phone, 40),
      email: str(b.client?.email, 150),
      gstin: str(b.client?.gstin, 20).toUpperCase(),
    },
    items,
    discountType,
    discountValue,
    gstPercent,
    scope: str(b.scope, 4000),
    terms: (Array.isArray(b.terms) ? b.terms : []).slice(0, MAX_TERMS).map((t) => str(t, 500)).filter(Boolean),
    paymentInstructions: str(b.paymentInstructions, 1500),
    notes: str(b.notes, 1500),
    preparedBy: { name: str(b.preparedBy?.name, 120), designation: str(b.preparedBy?.designation, 120) },
    totals: computeTotals(items, discountType, discountValue, gstPercent),
  };
};

const validate = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return "A valid quotation date is required.";
  if (!d.client.name) return "Client / organisation name is required.";
  if (!d.items.length) return "Add at least one line item.";
  return null;
};

const nextNumber = async (dateStr) => {
  const year = (dateStr || "").slice(0, 4) || String(new Date().getFullYear());
  const c = await NoidaCounter.findOneAndUpdate({ _id: `quotation-${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `CYT-QT-${year}-${String(c.seq).padStart(4, "0")}`;
};

const pdfPathFor = (file) => path.join(PDF_DIR, path.basename(file)); // basename: never trust a stored path
const removePdf = (file) => {
  if (file) fs.promises.unlink(pdfPathFor(file)).catch(() => {});
};

/* POST /api/quotations */
export const createQuotation = expressAsyncHandler(async (req, res, next) => {
  const data = build(req.body);
  const bad = validate(data);
  if (bad) {
    res.status(400);
    return next(new Error(bad));
  }
  const number = await nextNumber(data.date);
  const q = await Quotation.create({ ...data, number, status: data.status || "draft", createdBy: req.user._id });
  res.status(201).json({ status: true, message: "Quotation saved.", data: q });
});

/* GET /api/quotations?q=&status=&page=&pageSize= */
export const getQuotations = expressAsyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const filter = {};
  if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ number: rx }, { "client.name": rx }, { subject: rx }, { reference: rx }];
  }
  const [data, total] = await Promise.all([
    Quotation.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Quotation.countDocuments(filter),
  ]);
  res.json({ status: true, data, total, page, pageSize });
});

/* GET /api/quotations/:id */
export const getQuotation = expressAsyncHandler(async (req, res, next) => {
  const q = await Quotation.findById(req.params.id).lean();
  if (!q) {
    res.status(404);
    return next(new Error("Quotation not found"));
  }
  res.json({ status: true, data: q });
});

/* PUT /api/quotations/:id — the number is never changed */
export const updateQuotation = expressAsyncHandler(async (req, res, next) => {
  const data = build(req.body);
  const bad = validate(data);
  if (bad) {
    res.status(400);
    return next(new Error(bad));
  }
  if (!data.status) delete data.status;
  const q = await Quotation.findByIdAndUpdate(req.params.id, { $set: data }, { new: true, runValidators: true });
  if (!q) {
    res.status(404);
    return next(new Error("Quotation not found"));
  }
  res.json({ status: true, message: "Quotation updated.", data: q });
});

/* PATCH /api/quotations/:id/status */
export const setQuotationStatus = expressAsyncHandler(async (req, res, next) => {
  if (!STATUSES.includes(req.body?.status)) {
    res.status(400);
    return next(new Error("Invalid status"));
  }
  const q = await Quotation.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status } }, { new: true });
  if (!q) {
    res.status(404);
    return next(new Error("Quotation not found"));
  }
  res.json({ status: true, data: q });
});

/* DELETE /api/quotations/:id */
export const deleteQuotation = expressAsyncHandler(async (req, res, next) => {
  const q = await Quotation.findByIdAndDelete(req.params.id);
  if (!q) {
    res.status(404);
    return next(new Error("Quotation not found"));
  }
  removePdf(q.pdfFile);
  res.json({ status: true, message: "Quotation deleted." });
});

/* POST /api/quotations/:id/pdf — multipart, field "pdf". Stores the exact PDF the admin issued. */
export const uploadPdfMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
}).single("pdf");

export const saveQuotationPdf = expressAsyncHandler(async (req, res, next) => {
  const q = await Quotation.findById(req.params.id);
  if (!q) {
    res.status(404);
    return next(new Error("Quotation not found"));
  }
  const buf = req.file?.buffer;
  // extension/mimetype are client-controlled, so check the file's own signature
  if (!buf || buf.length < 100 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    res.status(400);
    return next(new Error("A valid PDF file is required."));
  }
  const file = `${q.number}-${Date.now()}.pdf`;
  await fs.promises.writeFile(pdfPathFor(file), buf);
  const previous = q.pdfFile;
  q.pdfFile = file;
  q.pdfSavedAt = new Date();
  await q.save();
  removePdf(previous);
  res.json({ status: true, message: "PDF saved.", data: { pdfFile: q.pdfFile, pdfSavedAt: q.pdfSavedAt } });
});

/* GET /api/quotations/:id/pdf — authenticated download of the saved PDF */
export const downloadQuotationPdf = expressAsyncHandler(async (req, res, next) => {
  const q = await Quotation.findById(req.params.id).select("number pdfFile").lean();
  if (!q || !q.pdfFile) {
    res.status(404);
    return next(new Error("No saved PDF for this quotation yet."));
  }
  const full = pdfPathFor(q.pdfFile);
  if (!fs.existsSync(full)) {
    res.status(404);
    return next(new Error("The saved PDF file is missing."));
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${q.number}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  fs.createReadStream(full).pipe(res);
});
