export const therapistSessionMail = ({
    therapistName,
    clientName,
    clientAge,
    paymentAmount,
    transactionId,
    service,
    format,
    whom,
    cname,
    relation_with_client,
    notes,
}) => {
    return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>New Session Assigned | CYT</title>
    <style>
      body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; color: #1c1e21; line-height: 1.6; background-color: #f0f2f5; margin: 0; padding: 0; }
      .wrapper { width: 100%; table-layout: fixed; background-color: #f0f2f5; padding-bottom: 40px; }
      .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
      .header { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: #ffffff; padding: 40px 20px; text-align: center; }
      .logo-text { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
      .header-tagline { font-size: 14px; opacity: 0.9; text-transform: uppercase; letter-spacing: 2px; }
      .content { padding: 32px 24px; }
      .welcome-text { font-size: 18px; font-weight: 600; margin-bottom: 20px; color: #1c1e21; }
      .info-card { background-color: #f7f8fa; border-radius: 12px; padding: 8px; margin-bottom: 24px; border-left: 4px solid #1e293b; }
      .info-item { padding: 12px 16px; border-bottom: 1px solid #ebedf0; }
      .info-item:last-child { border-bottom: none; }
      .info-label { font-size: 12px; color: #65676b; font-weight: 600; margin-bottom: 4px; text-transform: uppercase; }
      .info-value { font-size: 16px; color: #050505; font-weight: 500; }
      .instructions { background: #fff9db; padding: 24px; border-radius: 12px; border: 1px solid #ffe066; margin-top: 32px; }
      .instructions h4 { margin-top: 0; color: #856404; font-size: 16px; margin-bottom: 12px; }
      .footer { text-align: center; padding: 32px 20px; color: #65676b; font-size: 13px; }
      @media only screen and (max-width: 480px) {
        .container { width: 95% !important; }
        .header { padding: 30px 15px !important; }
        .content { padding: 24px 16px !important; }
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="container">
        <div class="header">
          <div class="logo-text">CYT</div>
          <div class="header-tagline">Therapist Portal</div>
        </div>
        <div class="content">
          <p class="welcome-text">Hello, ${therapistName}!</p>
          <p>A new therapy session has been assigned to you. Please review the details below:</p>

          <div class="info-card">
            <div class="info-item">
              <div class="info-label">Client Name</div>
              <div class="info-value">${clientName}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Patient (Age)</div>
              <div class="info-value">${cname || clientName} ${clientAge ? '('+clientAge+'y)' : ''}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Service</div>
              <div class="info-value">${service || "N/A"}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Format</div>
              <div class="info-value" style="text-transform: capitalize;">${format || "N/A"}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Transaction ID</div>
              <div class="info-value">${transactionId}</div>
            </div>
            ${notes ? `<div class="info-item"><div class="info-label">Notes</div><div class="info-value">${notes}</div></div>` : ''}
          </div>

          <div class="instructions">
            <h4>Action Required:</h4>
            <ul style="margin:0; padding-left:20px; color: #664d03;">
              <li>Log in to your <strong>Dashboard</strong> to verify the session.</li>
              <li><strong>Collect PIN:</strong> Collect the client's unique PIN at the start of the session.</li>
              <li><strong>Completion:</strong> Mark the session as "Completed" after finishing.</li>
            </ul>
          </div>
        </div>
        <div class="footer">
          <p>Choose Your Therapist LLP &bull; Professional Support Team</p>
          <p>&copy; ${new Date().getFullYear()} CYT. All rights reserved.</p>
        </div>
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
    service,
    format,
    whom,
    cname,
    relation_with_client,
    notes,
    pin
}) => {
    return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Booking Confirmation | CYT</title>
    <style>
      body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; color: #1c1e21; line-height: 1.6; background-color: #f0f2f5; margin: 0; padding: 0; }
      .wrapper { width: 100%; table-layout: fixed; background-color: #f0f2f5; padding-bottom: 40px; }
      .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
      .header { background: linear-gradient(135deg, #2e7d32 0%, #43a047 100%); color: #ffffff; padding: 40px 20px; text-align: center; }
      .logo-text { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
      .header-tagline { font-size: 14px; opacity: 0.9; text-transform: uppercase; letter-spacing: 2px; }
      .content { padding: 32px 24px; }
      .welcome-text { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #1c1e21; }
      .status-banner { background-color: #e8f5e9; border-left: 4px solid #2e7d32; padding: 12px 16px; margin-bottom: 24px; border-radius: 4px; color: #2e7d32; font-weight: 600; }
      .info-card { background-color: #f7f8fa; border-radius: 12px; padding: 8px; margin-bottom: 24px; }
      .info-item { padding: 12px 16px; border-bottom: 1px solid #ebedf0; }
      .info-item:last-child { border-bottom: none; }
      .info-label { font-size: 11px; color: #65676b; font-weight: 700; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
      .info-value { font-size: 15px; color: #050505; font-weight: 500; }
      .pin-container { text-align: center; margin: 32px 0; padding: 24px; background: #fffbeb; border: 2px dashed #fcd34d; border-radius: 16px; }
      .pin-label { font-size: 12px; color: #92400e; margin-bottom: 8px; font-weight: 700; text-transform: uppercase; }
      .pin-value { font-family: 'Courier New', monospace; font-size: 36px; font-weight: 800; color: #1e293b; letter-spacing: 8px; margin: 12px 0; }
      .next-steps { margin-top: 32px; padding-top: 24px; border-top: 1px solid #ebedf0; }
      .next-steps h3 { font-size: 16px; color: #1c1e21; margin-bottom: 16px; }
      .step { display: flex; margin-bottom: 16px; }
      .step-num { background: #e8f5e9; color: #2e7d32; width: 24px; height: 24px; border-radius: 50%; text-align: center; line-height: 24px; font-size: 12px; font-weight: 700; margin-right: 12px; flex-shrink: 0; }
      .step-text { font-size: 14px; color: #4b4b4b; }
      .footer { text-align: center; padding: 32px 20px; color: #65676b; font-size: 13px; }
      @media only screen and (max-width: 480px) {
        .container { width: 95% !important; }
        .pin-value { font-size: 28px !important; letter-spacing: 4px !important; }
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="container">
        <div class="header">
          <div class="logo-text">CYT</div>
          <div class="header-tagline">Choose Your Therapist</div>
        </div>
        <div class="content">
          <div class="status-banner">✅ Booking Confirmed</div>
          <p class="welcome-text">Dear ${clientName},</p>
          <p>Your therapy session has been successfully booked. We're committed to supporting you on your wellness journey.</p>

          <div class="info-card" style="margin-top: 24px;">
            <div class="info-item">
              <div class="info-label">Therapist</div>
              <div class="info-value">${therapistName}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Service / Format</div>
              <div class="info-value">${service || "Counseling"} (${format || "Video Session"})</div>
            </div>
            <div class="info-item">
              <div class="info-label">Patient Name</div>
              <div class="info-value">${cname || clientName} ${clientAge ? '(' + clientAge + 'y)' : ''}</div>
            </div>
            <div class="info-item">
              <div class="info-label">Transaction ID</div>
              <div class="info-value">${transactionId}</div>
            </div>
          </div>

          <div class="pin-container">
            <div class="pin-label">Your Unique Session PIN</div>
            <div class="pin-value">${pin}</div>
            <p style="margin-top:8px; font-size:12px; color: #b45309;">Provide this PIN to your therapist <strong>only</strong> when the session starts.</p>
          </div>

          <div class="next-steps">
            <h3>What's Next?</h3>
            <div class="step">
              <div class="step-num">1</div>
              <div class="step-text">Access your <strong>Dashboard</strong> to manage bookings and check status.</div>
            </div>
            <div class="step">
              <div class="step-num">2</div>
              <div class="step-text">Be ready at the scheduled time. Your therapist will connect via the chosen format.</div>
            </div>
            <div class="step">
              <div class="step-num">3</div>
              <div class="step-text">Share the 4-digit PIN above once the session begins to verify.</div>
            </div>
          </div>
        </div>
        <div class="footer">
          <p><strong>Choose Your Therapist LLP</strong><br/>Professional Mental Health Support Platform</p>
          <p>&copy; ${new Date().getFullYear()} CYT. All rights reserved.</p>
        </div>
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
    service,
    format,
    whom,
    cname,
    relation_with_client,
    notes,
}) => {
    return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>New Session Notification | CYT</title>
    <style>
      body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; color: #1c1e21; line-height: 1.6; background-color: #f0f2f5; margin: 0; padding: 0; }
      .wrapper { width: 100%; table-layout: fixed; background-color: #f0f2f5; padding-bottom: 40px; }
      .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
      .header { background: #1e293b; color: #ffffff; padding: 40px 20px; text-align: center; }
      .logo-text { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
      .header-tagline { font-size: 14px; opacity: 0.9; text-transform: uppercase; letter-spacing: 2px; }
      .content { padding: 32px 24px; }
      .status-badge { display: inline-block; padding: 6px 16px; background: #dcfce7; color: #166534; border-radius: 99px; font-size: 12px; font-weight: 700; margin-bottom: 24px; text-transform: uppercase; }
      .section-head { font-size: 13px; font-weight: 700; color: #65676b; text-transform: uppercase; letter-spacing: 1px; margin: 24px 0 12px 0; border-bottom: 1px solid #ebedf0; padding-bottom: 8px; }
      .info-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; background: #f7f8fa; border-radius: 12px; overflow: hidden; }
      .info-table td { padding: 14px 16px; border-bottom: 1px solid #ebedf0; font-size: 14px; }
      .info-table tr:last-child td { border-bottom: none; }
      .label { font-weight: 600; color: #65676b; width: 140px; }
      .value { color: #050505; font-weight: 500; }
      .footer { text-align: center; padding: 32px 20px; color: #65676b; font-size: 13px; }
      @media only screen and (max-width: 480px) {
        .container { width: 95% !important; }
        .label { width: 100px; }
      }
    </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="container">
        <div class="header">
          <div class="logo-text">CYT</div>
          <div class="header-tagline">Admin Notification</div>
        </div>
        <div class="content">
          <div class="status-badge">Payment Received</div>
          <p style="margin-bottom: 24px;">A new therapy session has been confirmed and recorded.</p>

          <div class="section-head">Client & Session Details</div>
          <table class="info-table">
            <tr><td class="label">Client Name</td><td class="value">${clientName}</td></tr>
            <tr><td class="label">Patient (Age)</td><td class="value">${cname || clientName} ${clientAge ? '('+clientAge+')' : ''}</td></tr>
            <tr><td class="label">Service</td><td class="value">${service || "N/A"}</td></tr>
            <tr><td class="label">Format</td><td class="value">${format || "N/A"}</td></tr>
            <tr><td class="label">Relation</td><td class="value">${relation_with_client || "Self"}</td></tr>
            <tr><td class="label">Amount</td><td class="value"><strong>₹${paymentAmount}</strong></td></tr>
            <tr><td class="label">Transaction</td><td class="value"><code>${transactionId}</code></td></tr>
            ${notes ? `<tr><td class="label">Notes</td><td class="value">${notes}</td></tr>` : ''}
          </table>

          <div class="section-head">Assigned Therapist</div>
          <table class="info-table">
            <tr><td class="label">Name</td><td class="value">${therapistName}</td></tr>
            <tr><td class="label">Profile Code</td><td class="value">${therapistId}</td></tr>
          </table>
        </div>
        <div class="footer">
          <p>CYT Management System &bull; Internal Use Only</p>
          <p>&copy; ${new Date().getFullYear()} Choose Your Therapist. All rights reserved.</p>
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
};



export const leadNotificationEmail = (data) => {
  const { name, phone, email, concern, source, ...others } = data;
  
  // Custom display logic for common dropdown values (reason, service, interest, etc.)
  const getVal = (v) => (v && v !== "Not provided") ? v : null;
  const displayConcern = getVal(concern) || getVal(others.reason) || getVal(others.service) || getVal(others.message) || getVal(others.interest) || getVal(others.type) || getVal(others.dropdown) || "N/A";

  // Build HTML for any additional form fields
  const filteredKeys = ["name", "phone", "email", "concern", "source", "service", "reason", "message", "interest", "type", "dropdown"];
  let additionalFieldsHtml = "";
  if (others && Object.keys(others).length > 0) {
    additionalFieldsHtml = Object.entries(others)
      .filter(([key]) => !filteredKeys.includes(key))
      .map(([key, value]) => `
        <div class="info-item">
          <div class="info-label">${key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}</div>
          <div class="info-value">${value}</div>
        </div>
      `)
      .join("");
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Lead Notification | CYT</title>
  <style>
    /* Reset styles for email clients */
    body, p, h1, h2, h3 { margin: 0; padding: 0; }
    img { max-width: 100%; height: auto; display: block; }
    
    body {
      font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f0f2f5;
      color: #1c1e21;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    .wrapper {
      width: 100%;
      table-layout: fixed;
      background-color: #f0f2f5;
      padding-bottom: 40px;
    }

    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      margin-top: 20px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }

    .header {
      background: linear-gradient(135deg, #2e7d32 0%, #43a047 100%);
      padding: 40px 20px;
      text-align: center;
      color: #ffffff;
    }

    .logo-text {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
    }

    .header-tagline {
      font-size: 14px;
      opacity: 0.9;
      text-transform: uppercase;
      letter-spacing: 2px;
    }

    .content {
      padding: 32px 24px;
    }

    .alert-banner {
      background-color: #e8f5e9;
      border-left: 4px solid #2e7d32;
      padding: 16px;
      margin-bottom: 32px;
      border-radius: 4px;
    }

    .alert-text {
      color: #2e7d32;
      font-weight: 600;
      font-size: 15px;
    }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      color: #65676b;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid #ebedf0;
    }

    .info-card {
      background-color: #f7f8fa;
      border-radius: 12px;
      padding: 8px;
      margin-bottom: 24px;
    }

    .info-item {
      padding: 12px 16px;
      border-bottom: 1px solid #ebedf0;
    }

    .info-item:last-child {
      border-bottom: none;
    }

    .info-label {
      font-size: 12px;
      color: #65676b;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .info-value {
      font-size: 16px;
      color: #050505;
      font-weight: 500;
      word-break: break-all;
    }

    .concern-box {
      background-color: #ffffff;
      border: 1px solid #ebedf0;
      border-radius: 8px;
      padding: 16px;
      margin-top: 8px;
      font-style: italic;
      color: #4b4b4b;
    }

    .actions {
      text-align: center;
      margin-top: 32px;
    }

    .btn {
      display: inline-block;
      background-color: #2e7d32;
      color: #ffffff !important;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 16px;
      transition: background-color 0.3s ease;
    }

    .footer {
      text-align: center;
      padding: 32px 20px;
      color: #65676b;
      font-size: 13px;
    }

    .footer-links {
      margin-bottom: 16px;
    }

    .footer-links a {
      color: #2e7d32;
      text-decoration: none;
      margin: 0 8px;
    }

    /* Mobile Responsive */
    @media only screen and (max-width: 480px) {
      .container {
        width: 95% !important;
        margin-top: 10px !important;
      }
      .header {
        padding: 30px 15px !important;
      }
      .content {
        padding: 24px 16px !important;
      }
      .btn {
        width: 100%;
        box-sizing: border-box;
      }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="logo-text">CYT</div>
        <div class="header-tagline">Choose Your Therapist</div>
      </div>
      
      <div class="content">
        <div class="alert-banner">
          <p class="alert-text">✨ New Consultation Request Received</p>
        </div>

        <h3 class="section-title">Client Details</h3>
        <div class="info-card">
          <div class="info-item">
            <div class="info-label">Full Name</div>
            <div class="info-value">${name || "N/A"}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Phone Number</div>
            <div class="info-value">${phone || "N/A"}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Email Address</div>
            <div class="info-value">${email || "N/A"}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Source</div>
            <div class="info-value">${source || "Direct Website"}</div>
          </div>
        </div>

        <h3 class="section-title">Requirement / Concern</h3>
        <div class="info-card">
          <div class="info-item">
            <div class="info-value">${displayConcern}</div>
          </div>
          ${additionalFieldsHtml ? additionalFieldsHtml : ""}
        </div>

        <div class="actions">
          <a href="mailto:${email}" class="btn">Reply to Lead</a>
        </div>
      </div>

      <div class="footer">
        <div class="footer-links">
          <a href="https://chooseyourtherapist.in">Website</a> | 
          <a href="https://chooseyourtherapist.in/contact">Contact Support</a>
        </div>
        <p>This is an automated notification from the CYT Management System.</p>
        <p>&copy; ${new Date().getFullYear()} Choose Your Therapist LLP. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;
};

// --- OTP & AUTH TEMPLATES ---

const baseOtpTemplate = (title, greeting, message, otp) => `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f0f2f5; margin: 0; padding: 0; }
    .wrapper { width: 100%; table-layout: fixed; background-color: #f0f2f5; padding-bottom: 40px; }
    .container { max-width: 500px; margin: 20px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header { background: #2563eb; color: #ffffff; padding: 32px 20px; text-align: center; }
    .logo-text { font-size: 24px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 4px; }
    .header h2 { margin: 0; font-size: 18px; font-weight: 600; opacity: 0.9; }
    .content { padding: 32px 24px; line-height: 1.6; color: #1c1e21; }
    .otp-box { background: #f8fafc; border: 2px dashed #cbd5e1; padding: 24px; text-align: center; margin: 24px 0; border-radius: 12px; }
    .otp-label { font-size: 11px; color: #65676b; margin-bottom: 12px; text-transform: uppercase; font-weight: 700; letter-spacing: 1px; }
    .otp-code { font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1e293b; font-family: 'Courier New', monospace; }
    .footer { text-align: center; padding: 24px; font-size: 12px; color: #65676b; border-top: 1px solid #ebedf0; }
    @media only screen and (max-width: 480px) {
      .container { width: 95% !important; margin-top: 10px !important; }
      .otp-code { font-size: 28px !important; letter-spacing: 4px !important; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="logo-text">CYT</div>
        <h2>${title}</h2>
      </div>
      <div class="content">
        <p style="font-size: 16px;">Hello <strong>${greeting}</strong>,</p>
        <p style="color: #4b4b4b;">${message}</p>
        <div class="otp-box">
          <div class="otp-label">Verification Code</div>
          <div class="otp-code">${otp}</div>
        </div>
        <p style="font-size: 13px; color: #65676b;">This code is valid for a limited time. Please do not share this OTP with anyone.</p>
      </div>
      <div class="footer">Choose Your Therapist (CYT) &bull; Mental Wellness Platform</div>
    </div>
  </div>
</body>
</html>
`;

export const loginOtpEmail = (name, otp) => 
  baseOtpTemplate("Login Verification", name, "Use the following code to complete your login to CYT.", otp);

export const registrationOtpEmail = (name, otp) => 
  baseOtpTemplate("Welcome to CYT", name, "Thank you for joining us! Please verify your email with the code below.", otp);

export const newsletterSubscriptionOtpEmail = (email, otp) => 
  baseOtpTemplate("Newsletter Subscription", email, "Thank you for subscribing to our newsletter! Please use the following code to verify your email address.", otp);

export const therapistVerificationEmail = (email, otp) => 
  baseOtpTemplate("Therapist Onboarding", email, "Your application is under review. Please verify your email to proceed with the registration process.", otp);

export const otpVerificationEmail = (otp) => 
  baseOtpTemplate("Verification Code", "User", "Your one-time verification code is provided below.", otp);

// --- PLAIN TEXT HELPERS ---

export const clientText = (booking, txId) => 
  `Session Confirmed! Transaction: ${txId}. Your unique session PIN is ${booking.otp}. Please share this with your therapist at the start of the session.`;

export const therapistText = (booking, txId) => 
  `NEW SESSION assigned. Transaction: ${txId}. Client: ${booking.client.name}. Please log in to your dashboard for details.`;

export const adminText = (booking, txId) => 
  `CONFIRMED BOOKING: ${booking.client.name} with ${booking.therapist.user.name}. Amount: ₹${booking.amount}. Transaction: ${txId}.`;

