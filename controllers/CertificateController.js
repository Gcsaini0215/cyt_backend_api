import { sendMail } from "../helper/mailer.js";

export const sendCertificateEmail = async (req, res) => {
  try {
    const { recipientEmail, recipientName, certNumber, certType, startDate, endDate, role, htmlContent } = req.body;

    if (!recipientEmail || !recipientName || !htmlContent) {
      return res.status(400).json({ message: "recipientEmail, recipientName and htmlContent are required" });
    }

    const subject = `Your ${certType === "internship" ? "Internship Completion" : "Experience"} Certificate — Choose Your Therapist`;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 0">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
        <tr><td style="background:linear-gradient(135deg,#0d4a28,#1a6b3a,#228756);padding:28px 36px">
          <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.3px">Choose Your Therapist</div>
          <div style="color:rgba(255,255,255,0.65);font-size:12px;margin-top:4px">Certificate of ${certType === "internship" ? "Internship Completion" : "Experience"}</div>
        </td></tr>
        <tr><td style="padding:32px 36px">
          <div style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:16px">Dear ${recipientName},</div>
          <div style="font-size:15px;color:#475569;line-height:1.8;margin-bottom:20px">
            Please find your <strong>${certType === "internship" ? "Internship Completion Certificate" : "Experience Certificate"}</strong> attached below.
            ${certNumber ? `<br>Certificate No: <strong>${certNumber}</strong>` : ""}
          </div>
          <div style="font-size:14px;color:#475569;line-height:1.8;margin-bottom:24px">
            It was a pleasure having you associated with <strong>Choose Your Therapist LLP</strong>${role ? ` as <strong>${role}</strong>` : ""}.
            ${startDate && endDate ? `Your tenure was from <strong>${startDate}</strong> to <strong>${endDate}</strong>.` : ""}
            We wish you all the best in your future endeavours.
          </div>
          <div style="background:#f0fdf4;border-left:3px solid #228756;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:28px;font-size:13px;color:#374151;line-height:1.7">
            Your certificate is embedded below. You may save or print it for your records.
          </div>
          <!-- Embedded Certificate -->
          <div style="border:2px solid #e2e8f0;border-radius:8px;padding:8px;margin-bottom:24px;overflow:auto;">
            ${htmlContent}
          </div>
          <div style="border-top:1.5px solid #f1f5f9;padding-top:20px;font-size:13px;color:#94a3b8;line-height:1.7">
            With warm regards,<br>
            <span style="font-weight:700;color:#475569">Choose Your Therapist Team</span>
          </div>
        </td></tr>
        <tr><td style="background:#f0fdf4;border-top:1.5px solid #dcfce7;padding:16px 36px;text-align:center">
          <div style="font-size:12px;color:#64748b">
            📞 +91-8077757951 &nbsp;·&nbsp; ✉ hello@chooseyourtherapist.in &nbsp;·&nbsp; chooseyourtherapist.in
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const sent = await sendMail(recipientEmail, subject, "", html, "Choose Your Therapist");
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
