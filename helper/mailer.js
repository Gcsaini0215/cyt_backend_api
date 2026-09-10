import nodemailer from "nodemailer";
import { reminderCheckinMail } from "../services/mailTemplates.js";

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
});

export const sendMail = async (to, subject, text, html, fromName = "CYT Team", attachments = []) => {
  try {
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

export const sendReminderMail = async (to, clientName, customNote) => {
  const firstName = clientName ? clientName.split(" ")[0] : "there";
  const subject = `A gentle check-in from Choose Your Therapist 💚`;
  const html = reminderCheckinMail({ firstName, customNote });

  const text = `Hi ${firstName},\n\nWe hope you're doing well! It's been a while since your last session and we wanted to check in.\n\n${customNote || ""}\n\nBook your next session: https://chooseyourtherapist.in\n\nWarm regards,\nChoose Your Therapist Team\n+91-8077757951 | hello@chooseyourtherapist.in`;

  try {
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
