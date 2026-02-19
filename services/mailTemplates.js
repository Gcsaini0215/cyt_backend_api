export const therapistSessionMail = ({
    therapistName,
    clientName,
    clientAge,
    paymentAmount,
    transactionId,
}) => {
    return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Session Assigned</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        color: #333;
        line-height: 1.6;
      }
      .container {
        max-width: 600px;
        margin: auto;
        padding: 20px;
        border: 1px solid #eee;
        border-radius: 8px;
        background: #fafafa;
      }
      h2 {
        color: #4CAF50;
      }
      ul {
        padding-left: 20px;
      }
      .footer {
        margin-top: 20px;
        font-size: 14px;
        color: #555;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <p>Dear <strong>${therapistName}</strong>,</p>
      <p>A session has been assigned to you. Kindly review the details below:</p>

      <h2>Client Information:</h2>
      <ul>
        <li><strong>Full Name:</strong> ${clientName}</li>
        <li><strong>Age:</strong> ${clientAge}</li>
        <li><strong>Payment:</strong> ₹${paymentAmount}</li>
        <li><strong>Transaction ID:</strong> ${transactionId}</li>
      </ul>

      <h2>Important Instructions:</h2>
      <ul>
        <li>Log in to your dashboard and verify the transaction.</li>
        <li>View client details directly from the dashboard before the session.</li>
        <li>At the start, collect the client’s PIN and update it in your dashboard.</li>
        <li>After completing the session, please click on the “End” button to submit it.</li>
      </ul>

      <p>Thank you for your continued support and professionalism.</p>

      <div class="footer">
        <p>Warm regards,<br/>
        <strong>Choose Your Therapist LLP</strong><br/>
        Support Team</p>
      </div>
    </div>
  </body>
  </html>
  `;
};


export const bookingConfirmationMail = ({
    clientName,
    therapistName,
    clientAge,
    transactionId,
    pin
}) => {
    return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Booking Confirmation</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        color: #333;
        line-height: 1.6;
      }
      .container {
        max-width: 600px;
        margin: auto;
        padding: 20px;
        border: 1px solid #eee;
        border-radius: 8px;
        background: #fafafa;
      }
      h2 {
        color: #4CAF50;
      }
      ul {
        padding-left: 20px;
      }
      ol {
        padding-left: 20px;
      }
      .footer {
        margin-top: 20px;
        font-size: 14px;
        color: #555;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <p>Dear <strong>${clientName}</strong>,</p>
      <p>Your therapy session has been successfully booked. Please find your session details below:</p>

      <h2>Booking Details:</h2>
      <ul>
        <li><strong>Therapist:</strong> ${therapistName}</li>
        <li><strong>Your Full Name:</strong> ${clientName}</li>
        <li><strong>Age:</strong> ${clientAge || "-"}</li>
        <li><strong>Transaction ID:</strong> ${transactionId}</li>
      </ul>
      <p>Share this PIN with your therapist when you start the session.</p>
      <div style="margin:8px 0 16px 0; display:inline-block; padding:14px 18px; border:1px dashed #94a3b8; border-radius:10px; font-family:Consolas, Menlo, Monaco, monospace; font-size:20px; letter-spacing:3px; font-weight:700; color:#111827; background:#f8fafc;">
        ${pin}
      </div>

      <h2>Important Instructions for You:</h2>
      <ol>
        <li>Log in to your dashboard to check the booking and verify your payment status.</li>
        <li>You will find a unique PIN number in your dashboard. Please share this PIN with your therapist at the beginning of your session.</li>
        <li>Your therapist will update the session details once it is completed.</li>
      </ol>

      <p>If you face any issues with your booking or dashboard, feel free to reach out to our support team.</p>

      <div class="footer">
        <p>Warm regards,<br/>
        <strong>Choose Your Therapist LLP</strong><br/>
        Support Team</p>
      </div>
    </div>
  </body>
  </html>
  `;
};



export const newSessionAdminMail = ({
    clientName,
    clientAge,
    paymentAmount,
    transactionId,
    therapistName,
    therapistId,
}) => {
    return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>New Session Booked</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        color: #333;
        line-height: 1.6;
      }
      .container {
        max-width: 600px;
        margin: auto;
        padding: 20px;
        border: 1px solid #eee;
        border-radius: 8px;
        background: #fafafa;
      }
      h2 {
        color: #4CAF50;
      }
      ul {
        padding-left: 20px;
      }
      .footer {
        margin-top: 20px;
        font-size: 14px;
        color: #555;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <p>Dear <strong>Choose Your Therapist Team</strong>,</p>
      <p>A new session has been booked on the platform. Below are the details for your reference:</p>

      <h2>Client Information:</h2>
      <ul>
        <li><strong>Full Name:</strong> ${clientName}</li>
        <li><strong>Age:</strong> ${clientAge}</li>
        <li><strong>Payment Status:</strong> ₹${paymentAmount}</li>
        <li><strong>Transaction ID:</strong> ${transactionId}</li>
      </ul>

      <h2>Therapist Information:</h2>
      <ul>
        <li><strong>Name:</strong> ${therapistName}</li>
        <li><strong>Therapist ID Code:</strong> ${therapistId}</li>
      </ul>

      <p>Thank you,</p>

      <div class="footer">
        <p><strong>Choose Your Therapist LLP</strong><br/>
        Support Team</p>
      </div>
    </div>
  </body>
  </html>
  `;
};


export const therapistText = (isBookingDetail,transactionId) => `
Dear ${isBookingDetail.therapist.user.name},

A session has been assigned to you.
Client: ${isBookingDetail.client.name}, Age: ${isBookingDetail.client.age || "N/A"}
Payment: ₹${isBookingDetail.amount}, Transaction ID: ${transactionId}

Check your dashboard for details and update session status after completion.

Choose Your Therapist LLP
Support Team
`;

export const clientText = (isBookingDetail,transactionId) => `
Dear ${isBookingDetail.client.name},

Your session with ${isBookingDetail.therapist.user.name} has been booked.
Payment: ₹${isBookingDetail.amount}, Transaction ID: ${transactionId}

Check your dashboard for your PIN and session details.

Choose Your Therapist LLP
Support Team
`;

export const adminText = (isBookingDetail,transactionId) => `
New session booked:

Client: ${isBookingDetail.client.name}, Age: ${isBookingDetail.client.age || "N/A"}
Payment: ₹${isBookingDetail.amount}, Transaction ID: ${transactionId}

Therapist: ${isBookingDetail.therapist.user.name}, ID: ${isBookingDetail.therapist._id}

Choose Your Therapist LLP
Support Team
`;


export const therapistVerificationEmail = (name = "Therapist", otp = "123456") => `
<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <title>Therapist Registration OTP</title>
  <style>
    @media (prefers-color-scheme: dark) {
      body, table, .bg-body { background-color:#0b0f14 !important; color:#e6eaef !important; }
      .card { background-color:#111827 !important; border-color:#1f2937 !important; }
      .muted { color:#9aa4b2 !important; }
      .btn { background:#2563eb !important; color:#ffffff !important; }
    }
    @media only screen and (max-width: 600px) {
      .container { width:100% !important; padding:0 16px !important; }
      .card { padding:20px !important; }
      h1 { font-size:22px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:#f4f6f8;" class="bg-body">
  <div style="display:none; overflow:hidden; line-height:1px; opacity:0; max-height:0; max-width:0;">
    Your OTP for verification is ${otp}. Complete your registration with Choose Your Therapist.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f6f8; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" class="container" style="width:600px; max-width:600px;">
          <tr>
            <td align="left" style="padding:0 24px 16px 24px; font-family:Arial, Helvetica, sans-serif;">
              <div style="font-size:14px; color:#64748b;">Choose Your Therapist LLP</div>
              <div style="font-size:24px; font-weight:700; color:#0f172a;">Support Team</div>
            </td>
          </tr>

          <tr>
            <td style="padding:0 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" style="background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; padding:28px;">
                <tr>
                  <td style="font-family:Arial, Helvetica, sans-serif; color:#0f172a;">
                    <h1 style="margin:0 0 12px 0; font-size:20px; line-height:1.3;">Dear ${name},</h1>

                    <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6;">
                      Thank you for registering with us as a therapist.
                    </p>

                    <p style="margin:0 0 8px 0; font-size:14px; color:#64748b;">Your One-Time Password (OTP) for verification is:</p>

                    <div style="margin:8px 0 16px 0; display:inline-block; padding:14px 18px; border:1px dashed #94a3b8; border-radius:10px; font-family:Consolas, Menlo, Monaco, monospace; font-size:20px; letter-spacing:3px; font-weight:700; color:#111827; background:#f8fafc;">
                      ${otp}
                    </div>

                    <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6;">
                      Please use this OTP to complete your registration process.
                    </p>

                    <ul style="margin:0 0 16px 24px; padding:0; font-size:14px; line-height:1.6; color:#0f172a;">
                      <li style="margin:0 0 6px 0;">✅ <strong>Note:</strong> Your resume has been successfully submitted.</li>
                      <li style="margin:0;">⏳ Our team will review your profile, and within <strong>7 days</strong> your account will be approved. Once approved, you will receive a confirmation email with further instructions.</li>
                    </ul>

                    <p style="margin:0 0 18px 0; font-size:15px; line-height:1.6;">
                      We appreciate your patience and look forward to having you on our platform.
                    </p>
                    <div style="margin:22px 0;">
                      <a href="#" class="btn"
                         style="display:inline-block; text-decoration:none; background:#1e40af; color:#ffffff; padding:12px 18px; border-radius:8px; font-size:14px; font-weight:600;">
                        Complete Verification
                      </a>
                    </div>

                    <p style="margin:0 0 6px 0; font-size:15px; line-height:1.6;">Warm regards,</p>
                    <p style="margin:0; font-size:15px; line-height:1.6;">
                      <strong>Choose Your Therapist LLP</strong><br>
                      Support Team
                    </p>

                    <hr style="border:none; border-top:1px solid #e5e7eb; margin:20px 0;">

                    <p class="muted" style="margin:0; font-size:12px; color:#94a3b8; line-height:1.5;">
                      If you didn’t request this, you can safely ignore this email. The OTP will expire automatically.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 24px; font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#94a3b8;" align="left">
              © ${new Date().getFullYear()} Choose Your Therapist LLP. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;


export const loginOtpEmail = (name = "User", otp = "123456") => `
<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <title>CYT Login OTP</title>
  <style>
    @media (prefers-color-scheme: dark) {
      body, table, .bg-body { background-color:#0b0f14 !important; color:#e6eaef !important; }
      .card { background-color:#111827 !important; border-color:#1f2937 !important; }
      .muted { color:#9aa4b2 !important; }
      .btn { background:#2563eb !important; color:#ffffff !important; }
    }
    @media only screen and (max-width: 600px) {
      .container { width:100% !important; padding:0 16px !important; }
      .card { padding:20px !important; }
      h1 { font-size:22px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:#f4f6f8;" class="bg-body">

  <div style="display:none; overflow:hidden; line-height:1px; opacity:0; max-height:0; max-width:0;">
    Your CYT login OTP is ${otp}. It’s valid for 10 minutes.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f6f8; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" class="container" style="width:600px; max-width:600px;">
          <!-- Header -->
          <tr>
            <td align="left" style="padding:0 24px 16px 24px; font-family:Arial, Helvetica, sans-serif;">
              <div style="font-size:14px; color:#64748b;">Choose Your Therapist (CYT)</div>
              <div style="font-size:24px; font-weight:700; color:#0f172a;">Secure Login</div>
            </td>
          </tr>

          <tr>
            <td style="padding:0 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" style="background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; padding:28px;">
                <tr>
                  <td style="font-family:Arial, Helvetica, sans-serif; color:#0f172a;">
                    <h1 style="margin:0 0 12px 0; font-size:20px; line-height:1.3;">Dear ${name},</h1>

                    <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6;">
                      You are trying to log in to your account on <strong>Choose Your Therapist (CYT)</strong>.
                    </p>

                    <p style="margin:0 0 8px 0; font-size:14px; color:#64748b;">Your One-Time Password (OTP) is:</p>

                    <!-- OTP Box -->
                    <div style="margin:8px 0 16px 0; display:inline-block; padding:14px 18px; border:1px dashed #94a3b8; border-radius:10px; font-family:Consolas, Menlo, Monaco, monospace; font-size:20px; letter-spacing:3px; font-weight:700; color:#111827; background:#f8fafc;">
                      ${otp}
                    </div>

                    <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6;">
                      This OTP is valid for the next <strong>10 minutes</strong>.  
                      Please <strong>do not share this code</strong> with anyone for security reasons.
                    </p>

                    <p style="margin:0 0 18px 0; font-size:15px; line-height:1.6;">
                      Thank you,<br>
                      <strong>Team CYT</strong>
                    </p>

                    <hr style="border:none; border-top:1px solid #e5e7eb; margin:20px 0;">

                    <p class="muted" style="margin:0; font-size:12px; color:#94a3b8; line-height:1.5;">
                      Didn’t request a login? Please ignore this email or reset your password immediately.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px; font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#94a3b8;" align="left">
              © ${new Date().getFullYear()} Choose Your Therapist LLP. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

export const otpVerificationEmail = (otp = "123456") => `
<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <title>CYT OTP Verification</title>
  <style>
    @media (prefers-color-scheme: dark) {
      body, table, .bg-body { background-color:#0b0f14 !important; color:#e6eaef !important; }
      .card { background-color:#111827 !important; border-color:#1f2937 !important; }
      .muted { color:#9aa4b2 !important; }
    }
    @media only screen and (max-width: 600px) {
      .container { width:100% !important; padding:0 16px !important; }
      .card { padding:20px !important; }
      h1 { font-size:22px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:#f4f6f8;" class="bg-body">
  <!-- Preheader -->
  <div style="display:none; overflow:hidden; line-height:1px; opacity:0; max-height:0; max-width:0;">
    Your OTP for verification is ${otp}. Valid for 10 minutes.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f6f8; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" class="container" style="width:600px; max-width:600px;">
          <tr>
            <td align="left" style="padding:0 24px 16px 24px; font-family:Arial, Helvetica, sans-serif;">
              <div style="font-size:14px; color:#64748b;">Choose Your Therapist (CYT)</div>
              <div style="font-size:24px; font-weight:700; color:#0f172a;">OTP Verification</div>
            </td>
          </tr>

          <tr>
            <td style="padding:0 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" style="background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; padding:28px;">
                <tr>
                  <td style="font-family:Arial, Helvetica, sans-serif; color:#0f172a;">
                    <h1 style="margin:0 0 12px 0; font-size:20px; line-height:1.3;">Dear User,</h1>

                    <p style="margin:0 0 8px 0; font-size:15px; line-height:1.6;">
                      Your One-Time Password (OTP) is:
                    </p>

                    <div style="margin:8px 0 16px 0; display:inline-block; padding:14px 18px; border:1px dashed #94a3b8; border-radius:10px; font-family:Consolas, Menlo, Monaco, monospace; font-size:20px; letter-spacing:3px; font-weight:700; color:#111827; background:#f8fafc;">
                      ${otp}
                    </div>

                    <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6;">
                      It is valid for the next <strong>10 minutes</strong>.  
                      Please <strong>do not share</strong> this code with anyone.
                    </p>

                    <p style="margin:0; font-size:15px; line-height:1.6;">
                      — Team CYT
                    </p>

                    <hr style="border:none; border-top:1px solid #e5e7eb; margin:20px 0;">

                    <p class="muted" style="margin:0; font-size:12px; color:#94a3b8; line-height:1.5;">
                      If you didn’t request this OTP, please ignore this email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 24px; font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#94a3b8;" align="left">
              © ${new Date().getFullYear()} Choose Your Therapist LLP. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

export const registrationOtpEmail = ( name = "User", otp = "123456" ) => `
<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <title>CYT Registration OTP</title>
  <style>
    @media (prefers-color-scheme: dark) {
      body, table, .bg-body { background-color:#0b0f14 !important; color:#e6eaef !important; }
      .card { background-color:#111827 !important; border-color:#1f2937 !important; }
      .muted { color:#9aa4b2 !important; }
    }
    @media only screen and (max-width: 600px) {
      .container { width:100% !important; padding:0 16px !important; }
      .card { padding:20px !important; }
      h1 { font-size:22px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:#f4f6f8;" class="bg-body">
  <!-- Preheader -->
  <div style="display:none; overflow:hidden; line-height:1px; opacity:0; max-height:0; max-width:0;">
    Use the OTP below to complete your CYT registration. Valid for 10 minutes.
  </div>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f6f8; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" class="container" style="width:600px; max-width:600px;">
          <!-- Header -->
          <tr>
            <td align="left" style="padding:0 24px 16px 24px; font-family:Arial, Helvetica, sans-serif;">
              <div style="font-size:14px; color:#64748b;">Choose Your Therapist (CYT)</div>
              <div style="font-size:24px; font-weight:700; color:#0f172a;">Registration OTP</div>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="padding:0 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="card" style="background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; padding:28px;">
                <tr>
                  <td style="font-family:Arial, Helvetica, sans-serif; color:#0f172a;">
                    <h1 style="margin:0 0 12px 0; font-size:20px; line-height:1.3;">Dear ${name},</h1>

                    <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6;">
                      Welcome to <strong>Choose Your Therapist (CYT)</strong>!
                    </p>

                    <p style="margin:0 0 12px 0; font-size:15px; line-height:1.6;">
                      To complete your registration, please use the One-Time Password (OTP) below:
                    </p>

                    <!-- OTP Box -->
                    <div style="margin:8px 0 16px 0; display:inline-block; padding:14px 18px; border:1px dashed #94a3b8; border-radius:10px; font-family:Consolas, Menlo, Monaco, monospace; font-size:20px; letter-spacing:3px; font-weight:700; color:#111827; background:#f8fafc;">
                      ${otp}
                    </div>

                    <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6;">
                      This OTP is valid for the next <strong>10 minutes</strong>.  
                      Please do not share this code with anyone for security reasons.
                    </p>

                    <p style="margin:0 0 16px 0; font-size:15px; line-height:1.6;">
                      We’re glad to have you with us and look forward to supporting you on your wellness journey.
                    </p>

                    <p style="margin:0; font-size:15px; line-height:1.6;">
                      Warm regards,<br>
                      <strong>Team CYT</strong>
                    </p>

                    <hr style="border:none; border-top:1px solid #e5e7eb; margin:20px 0;">

                    <p class="muted" style="margin:0; font-size:12px; color:#94a3b8; line-height:1.5;">
                      If you didn’t sign up for CYT, you can safely ignore this email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 24px; font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#94a3b8;" align="left">
              © ${new Date().getFullYear()} Choose Your Therapist LLP. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;


export const leadNotificationEmail = (data) => {
  const { name, phone, email, concern } = data;
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Lead Received</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      color: #333;
      line-height: 1.6;
    }
    .container {
      max-width: 600px;
      margin: auto;
      padding: 20px;
      border: 1px solid #eee;
      border-radius: 8px;
      background: #fafafa;
    }
    h2 {
      color: #4CAF50;
    }
    ul {
      padding-left: 20px;
    }
    .footer {
      margin-top: 20px;
      font-size: 14px;
      color: #555;
    }
  </style>
</head>
<body>
  <div class="container">
    <h2>New Lead Received</h2>
    <p>A new lead has been submitted through the website. Here are the details:</p>

    <h3>Lead Information:</h3>
    <ul>
      <li><strong>Full Name:</strong> ${name || "N/A"}</li>
      <li><strong>Phone:</strong> ${phone || "N/A"}</li>
      <li><strong>Email:</strong> ${email || "N/A"}</li>
      <li><strong>Concern:</strong> ${concern || "N/A"}</li>
    </ul>

    <div class="footer">
      <p>Please follow up with this lead as soon as possible.</p>
      <p>Best regards,<br>ChooseYourTherapist Team</p>
    </div>
  </div>
</body>
</html>
`;
};

