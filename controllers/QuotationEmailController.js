import expressAsyncHandler from "express-async-handler";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import Quotation from "../models/Quotation.js";
import { pdfPathFor } from "./QuotationController.js";
import { parseEmails } from "./OfferLetterController.js";
import { sendMailAdvanced } from "../helper/mailer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The logo in the email header is the public site's emblem, referenced by URL — so it is not a separate attachment.
const LOGO_URL = "https://www.chooseyourtherapist.in/cyt-emblem.png";

const PUBLIC_API = (process.env.API_PUBLIC_URL || "https://api.chooseyourtherapist.in/api").replace(/\/$/, "");
const SHARE_LINK_MAX_AGE_MS = 180 * 24 * 3600 * 1000; // download links stop working after 6 months
const REPLY_TO = "Chooseyourtherapist@gmail.com";
const MAX_TO = 5;
const MAX_CC = 3;
const SENDS_PER_HOUR = 30;
const DUPLICATE_WINDOW_MS = 60 * 1000;

const str = (v, max = 2000) => String(v ?? "").trim().slice(0, max);
const oneLine = (v, max = 200) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max); // no header injection
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

// same naming as the admin app: <Company>_Quotation_<Number>.pdf
export const fileNameFor = (q) => {
  const company = String(q.client?.name || "").replace(/&/g, " and ").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60).replace(/_+$/, "");
  return `${company ? `${company}_` : ""}Quotation_${String(q.number).replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
};

export const buildEmailHtml = ({ message, q, fileName, downloadUrl = "", hasLogo = false }) => {
  const paras = String(message || "")
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1e293b;text-align:justify;">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const by = q.preparedBy || {};
  const total = q.totals?.grandTotal;
  const rows = [
    ["Quotation no.", esc(q.number)],
    ...(total || total === 0 ? [["Amount", `INR ${esc(inr(total))}${Number(q.gstPercent) > 0 ? " (incl. GST)" : ""}`]] : []),
    ...(q.validUntil && fmtDate(q.validUntil) ? [["Valid until", esc(fmtDate(q.validUntil))]] : []),
  ]
    .map(([k, v]) => `<tr><td style="padding:3px 18px 3px 0;font-size:13px;color:#475569;">${k}</td><td style="padding:3px 0;font-size:13.5px;font-weight:700;color:#0f2a1d;">${v}</td></tr>`)
    .join("");
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f6f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="background:#ffffff;padding:16px 22px 14px;border-bottom:3px solid #14532d;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
${hasLogo ? `<td width="58" valign="middle" style="padding-right:12px;"><img src="${LOGO_URL}" width="50" alt="Choose Your Therapist" style="display:block;border:0;width:50px;height:auto;"></td>` : ""}
<td valign="middle"><div style="color:#14532d;font-size:14px;font-weight:700;letter-spacing:.2px;white-space:nowrap;">CHOOSE YOUR THERAPIST LLP</div><div style="font-size:12.5px;margin-top:3px;"><a href="https://www.chooseyourtherapist.in" style="color:#14532d;font-weight:700;text-decoration:none;">WWW.CHOOSEYOURTHERAPIST.IN</a></div></td>
</tr></table></td></tr>
<tr><td style="height:2px;line-height:2px;font-size:0;background:#d4af37;">&nbsp;</td></tr>
<tr><td style="padding:26px 26px 6px;">${paras}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;background:#f0f7f2;border:1px solid #d5e6dc;border-radius:8px;"><tr><td style="padding:14px 16px;">
<div style="font-size:11px;font-weight:700;letter-spacing:1.2px;color:#14532d;margin-bottom:6px;">QUOTATION</div>
<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
<div style="margin-top:12px;font-size:13.5px;color:#14532d;"><b>Attached:</b> ${downloadUrl ? `<a href="${esc(downloadUrl)}" style="color:#14532d;font-weight:700;text-decoration:underline;">${esc(fileName)}</a>` : esc(fileName)}</div>
${downloadUrl ? `<a href="${esc(downloadUrl)}" style="display:inline-block;margin-top:10px;background:#14532d;color:#ffffff;text-decoration:none;font-weight:700;font-size:13.5px;padding:9px 18px;border-radius:7px;">Download the quotation (PDF)</a>` : ""}
</td></tr></table>
<p style="margin:0 0 4px;font-size:15px;color:#1e293b;">Warm regards,</p>
<p style="margin:14px 0 0;font-size:15px;font-weight:700;color:#0f2a1d;">${esc(by.name || "Choose Your Therapist")}</p>
${by.designation ? `<p style="margin:2px 0 0;font-size:13.5px;color:#475569;">${esc(by.designation)}</p>` : ""}
<p style="margin:2px 0 0;font-size:13.5px;color:#475569;">Choose Your Therapist LLP · +91 80777 57951 · hello@chooseyourtherapist.in</p>
</td></tr>
<tr><td style="padding:16px 26px 22px;"><div style="border-top:1px solid #e2e8f0;padding-top:12px;font-size:11.5px;line-height:1.55;color:#94a3b8;">D-137, Block D, Sector 51, Noida, Uttar Pradesh 201301 · +91 80777 57951<br>You are receiving this because a quotation was prepared for you by Choose Your Therapist LLP. Just reply to this email if you have any questions.</div></td></tr>
</table></td></tr></table></body></html>`;
};

export const buildEmailText = ({ message, q, fileName, downloadUrl = "" }) => {
  const by = q.preparedBy || {};
  const total = q.totals?.grandTotal;
  return `${message}\n\nQuotation no.: ${q.number}${total || total === 0 ? `\nAmount: INR ${inr(total)}${Number(q.gstPercent) > 0 ? " (incl. GST)" : ""}` : ""}${q.validUntil && fmtDate(q.validUntil) ? `\nValid until: ${fmtDate(q.validUntil)}` : ""}\nAttached: ${fileName}${downloadUrl ? `\nDownload: ${downloadUrl}` : ""}\n\nWarm regards,\n${by.name || "Choose Your Therapist"}${by.designation ? `\n${by.designation}` : ""}\nChoose Your Therapist LLP | +91 80777 57951 | hello@chooseyourtherapist.in\nwww.chooseyourtherapist.in`;
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

/* POST /api/quotations/:id/send  { to, cc, subject, message, isTest } */
export const sendQuotation = expressAsyncHandler(async (req, res, next) => {
  const doc = await Quotation.findById(req.params.id);
  if (!doc) { res.status(404); return next(new Error("Quotation not found")); }

  const full = doc.pdfFile ? pdfPathFor(doc.pdfFile) : "";
  if (!full || !fs.existsSync(full)) {
    res.status(400);
    return next(new Error("Save the quotation first — its PDF is what gets attached to the email."));
  }
  const to = parseEmails(req.body?.to, MAX_TO);
  const cc = parseEmails(req.body?.cc, MAX_CC).filter((e) => !to.includes(e));
  if (!to.length) { res.status(400); return next(new Error("Enter at least one valid recipient email address.")); }

  const isTest = !!req.body?.isTest;
  const subject = oneLine(req.body?.subject, 300) || `Quotation ${doc.number} — Choose Your Therapist LLP`;
  const message = str(req.body?.message, 3000);
  if (!message) { res.status(400); return next(new Error("Write a short message for the email body.")); }

  // double-click / retry guard
  const recent = (doc.emails || []).find((e) => e.ok && !e.isTest && !isTest && Date.now() - new Date(e.sentAt).getTime() < DUPLICATE_WINDOW_MS && to.some((t) => (e.to || []).includes(t)));
  if (recent) { res.status(429); return next(new Error("This quotation was just sent to that address — wait a minute before sending it again.")); }
  if (!underHourlyCap(String(req.user._id))) {
    res.status(429);
    return next(new Error(`Sending limit reached (${SENDS_PER_HOUR} emails per hour). Please try again later.`));
  }

  const fileName = fileNameFor(doc);
  const content = await fs.promises.readFile(full);
  if (!doc.shareToken || !doc.shareTokenAt || Date.now() - doc.shareTokenAt.getTime() > SHARE_LINK_MAX_AGE_MS) {
    doc.shareToken = crypto.randomBytes(24).toString("hex");
    doc.shareTokenAt = new Date();
  }
  const downloadUrl = `${PUBLIC_API}/quotations/download/${doc.shareToken}/${encodeURIComponent(fileName)}`;
  const result = await sendMailAdvanced({
    to,
    cc,
    replyTo: REPLY_TO,
    subject,
    text: buildEmailText({ message, q: doc, fileName, downloadUrl }),
    html: buildEmailHtml({ message, q: doc, fileName, downloadUrl, hasLogo: true }),
    fromName: "Choose Your Therapist",
    attachments: [
      { filename: fileName, content, contentType: "application/pdf" },
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
  const skipped = (result.rejected || []).length ? ` (not accepted by the mail server: ${result.rejected.join(", ")})` : "";
  res.json({ status: true, message: `${isTest ? "Test email sent." : "Email sent."}${skipped}`, data: doc });
});

/* GET /api/quotations/download/:token/:name — PUBLIC. The link in the email: one click downloads the PDF.
   The token is 48 random hex characters; the trailing :name only makes the URL end in the file name. */
export const downloadSharedQuotation = expressAsyncHandler(async (req, res) => {
  const token = String(req.params.token || "");
  const gone = (code, msg) => res.status(code).type("text/plain").send(msg);
  if (!/^[a-f0-9]{48}$/.test(token)) return gone(404, "This link is not valid.");
  const doc = await Quotation.findOne({ shareToken: token }).select("number pdfFile shareTokenAt client.name");
  if (!doc || !doc.pdfFile) return gone(404, "This link is not valid.");
  if (!doc.shareTokenAt || Date.now() - doc.shareTokenAt.getTime() > SHARE_LINK_MAX_AGE_MS) {
    return gone(410, "This download link has expired. Please ask us to send the quotation again.");
  }
  const full = pdfPathFor(doc.pdfFile);
  if (!fs.existsSync(full)) return gone(404, "The file is no longer available.");
  await Quotation.updateOne({ _id: doc._id }, { $inc: { downloadCount: 1 }, $set: { lastDownloadedAt: new Date() } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fileNameFor(doc)}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  fs.createReadStream(full).pipe(res);
});
