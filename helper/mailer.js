import nodemailer from "nodemailer";
import { reminderCheckinMail } from "../services/mailTemplates.js";
import EmailSuppression from "../models/EmailSuppression.js";

/* ── blocked addresses (admin → Content → Blocked emails) ──
   Every send below drops these from to/cc. Cached for a minute; the admin API clears the cache on change. */
let blocked = { set: null, at: 0 };
export const clearBlockedCache = () => { blocked = { set: null, at: 0 }; };
async function blockedSet() {
  if (blocked.set && Date.now() - blocked.at < 60000) return blocked.set;
  try {
    const rows = await EmailSuppression.find({}).select("email").lean();
    blocked = { set: new Set(rows.map((r) => String(r.email).toLowerCase())), at: Date.now() };
  } catch (e) {
    blocked = { set: blocked.set || new Set(), at: Date.now() }; // DB hiccup: never block sending because of it
  }
  return blocked.set;
}
const splitAddrs = (v) => (Array.isArray(v) ? v : String(v || "").split(","))
  .map((a) => String(a?.address || a || "").trim()).filter(Boolean);
const bare = (a) => { const m = String(a).match(/<([^>]+)>/); return (m ? m[1] : a).trim().toLowerCase(); };
// → { to, cc, dropped } with blocked addresses removed
async function withoutBlocked(to, cc) {
  const set = await blockedSet();
  if (!set.size) return { to, cc, dropped: [] };
  const dropped = [];
  const keep = (list) => list.filter((a) => (set.has(bare(a)) ? (dropped.push(bare(a)), false) : true));
  const t = keep(splitAddrs(to));
  const c = cc ? keep(splitAddrs(cc)) : cc;
  if (dropped.length) console.log("mail: skipped blocked address(es):", dropped.join(", "));
  return { to: t.join(", "), cc: Array.isArray(c) ? c : c, dropped };
}

const gmailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const zohoTransporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.ZOHO_EMAIL,
    pass: process.env.ZOHO_PASS,
  },
  // fail fast with a readable error instead of hanging the admin's request until the proxy times out
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 60000,
});

export const sendMail = async (to, subject, text, html, fromName = "CYT Team", attachments = []) => {
  try {
    ({ to } = await withoutBlocked(to));
    if (!to) return false;
    const info = await zohoTransporter.sendMail({
      from: `"${fromName}" <hello@chooseyourtherapist.in>`,
      to,
      subject,
      text,
      html,
      attachments,
    });
    console.log("Email sent: %s", info.messageId);
    return true;
  } catch (error) {
    console.error("sendMail error:", error.message, error.code, error.response);
    return false;
  }
};

// Same as sendMail but resolves { success, error } so bulk senders can log failure reasons per recipient.
export const sendMailWithReason = async (to, subject, text, html, fromName = "CYT Team", attachments = []) => {
  try {
    ({ to } = await withoutBlocked(to));
    if (!to) return { success: false, error: "This address is on the Blocked emails list (bounced / wrong address)." };
    const info = await zohoTransporter.sendMail({
      from: `"${fromName}" <hello@chooseyourtherapist.in>`,
      to,
      subject,
      text,
      html,
      attachments,
    });
    console.log("Email sent: %s", info.messageId);
    return { success: true };
  } catch (error) {
    console.error("sendMail error:", error.message, error.code, error.response);
    return { success: false, error: error.message };
  }
};

// Full-featured sender for one-to-one outreach (cc, reply-to, attachments); resolves the SMTP result instead of just true/false.
export const sendMailAdvanced = async ({ to, cc, replyTo, subject, text, html, fromName = "CYT Team", attachments = [] }) => {
  try {
    ({ to, cc } = await withoutBlocked(to, cc));
    if (!to) return { success: false, error: "This address is on the Blocked emails list (bounced / wrong address).", rejected: [] };
    const info = await zohoTransporter.sendMail({
      from: `"${fromName}" <hello@chooseyourtherapist.in>`,
      to,
      cc: cc && cc.length ? cc : undefined,
      replyTo,
      subject,
      text,
      html,
      attachments,
    });
    const rejected = info.rejected || [];
    const accepted = info.accepted || [];
    console.log("Email sent: %s (accepted %d, rejected %d)", info.messageId, accepted.length, rejected.length);
    // the SMTP server can refuse every address without throwing — that is not a success
    if (!accepted.length) return { success: false, error: `The mail server refused the address(es): ${rejected.join(", ") || "unknown"}`, rejected };
    return { success: true, messageId: info.messageId, rejected };
  } catch (error) {
    console.error("sendMailAdvanced error:", error.message, error.code, error.response);
    return { success: false, error: error.message };
  }
};

export const sendReminderMail = async (to, clientName, customNote) => {
  const firstName = clientName ? clientName.split(" ")[0] : "there";
  const subject = `A gentle check-in from Choose Your Therapist 💚`;
  const html = reminderCheckinMail({ firstName, customNote });

  const text = `Hi ${firstName},\n\nWe hope you're doing well! It's been a while since your last session and we wanted to check in.\n\n${customNote || ""}\n\nBook your next session: https://chooseyourtherapist.in\n\nWarm regards,\nChoose Your Therapist Team\n+91-8077757951 | hello@chooseyourtherapist.in`;

  try {
    ({ to } = await withoutBlocked(to));
    if (!to) return false;
    const info = await zohoTransporter.sendMail({
      from: `"Choose Your Therapist" <hello@chooseyourtherapist.in>`,
      to,
      subject,
      text,
      html,
    });
    console.log("Reminder sent:", info.messageId);
    return true;
  } catch (error) {
    console.error("Reminder email error:", error);
    return false;
  }
};
