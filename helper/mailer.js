import nodemailer from "nodemailer";

const gmailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: "chooseyourtherapist@gmail.com",
    pass: "thboznmqzpnwcpln",
  },
});

const zohoTransporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.ZOHO_EMAIL,
    pass: process.env.ZOHO_PASS,
  },
});

export const sendMail = async (to, subject, text, html, fromName = "CYT Team") => {
  try {
    const info = await zohoTransporter.sendMail({
      from: `"${fromName}" <hello@chooseyourtherapist.in>`,
      to,
      subject,
      text,
      html,
    });
    console.log("Email sent: %s", info.messageId);
    return true;
  } catch (error) {
    console.error("sendMail error:", error.message, error.code, error.response);
    return false;
  }
};

export const sendReminderMail = async (to, clientName, customNote) => {
  const firstName = clientName ? clientName.split(" ")[0] : "there";
  const subject = `A gentle check-in from Choose Your Therapist 💚`;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0d4a28,#1a6b3a,#228756);padding:28px 36px">
          <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.3px">Choose Your Therapist</div>
          <div style="color:rgba(255,255,255,0.65);font-size:12px;margin-top:4px">Your well-being is our priority</div>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 36px">
          <div style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:16px">Hi ${firstName} 👋</div>
          <div style="font-size:14px;color:#475569;line-height:1.8;margin-bottom:14px">
            We hope you're doing well! It's been a while since your last session, and we wanted to take a moment to check in and see how you're getting on.
          </div>
          <div style="font-size:14px;color:#475569;line-height:1.8;margin-bottom:24px">
            Consistency in therapy makes a real difference in your journey. We'd love to continue supporting you whenever you're ready.
          </div>
          ${customNote ? `<div style="background:#f0fdf4;border-left:3px solid #228756;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:24px;font-size:13px;color:#374151;line-height:1.7">${customNote}</div>` : ""}
          <!-- CTA -->
          <div style="text-align:center;margin-bottom:28px">
            <a href="https://chooseyourtherapist.in" style="display:inline-block;background:linear-gradient(135deg,#1a6b3a,#228756);color:#fff;text-decoration:none;border-radius:10px;padding:14px 36px;font-weight:700;font-size:14px;box-shadow:0 4px 14px rgba(34,135,86,0.35)">
              Book Your Next Session
            </a>
          </div>
          <div style="border-top:1.5px solid #f1f5f9;padding-top:20px;font-size:13px;color:#94a3b8;line-height:1.7">
            With warm regards,<br>
            <span style="font-weight:700;color:#475569">Choose Your Therapist Team</span>
          </div>
        </td></tr>
        <!-- Footer -->
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

  const text = `Hi ${firstName},\n\nWe hope you're doing well! It's been a while since your last session and we wanted to check in.\n\n${customNote || ""}\n\nBook your next session: https://chooseyourtherapist.in\n\nWarm regards,\nChoose Your Therapist Team\n+91-8077757951 | hello@chooseyourtherapist.in`;

  try {
    const info = await zohoTransporter.sendMail({
      from: `"Choose Your Therapist" <${process.env.ZOHO_EMAIL}>`,
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
