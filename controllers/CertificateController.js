import { sendMail } from "../helper/mailer.js";
import { certificateIssuedMail } from "../services/mailTemplates.js";

export const sendCertificateEmail = async (req, res) => {
  try {
    const { recipientEmail, recipientName, certNumber, certType, startDate, endDate, role, pdfBase64 } = req.body;

    if (!recipientEmail || !recipientName) {
      return res.status(400).json({ message: "recipientEmail and recipientName are required" });
    }

    const attachments = pdfBase64
      ? [{ filename: `certificate_${recipientName}.pdf`, content: pdfBase64, encoding: "base64" }]
      : [];

    const certLabel = certType === "internship" ? "Internship Completion Certificate" : "Experience Certificate";
    const subject = `Your ${certLabel} — Choose Your Therapist`;

    const html = certificateIssuedMail({
      recipientName,
      certLabel,
      certNumber,
      role,
      startDate,
      endDate,
    });

    const sent = await sendMail(recipientEmail, subject, "", html, "Choose Your Therapist", attachments);
    if (sent) {
      res.json({ success: true, message: "Certificate email sent successfully" });
    } else {
      res.status(500).json({ success: false, message: "Failed to send email" });
    }
  } catch (err) {
    console.error("sendCertificateEmail error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
