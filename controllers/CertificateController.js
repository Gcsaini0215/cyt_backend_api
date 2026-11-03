import crypto from "crypto";
import expressAsyncHandler from "express-async-handler";
import QRCode from "qrcode";
import { sendMail } from "../helper/mailer.js";
import { certificateIssuedMail } from "../services/mailTemplates.js";
import IssuedCertificate from "../models/IssuedCertificate.js";
import NoidaCounter from "../models/NoidaCounter.js";

const SITE = "https://www.chooseyourtherapist.in";
const TYPES = {
  internship: { prefix: "INT", label: "Internship Completion Certificate" },
  experience: { prefix: "EXP", label: "Experience Certificate" },
  lor: { prefix: "LOR", label: "Letter of Recommendation" },
};
const FIELDS = ["salutation", "name", "role", "hours", "startDate", "endDate", "issueDate", "signatoryName", "signatoryDesignation", "email", "phone"];

const clip = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const isDay = (v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

// 8 characters people can read off paper: no 0/O, 1/I/L
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHA[crypto.randomInt(ALPHA.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
};
const uniqueCode = async () => {
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    if (!(await IssuedCertificate.exists({ code }))) return code;
  }
  throw new Error("Couldn't make a certificate code");
};

const verifyUrl = (code) => `${SITE}/verify-certificate/${code}`;
const withQr = async (c) => ({
  ...c,
  verifyUrl: verifyUrl(c.code),
  qr: await QRCode.toDataURL(verifyUrl(c.code), { margin: 0, width: 360, errorCorrectionLevel: "M", color: { dark: "#14532d", light: "#ffffff" } }),
});

// the fields an admin may set, cleaned; a bad date or missing name returns an error message
const readBody = (b, partial = false) => {
  const out = {};
  for (const k of FIELDS) if (!partial || b[k] !== undefined) out[k] = clip(b[k], k === "role" ? 160 : 120);
  if (!partial || b.name !== undefined) if (!out.name) return { error: "Enter the full name" };
  for (const k of ["startDate", "endDate", "issueDate"]) if (out[k] !== undefined && !isDay(out[k])) return { error: "Dates must be YYYY-MM-DD" };
  if (out.startDate && out.endDate && out.startDate > out.endDate) return { error: "The end date is before the start date" };
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) return { error: "That email doesn't look right" };
  return { data: out };
};

/* GET /admin/certificates?q=&type= — newest first */
export const listCertificates = expressAsyncHandler(async (req, res) => {
  const find = {};
  if (TYPES[req.query.type]) find.type = req.query.type;
  const q = clip(req.query.q, 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (q) find.$or = [{ name: new RegExp(q, "i") }, { certNumber: new RegExp(q, "i") }, { email: new RegExp(q, "i") }, { code: new RegExp(q, "i") }];
  const data = await IssuedCertificate.find(find).sort({ createdAt: -1 }).limit(1000).lean();
  res.json({ status: true, data: data.map((c) => ({ ...c, verifyUrl: verifyUrl(c.code) })) });
});

/* GET /admin/certificates/:id — one, with its QR */
export const getCertificate = expressAsyncHandler(async (req, res) => {
  const c = await IssuedCertificate.findById(req.params.id).lean().catch(() => null);
  if (!c) return res.status(404).json({ status: false, message: "Certificate not found" });
  res.json({ status: true, data: await withQr(c) });
});

/* POST /admin/certificates — issue: gives the next number for the type and year, and a verify code */
export const issueCertificate = expressAsyncHandler(async (req, res) => {
  const type = TYPES[req.body.type] ? req.body.type : null;
  if (!type) return res.status(400).json({ status: false, message: "Choose the certificate type" });
  const { data, error } = readBody(req.body);
  if (error) return res.status(400).json({ status: false, message: error });
  data.issueDate = data.issueDate || data.endDate || todayIST();
  const year = data.issueDate.slice(0, 4);
  const ctr = await NoidaCounter.findOneAndUpdate({ _id: `cert-${TYPES[type].prefix}-${year}` }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  const c = await IssuedCertificate.create({
    ...data, type, code: await uniqueCode(),
    certNumber: `CYT/${TYPES[type].prefix}/${year}/${String(ctr.seq).padStart(4, "0")}`,
    issuedBy: req.user?.name || req.user?.email || "",
  });
  res.json({ status: true, message: `Issued ${c.certNumber}`, data: await withQr(c.toObject()) });
});

/* PATCH /admin/certificates/:id — fix details (number and code stay), or revoke / restore */
export const updateCertificate = expressAsyncHandler(async (req, res) => {
  const { data, error } = readBody(req.body, true);
  if (error) return res.status(400).json({ status: false, message: error });
  if (typeof req.body.revoked === "boolean") {
    data.revoked = req.body.revoked;
    data.revokedReason = req.body.revoked ? clip(req.body.revokedReason, 300) : "";
  }
  const c = await IssuedCertificate.findByIdAndUpdate(req.params.id, { $set: data }, { new: true }).lean().catch(() => null);
  if (!c) return res.status(404).json({ status: false, message: "Certificate not found" });
  res.json({ status: true, message: data.revoked === true ? "Revoked — the verify page now says so" : data.revoked === false ? "Restored" : "Saved", data: await withQr(c) });
});

/* POST /admin/certificates/import — the old list kept only in one browser; numbers kept, new verify codes */
export const importCertificates = expressAsyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body.entries) ? req.body.entries.slice(0, 500) : [];
  let added = 0, skipped = 0;
  for (const r of rows) {
    const certNumber = clip(r.certNumber, 60);
    const name = clip(r.name, 120);
    const type = /lor|recommend/i.test(r.type) ? "lor" : /intern/i.test(r.type) ? "internship" : "experience";
    if (!certNumber || !name || await IssuedCertificate.exists({ certNumber })) { skipped++; continue; }
    await IssuedCertificate.create({
      certNumber, name, type, code: await uniqueCode(), legacy: true,
      role: clip(r.role, 160), startDate: isDay(r.startDate) ? clip(r.startDate) : "", endDate: isDay(r.endDate) ? clip(r.endDate) : "",
      issueDate: isDay(r.endDate) ? clip(r.endDate) : "", issuedBy: req.user?.name || "",
    });
    added++;
  }
  res.json({ status: true, message: `${added} moved${skipped ? `, ${skipped} skipped (already there or no number)` : ""}`, added, skipped });
});

/* GET /certificates/verify/:code — public: what a college sees after scanning the QR */
export const verifyCertificate = expressAsyncHandler(async (req, res) => {
  const raw = String(req.params.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const code = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : "";
  const c = code ? await IssuedCertificate.findOne({ code }).lean() : null;
  if (!c) return res.status(404).json({ status: false, message: "No certificate with this code." });
  res.json({
    status: true,
    data: {
      code: c.code, certNumber: c.certNumber, type: c.type, typeLabel: TYPES[c.type].label,
      name: [c.salutation, c.name].filter(Boolean).join(" "), role: c.role, hours: c.hours,
      startDate: c.startDate, endDate: c.endDate, issueDate: c.issueDate || (c.createdAt && new Date(c.createdAt).toISOString().slice(0, 10)),
      signatoryName: c.signatoryName, signatoryDesignation: c.signatoryDesignation,
      revoked: !!c.revoked, revokedReason: c.revoked ? c.revokedReason : "",
    },
  });
});

/* POST /certificate/send-email — the PDF made in admin, mailed to the person */
export const sendCertificateEmail = async (req, res) => {
  try {
    const { recipientEmail, recipientName, certNumber, certType, startDate, endDate, role, pdfBase64, certId } = req.body;

    if (!recipientEmail || !recipientName) {
      return res.status(400).json({ message: "recipientEmail and recipientName are required" });
    }

    const attachments = pdfBase64
      ? [{ filename: `${certType === "lor" ? "letter" : "certificate"}_${recipientName}.pdf`, content: pdfBase64, encoding: "base64" }]
      : [];

    const certLabel = (TYPES[certType] || TYPES.experience).label;
    const subject = `Your ${certLabel} — Choose Your Therapist`;
    const c = certId ? await IssuedCertificate.findById(certId).lean().catch(() => null) : null;

    const html = certificateIssuedMail({
      recipientName,
      certLabel,
      certNumber,
      role,
      startDate,
      endDate,
      verifyLink: c ? verifyUrl(c.code) : "",
    });

    const sent = await sendMail(recipientEmail, subject, "", html, "Choose Your Therapist", attachments);
    if (sent) {
      if (c) await IssuedCertificate.updateOne({ _id: c._id }, { $set: { emailedAt: new Date(), email: String(recipientEmail).toLowerCase().trim() } });
      res.json({ success: true, message: "Certificate email sent successfully" });
    } else {
      res.status(500).json({ success: false, message: "Failed to send email" });
    }
  } catch (err) {
    console.error("sendCertificateEmail error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
