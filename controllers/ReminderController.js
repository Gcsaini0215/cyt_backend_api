import { sendReminderMail } from "../helper/mailer.js";

export const sendFollowUpReminder = async (req, res) => {
  const { to, clientName, customNote } = req.body;
  if (!to || !clientName) {
    return res.status(400).json({ success: false, message: "to and clientName are required" });
  }
  const ok = await sendReminderMail(to, clientName, customNote || "");
  if (ok) {
    res.json({ success: true, message: "Reminder sent successfully" });
  } else {
    res.status(500).json({ success: false, message: "Failed to send email. Check SMTP credentials." });
  }
};
