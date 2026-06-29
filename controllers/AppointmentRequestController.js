import AppointmentRequest from "../models/AppointmentRequest.js";
import { sendMail } from "../helper/mailer.js";

export const createAppointmentRequest = async (req, res) => {
  try {
    const { name, phone, email, concern, preferredTime, message, therapistId, therapistName } = req.body;
    if (!name || !phone) return res.status(400).json({ success: false, message: "Name and phone are required." });
    const doc = await AppointmentRequest.create({ name, phone, email: email || "", concern, preferredTime, message, therapistId: therapistId || "", therapistName: therapistName || "" });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getAppointmentRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const docs = await AppointmentRequest.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: docs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateAppointmentRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, confirmedTime, adminNote } = req.body;
    const doc = await AppointmentRequest.findByIdAndUpdate(
      id,
      { status, confirmedTime, adminNote },
      { new: true, lean: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });

    if (doc.email && (status === "confirmed" || status === "rescheduled")) {
      const firstName = doc.name.split(" ")[0];
      const isConfirmed = status === "confirmed";
      const subject = isConfirmed
        ? `Your appointment is confirmed — ${confirmedTime || "details below"}`
        : `Your appointment has been rescheduled — ${confirmedTime || "details below"}`;

      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:560px">
        <tr><td style="background:linear-gradient(135deg,#0d4a28,#1a6b3a,#228756);padding:28px 36px">
          <div style="color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.3px">Choose Your Therapist</div>
          <div style="color:rgba(255,255,255,0.65);font-size:12px;margin-top:4px">Mental Health &amp; Wellness Clinic</div>
        </td></tr>
        <tr><td style="padding:32px 36px">
          <div style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:6px">Hi ${firstName}!</div>
          <div style="font-size:14px;color:#475569;line-height:1.8;margin-bottom:20px">
            ${isConfirmed
              ? "Great news — your appointment has been <strong style='color:#15803d'>confirmed</strong>. We look forward to seeing you!"
              : "Your appointment has been <strong style='color:#2563eb'>rescheduled</strong>. Please note the updated time below."}
          </div>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px">
            ${confirmedTime ? `<tr>
              <td style="padding:12px 18px;border-bottom:1px solid #e2e8f0">
                <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">${isConfirmed ? "Confirmed Time" : "New Time"}</div>
                <div style="font-size:15px;font-weight:700;color:#0f172a">${confirmedTime}</div>
              </td>
            </tr>` : ""}
            ${doc.concern ? `<tr>
              <td style="padding:12px 18px;border-bottom:1px solid #e2e8f0">
                <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">Concern</div>
                <div style="font-size:14px;color:#374151">${doc.concern}</div>
              </td>
            </tr>` : ""}
            <tr>
              <td style="padding:12px 18px">
                <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:3px">Your Phone</div>
                <div style="font-size:14px;color:#374151">${doc.phone}</div>
              </td>
            </tr>
          </table>

          ${adminNote ? `<div style="background:#f0fdf4;border-left:3px solid #228756;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:24px;font-size:13px;color:#374151;line-height:1.7">${adminNote}</div>` : ""}

          <div style="font-size:13px;color:#64748b;line-height:1.7;margin-bottom:24px">
            If you have any questions or need to reschedule, please reach out to us on WhatsApp at <strong>+91-8077757951</strong> or reply to this email.
          </div>

          <div style="border-top:1.5px solid #f1f5f9;padding-top:20px;font-size:13px;color:#94a3b8;line-height:1.7">
            With warm regards,<br>
            <span style="font-weight:700;color:#475569">Choose Your Therapist Team</span>
          </div>
        </td></tr>
        <tr><td style="background:#f0fdf4;border-top:1.5px solid #dcfce7;padding:16px 36px;text-align:center">
          <div style="font-size:12px;color:#64748b">
            📞 +91-8077757951 &nbsp;·&nbsp; ✉ chooseyourtherapist@gmail.com &nbsp;·&nbsp; chooseyourtherapist.in
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

      const text = `Hi ${firstName},\n\n${isConfirmed ? "Your appointment is confirmed" : "Your appointment has been rescheduled"}.\n\n${confirmedTime ? `Time: ${confirmedTime}\n` : ""}${doc.concern ? `Concern: ${doc.concern}\n` : ""}${adminNote ? `\nNote: ${adminNote}\n` : ""}\nFor any changes, WhatsApp us at +91-8077757951.\n\nWarm regards,\nChoose Your Therapist Team`;

      sendMail(doc.email, subject, text, html).catch(() => {});
    }

    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
