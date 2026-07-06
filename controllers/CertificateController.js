import { sendMail } from "../helper/mailer.js";

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

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 0">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10)">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0d4a28,#1a6b3a,#228756);padding:32px 36px">
          <div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.3px">Choose Your Therapist</div>
          <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px">www.chooseyourtherapist.in</div>
        </td></tr>

        <!-- Congratulations banner -->
        <tr><td style="background:#f0fdf4;padding:20px 36px;border-bottom:1.5px solid #dcfce7;text-align:center">
          <div style="font-size:13px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:1.5px">🎓 Certificate Issued</div>
          <div style="font-size:26px;font-weight:800;color:#0f172a;margin-top:6px">${certLabel}</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 36px">
          <div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:12px">Dear ${recipientName},</div>
          <div style="font-size:14px;color:#475569;line-height:1.9;margin-bottom:20px">
            Congratulations! We are pleased to issue your <strong>${certLabel}</strong> from
            <strong>Choose Your Therapist LLP</strong>.
          </div>

          <!-- Certificate Details Box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;margin-bottom:24px">
            <tr><td style="padding:20px 24px">
              <div style="font-size:11px;font-weight:800;color:#228756;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px">Certificate Details</div>
              <table width="100%" cellpadding="0" cellspacing="0">
                ${certNumber ? `<tr>
                  <td style="font-size:13px;color:#64748b;padding:5px 0;width:140px">Certificate No.</td>
                  <td style="font-size:13px;font-weight:700;color:#0f172a;padding:5px 0">${certNumber}</td>
                </tr>` : ""}
                ${role ? `<tr>
                  <td style="font-size:13px;color:#64748b;padding:5px 0">Role / Designation</td>
                  <td style="font-size:13px;font-weight:700;color:#0f172a;padding:5px 0">${role}</td>
                </tr>` : ""}
                ${startDate ? `<tr>
                  <td style="font-size:13px;color:#64748b;padding:5px 0">Start Date</td>
                  <td style="font-size:13px;font-weight:700;color:#0f172a;padding:5px 0">${startDate}</td>
                </tr>` : ""}
                ${endDate ? `<tr>
                  <td style="font-size:13px;color:#64748b;padding:5px 0">End Date</td>
                  <td style="font-size:13px;font-weight:700;color:#0f172a;padding:5px 0">${endDate}</td>
                </tr>` : ""}
                <tr>
                  <td style="font-size:13px;color:#64748b;padding:5px 0">Organization</td>
                  <td style="font-size:13px;font-weight:700;color:#0f172a;padding:5px 0">Choose Your Therapist LLP</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <div style="font-size:14px;color:#475569;line-height:1.9;margin-bottom:28px">
            It was a pleasure having you associated with us. We truly appreciate your dedication,
            professionalism, and the commitment you brought to your work. We wish you continued
            growth and success in your professional journey.
          </div>

          <!-- Note -->
          <div style="background:#fffbeb;border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:28px;font-size:13px;color:#92400e;line-height:1.7">
            📎 <strong>Note:</strong> Your physical/digital certificate has been generated. Please contact
            <a href="mailto:hello@chooseyourtherapist.in" style="color:#228756">hello@chooseyourtherapist.in</a>
            if you need any changes or a duplicate copy.
          </div>

          <div style="border-top:1.5px solid #f1f5f9;padding-top:20px;font-size:13px;color:#94a3b8;line-height:1.8">
            With warm regards,<br>
            <span style="font-weight:700;color:#0f172a">Mr. Deepak Kumar</span><br>
            <span style="color:#475569">Director, Psychologist</span><br>
            <span style="color:#475569">Choose Your Therapist LLP</span>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f0fdf4;border-top:1.5px solid #dcfce7;padding:18px 36px;text-align:center">
          <div style="font-size:12px;color:#64748b;line-height:1.8">
            📞 +91-8077757951 &nbsp;·&nbsp;
            <a href="mailto:hello@chooseyourtherapist.in" style="color:#228756;text-decoration:none">hello@chooseyourtherapist.in</a>
            &nbsp;·&nbsp;
            <a href="https://chooseyourtherapist.in" style="color:#228756;text-decoration:none">chooseyourtherapist.in</a>
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

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
