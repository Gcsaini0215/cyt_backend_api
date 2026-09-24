import expressAsyncHandler from "express-async-handler";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import OfferLetter from "../models/OfferLetter.js";
import NoidaCounter from "../models/NoidaCounter.js"; // generic atomic counter collection
import { sendMailAdvanced } from "../helper/mailer.js";
import { isValidEmail } from "../helper/isValidMail.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Outside /uploads on purpose (that folder is public): these carry business names, contacts and offers.
const PDF_DIR = path.resolve(__dirname, "..", "private", "offer-letters");
fs.mkdirSync(PDF_DIR, { recursive: true });

// The logo shown in the email header — embedded in the message (cid), so it appears even where remote images are blocked.
const LOGO_PATH = path.resolve(__dirname, "..", "helper", "assets", "email-logo.png");
const LOGO_CID = "cyt-logo";
let LOGO_BUFFER = null;
try { LOGO_BUFFER = fs.readFileSync(LOGO_PATH); } catch { /* no logo file — the header simply shows the name */ }
const PUBLIC_API = (process.env.API_PUBLIC_URL || "https://api.chooseyourtherapist.in/api").replace(/\/$/, "");
const SHARE_LINK_MAX_AGE_MS = 180 * 24 * 3600 * 1000; // download links stop working after 6 months

const REPLY_TO = "Chooseyourtherapist@gmail.com"; // the address printed on the letterhead — replies land here
const STATUSES = ["draft", "sent", "replied", "meeting", "won", "lost"];
const MAX_OFFERINGS = 12;
const MAX_LINES = 20;
const MAX_TO = 5;
const MAX_CC = 3;
const SENDS_PER_HOUR = 30; // per admin — outreach, not a mass-mail tool
const DUPLICATE_WINDOW_MS = 60 * 1000;

const str = (v, max = 2000) => String(v ?? "").trim().slice(0, max);
const oneLine = (v, max = 200) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max); // no header injection
const lines = (v, max = MAX_LINES, each = 500) =>
  (Array.isArray(v) ? v : []).slice(0, max).map((t) => str(t, each)).filter(Boolean);

/* "a@x.com, b@y.com; c@z.com" or an array → unique, valid, lower-cased addresses */
export const parseEmails = (input, max) => {
  const raw = Array.isArray(input) ? input : String(input ?? "").split(/[,;\s]+/);
  const out = [];
  for (const e of raw) {
    const v = String(e).trim().toLowerCase();
    if (v && isValidEmail(v) && v.length <= 254 && !out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
};

const build = (b = {}) => ({
  status: STATUSES.includes(b.status) ? b.status : undefined,
  template: str(b.template, 40),
  date: str(b.date, 10),
  followUpOn: /^\d{4}-\d{2}-\d{2}$/.test(str(b.followUpOn, 10)) ? str(b.followUpOn, 10) : "",
  recipient: {
    business: str(b.recipient?.business, 200),
    contactPerson: str(b.recipient?.contactPerson, 150),
    designation: str(b.recipient?.designation, 150),
    email: str(b.recipient?.email, 300),
    phone: str(b.recipient?.phone, 40),
    address: str(b.recipient?.address, 500),
    industry: str(b.recipient?.industry, 100),
  },
  subject: oneLine(b.subject, 300),
  salutation: oneLine(b.salutation, 150) || "Dear Sir/Madam,",
  opening: str(b.opening, 3000),
  offeringsTitle: oneLine(b.offeringsTitle, 80) || "What we can offer",
  offerings: (Array.isArray(b.offerings) ? b.offerings : [])
    .slice(0, MAX_OFFERINGS)
    .map((o) => ({ title: str(o?.title, 200), description: str(o?.description, 800) }))
    .filter((o) => o.title),
  benefitsTitle: oneLine(b.benefitsTitle, 80) || "Why partner with us",
  benefits: lines(b.benefits),
  offerTitle: oneLine(b.offerTitle, 120),
  offerText: str(b.offerText, 1500),
  nextSteps: str(b.nextSteps, 2000),
  closing: oneLine(b.closing, 80) || "Yours sincerely,",
  signatory: {
    name: str(b.signatory?.name, 120),
    designation: str(b.signatory?.designation, 120),
    phone: str(b.signatory?.phone, 40),
    email: str(b.signatory?.email, 150),
  },
  enclosures: lines(b.enclosures, 10, 200),
  emailMessage: str(b.emailMessage, 3000),
});

const validate = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return "A valid letter date is required.";
  if (!d.recipient.business) return "The business / organisation name is required.";
  if (!d.subject) return "Add a subject line for the letter.";
  return null;
};

const nextNumber = async (dateStr) => {
  const year = (dateStr || "").slice(0, 4) || String(new Date().getFullYear());
  const c = await NoidaCounter.findOneAndUpdate({ _id: `offerletter-${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `CYT-OL-${year}-${String(c.seq).padStart(4, "0")}`;
};

const pdfPathFor = (file) => path.join(PDF_DIR, path.basename(file));
const removePdf = (file) => { if (file) fs.promises.unlink(pdfPathFor(file)).catch(() => {}); };

const fileNameFor = (q) => {
  const company = String(q.recipient?.business || "").replace(/&/g, " and ").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60).replace(/_+$/, "");
  return `${company ? `${company}_` : ""}Offer_Letter_${String(q.number).replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
};

/* POST /api/offer-letters */
export const createOfferLetter = expressAsyncHandler(async (req, res, next) => {
  const data = build(req.body);
  const bad = validate(data);
  if (bad) { res.status(400); return next(new Error(bad)); }
  const number = await nextNumber(data.date);
  const doc = await OfferLetter.create({ ...data, number, status: data.status || "draft", createdBy: req.user._id });
  res.status(201).json({ status: true, message: "Letter saved.", data: doc });
});

/* GET /api/offer-letters?q=&status=&page=&pageSize= */
export const getOfferLetters = expressAsyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const filter = {};
  if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
  const q = String(req.query.q || "").trim().slice(0, 80);
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ number: rx }, { "recipient.business": rx }, { "recipient.contactPerson": rx }, { "recipient.email": rx }, { subject: rx }];
  }
  const [data, total] = await Promise.all([
    OfferLetter.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    OfferLetter.countDocuments(filter),
  ]);
  res.json({ status: true, data, total, page, pageSize });
});

/* GET /api/offer-letters/:id */
export const getOfferLetter = expressAsyncHandler(async (req, res, next) => {
  const doc = await OfferLetter.findById(req.params.id).lean();
  if (!doc) { res.status(404); return next(new Error("Letter not found")); }
  res.json({ status: true, data: doc });
});

/* PUT /api/offer-letters/:id — number and the sent-email history are never overwritten */
export const updateOfferLetter = expressAsyncHandler(async (req, res, next) => {
  const data = build(req.body);
  const bad = validate(data);
  if (bad) { res.status(400); return next(new Error(bad)); }
  if (!data.status) delete data.status;
  const doc = await OfferLetter.findByIdAndUpdate(req.params.id, { $set: data }, { new: true, runValidators: true });
  if (!doc) { res.status(404); return next(new Error("Letter not found")); }
  res.json({ status: true, message: "Letter updated.", data: doc });
});

/* PATCH /api/offer-letters/:id/status  { status?, followUpOn? } */
export const setOfferLetterStatus = expressAsyncHandler(async (req, res, next) => {
  const set = {};
  if (req.body?.status !== undefined) {
    if (!STATUSES.includes(req.body.status)) { res.status(400); return next(new Error("Invalid status")); }
    set.status = req.body.status;
  }
  if (req.body?.followUpOn !== undefined) {
    const v = str(req.body.followUpOn, 10);
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { res.status(400); return next(new Error("Invalid follow-up date")); }
    set.followUpOn = v;
  }
  const doc = await OfferLetter.findByIdAndUpdate(req.params.id, { $set: set }, { new: true });
  if (!doc) { res.status(404); return next(new Error("Letter not found")); }
  res.json({ status: true, data: doc });
});

/* DELETE /api/offer-letters/:id */
export const deleteOfferLetter = expressAsyncHandler(async (req, res, next) => {
  const doc = await OfferLetter.findByIdAndDelete(req.params.id);
  if (!doc) { res.status(404); return next(new Error("Letter not found")); }
  removePdf(doc.pdfFile);
  res.json({ status: true, message: "Letter deleted." });
});

/* POST /api/offer-letters/:id/pdf — multipart "pdf": the exact letter the admin issued */
export const uploadLetterPdfMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
}).single("pdf");

export const saveOfferLetterPdf = expressAsyncHandler(async (req, res, next) => {
  const doc = await OfferLetter.findById(req.params.id);
  if (!doc) { res.status(404); return next(new Error("Letter not found")); }
  const buf = req.file?.buffer;
  if (!buf || buf.length < 100 || buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    res.status(400);
    return next(new Error("A valid PDF file is required."));
  }
  const file = `${doc.number}-${Date.now()}.pdf`;
  await fs.promises.writeFile(pdfPathFor(file), buf);
  const previous = doc.pdfFile;
  doc.pdfFile = file;
  doc.pdfSavedAt = new Date();
  await doc.save();
  removePdf(previous);
  res.json({ status: true, message: "PDF saved.", data: { pdfFile: doc.pdfFile, pdfSavedAt: doc.pdfSavedAt } });
});

/* GET /api/offer-letters/:id/pdf — authenticated download */
export const downloadOfferLetterPdf = expressAsyncHandler(async (req, res, next) => {
  const doc = await OfferLetter.findById(req.params.id).select("number pdfFile recipient.business").lean();
  if (!doc || !doc.pdfFile) { res.status(404); return next(new Error("No saved PDF for this letter yet.")); }
  const full = pdfPathFor(doc.pdfFile);
  if (!fs.existsSync(full)) { res.status(404); return next(new Error("The saved PDF file is missing.")); }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileNameFor(doc)}"`);
  res.setHeader("Cache-Control", "private, no-store");
  fs.createReadStream(full).pipe(res);
});

/* ── email ─────────────────────────────────────────────────────────────── */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const buildEmailHtml = ({ message, q, fileName, downloadUrl = "", hasLogo = false }) => {
  const paras = String(message || "")
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#1e293b;">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const sig = q.signatory || {};
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="background:#ffffff;padding:18px 26px 16px;border-bottom:3px solid #14532d;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
${hasLogo ? `<td width="64" valign="middle" style="padding-right:14px;"><img src="cid:${LOGO_CID}" width="56" alt="Choose Your Therapist" style="display:block;border:0;width:56px;height:auto;"></td>` : ""}
<td valign="middle"><div style="color:#14532d;font-size:18px;font-weight:700;letter-spacing:.5px;">CHOOSE YOUR THERAPIST LLP</div><div style="font-size:12.5px;margin-top:3px;"><a href="https://www.chooseyourtherapist.in" style="color:#14532d;font-weight:700;text-decoration:none;">www.chooseyourtherapist.in</a></div></td>
</tr></table></td></tr>
<tr><td style="height:2px;line-height:2px;font-size:0;background:#d4af37;">&nbsp;</td></tr>
<tr><td style="padding:26px 26px 6px;">${paras}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;background:#f0f7f2;border:1px solid #d5e6dc;border-radius:8px;"><tr><td style="padding:12px 16px;font-size:13.5px;color:#14532d;"><b>Attached:</b> ${downloadUrl ? `<a href="${esc(downloadUrl)}" style="color:#14532d;font-weight:700;text-decoration:underline;">${esc(fileName)}</a>` : esc(fileName)}<br><span style="color:#475569;">Our detailed letter (PDF) — ${esc(q.number)}</span>${downloadUrl ? `<br><a href="${esc(downloadUrl)}" style="display:inline-block;margin-top:10px;background:#14532d;color:#ffffff;text-decoration:none;font-weight:700;font-size:13.5px;padding:9px 18px;border-radius:7px;">Download the letter (PDF)</a>` : ""}</td></tr></table>
<p style="margin:0 0 4px;font-size:15px;color:#1e293b;">${esc(q.closing || "Yours sincerely,")}</p>
<p style="margin:14px 0 0;font-size:15px;font-weight:700;color:#0f2a1d;">${esc(sig.name || "Choose Your Therapist")}</p>
${sig.designation ? `<p style="margin:2px 0 0;font-size:13.5px;color:#475569;">${esc(sig.designation)}</p>` : ""}
<p style="margin:2px 0 0;font-size:13.5px;color:#475569;">Choose Your Therapist LLP${sig.phone ? ` · ${esc(sig.phone)}` : ""}${sig.email ? ` · ${esc(sig.email)}` : ""}</p>
</td></tr>
<tr><td style="padding:16px 26px 22px;"><div style="border-top:1px solid #e2e8f0;padding-top:12px;font-size:11.5px;line-height:1.55;color:#94a3b8;">D-137, near LPS Global School, Block D, Sector 51, Noida, Uttar Pradesh 201301 · +91 80777 57951<br>You are receiving this because we believe our services may be relevant to your organisation. If not, just reply “no thanks” and we won't write again.</div></td></tr>
</table></td></tr></table></body></html>`;
};

export const buildEmailText = ({ message, q, fileName, downloadUrl = "" }) => {
  const sig = q.signatory || {};
  return `${message}\n\nAttached: ${fileName} (${q.number})${downloadUrl ? `\nDownload: ${downloadUrl}` : ""}\n\n${q.closing || "Yours sincerely,"}\n${sig.name || "Choose Your Therapist"}${sig.designation ? `\n${sig.designation}` : ""}\nChoose Your Therapist LLP${sig.phone ? ` | ${sig.phone}` : ""}${sig.email ? ` | ${sig.email}` : ""}\nwww.chooseyourtherapist.in\n\nIf this is not relevant, reply "no thanks" and we won't write again.`;
};

const sendTimes = new Map(); // adminId -> [timestamps within the last hour]
const underHourlyCap = (adminId) => {
  const now = Date.now();
  const list = (sendTimes.get(adminId) || []).filter((t) => now - t < 3600 * 1000);
  if (list.length >= SENDS_PER_HOUR) { sendTimes.set(adminId, list); return false; }
  list.push(now);
  sendTimes.set(adminId, list);
  return true;
};

/* POST /api/offer-letters/:id/send  { to, cc, subject, message, isTest } */
export const sendOfferLetter = expressAsyncHandler(async (req, res, next) => {
  const doc = await OfferLetter.findById(req.params.id);
  if (!doc) { res.status(404); return next(new Error("Letter not found")); }

  const full = doc.pdfFile ? pdfPathFor(doc.pdfFile) : "";
  if (!full || !fs.existsSync(full)) {
    res.status(400);
    return next(new Error("Save the letter first — its PDF is what gets attached to the email."));
  }
  const to = parseEmails(req.body?.to, MAX_TO);
  const cc = parseEmails(req.body?.cc, MAX_CC).filter((e) => !to.includes(e));
  if (!to.length) { res.status(400); return next(new Error("Enter at least one valid recipient email address.")); }

  const isTest = !!req.body?.isTest;
  const subject = oneLine(req.body?.subject, 300) || doc.subject;
  const message = str(req.body?.message ?? doc.emailMessage, 3000);
  if (!subject) { res.status(400); return next(new Error("The email needs a subject.")); }
  if (!message) { res.status(400); return next(new Error("Write a short message for the email body.")); }

  // double-click / retry guard: the same letter to the same address within a minute is almost always a mistake
  const recent = (doc.emails || []).find((e) => e.ok && !e.isTest && !isTest && Date.now() - new Date(e.sentAt).getTime() < DUPLICATE_WINDOW_MS && to.some((t) => (e.to || []).includes(t)));
  if (recent) { res.status(429); return next(new Error("This letter was just sent to that address — wait a minute before sending it again.")); }
  if (!underHourlyCap(String(req.user._id))) {
    res.status(429);
    return next(new Error(`Sending limit reached (${SENDS_PER_HOUR} emails per hour). Please try again later.`));
  }

  const fileName = fileNameFor(doc);
  const content = await fs.promises.readFile(full);
  // one-click download link for the recipient (the PDF is attached as well)
  if (!doc.shareToken || !doc.shareTokenAt || Date.now() - doc.shareTokenAt.getTime() > SHARE_LINK_MAX_AGE_MS) {
    doc.shareToken = crypto.randomBytes(24).toString("hex");
    doc.shareTokenAt = new Date();
  }
  const downloadUrl = `${PUBLIC_API}/offer-letters/download/${doc.shareToken}/${encodeURIComponent(fileName)}`;
  const result = await sendMailAdvanced({
    to,
    cc,
    replyTo: REPLY_TO,
    subject,
    text: buildEmailText({ message, q: doc, fileName, downloadUrl }),
    html: buildEmailHtml({ message, q: doc, fileName, downloadUrl, hasLogo: !!LOGO_BUFFER }),
    fromName: "Choose Your Therapist",
    attachments: [
      { filename: fileName, content, contentType: "application/pdf" },
      ...(LOGO_BUFFER ? [{ filename: "cyt-logo.png", content: LOGO_BUFFER, contentType: "image/png", cid: LOGO_CID, contentDisposition: "inline" }] : []),
    ],
  });

  doc.emails.push({
    to, cc, subject,
    sentAt: new Date(),
    sentBy: String(req.user.name || "").slice(0, 80),
    ok: !!result.success,
    error: result.success ? "" : String(result.error || "").slice(0, 300),
    isTest,
  });
  if (doc.emails.length > 100) doc.emails = doc.emails.slice(-100);
  if (result.success && !isTest && doc.status === "draft") doc.status = "sent";
  await doc.save();

  if (!result.success) { res.status(502); return next(new Error(`The email could not be sent: ${result.error}`)); }
  res.json({ status: true, message: isTest ? "Test email sent." : "Email sent.", data: doc });
});

/* GET /api/offer-letters/download/:token/:name — PUBLIC. The link in the email: one click downloads the PDF.
   The token is 48 random hex characters; the trailing :name only makes the URL end in the file name. */
export const downloadSharedOfferLetter = expressAsyncHandler(async (req, res) => {
  const token = String(req.params.token || "");
  const gone = (code, msg) => res.status(code).type("text/plain").send(msg);
  if (!/^[a-f0-9]{48}$/.test(token)) return gone(404, "This link is not valid.");
  const doc = await OfferLetter.findOne({ shareToken: token }).select("number pdfFile shareTokenAt recipient.business downloadCount");
  if (!doc || !doc.pdfFile) return gone(404, "This link is not valid.");
  if (!doc.shareTokenAt || Date.now() - doc.shareTokenAt.getTime() > SHARE_LINK_MAX_AGE_MS) {
    return gone(410, "This download link has expired. Please ask us to send the letter again.");
  }
  const full = pdfPathFor(doc.pdfFile);
  if (!fs.existsSync(full)) return gone(404, "The file is no longer available.");
  await OfferLetter.updateOne({ _id: doc._id }, { $inc: { downloadCount: 1 }, $set: { lastDownloadedAt: new Date() } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileNameFor(doc)}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  fs.createReadStream(full).pipe(res);
});
