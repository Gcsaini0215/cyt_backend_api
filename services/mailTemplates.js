export const therapistSessionMail = ({
    therapistName,
    clientName,
    clientAge,
    paymentAmount,
    transactionId,
    service,
    format,
    sessionDateTime,
    sessionMode,
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
      .info-item { padding: 12px 16px; border-bottom: 2px solid #2e7d32; width: 90%; margin: 0 auto; }
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
              <div class="info-label">Session Date &amp; Time</div>
              <div class="info-value">${sessionDateTime || "To be confirmed"}</div>
            </div>
            ${sessionMode ? `<div class="info-item"><div class="info-label">Mode</div><div class="info-value">${sessionMode}</div></div>` : ''}
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



export const bookingRequestReceivedMail = ({
    clientName,
    therapistName,
    service,
    format,
    sessionDateTime,
    sessionMode,
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
    <title>Booking Request Received | CYT</title>
    <style>
      body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; color: #1c1e21; line-height: 1.6; background-color: #f0f2f5; margin: 0; padding: 0; }
      .wrapper { width: 100%; table-layout: fixed; background-color: #f0f2f5; padding-bottom: 40px; }
      .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
      .header { background: linear-gradient(135deg, #2e7d32 0%, #43a047 100%); color: #ffffff; padding: 40px 20px; text-align: center; }
      .logo-text { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
      .header-tagline { font-size: 14px; opacity: 0.9; text-transform: uppercase; letter-spacing: 2px; }
      .content { padding: 32px 24px; }
      .welcome-text { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #1c1e21; }
      .status-banner { background-color: #fffbeb; border-left: 4px solid #d97706; padding: 12px 16px; margin-bottom: 24px; border-radius: 4px; color: #92400e; font-weight: 600; }
      .info-card { background-color: #f7f8fa; border-radius: 12px; padding: 8px; margin-bottom: 24px; }
      .info-item { padding: 12px 16px; border-bottom: 2px solid #2e7d32; width: 90%; margin: 0 auto; }
      .info-item:last-child { border-bottom: none; }
      .info-label { font-size: 11px; color: #65676b; font-weight: 700; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
      .info-value { font-size: 15px; color: #050505; font-weight: 500; }
      .footer { text-align: center; padding: 32px 20px; color: #65676b; font-size: 13px; }
      @media only screen and (max-width: 480px) { .container { width: 95% !important; } }
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
          <div class="status-banner">⏳ Booking Request Received — Payment Pending</div>
          <p class="welcome-text">Dear ${clientName},</p>
          <p>We've received your session request. Your booking will be confirmed once payment is completed.</p>

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
              <div class="info-label">Session Date &amp; Time</div>
              <div class="info-value">${sessionDateTime || "To be confirmed"}</div>
            </div>
            ${sessionMode ? `<div class="info-item"><div class="info-label">Mode</div><div class="info-value">${sessionMode}</div></div>` : ''}
            <div class="info-item">
              <div class="info-label">Patient Name</div>
              <div class="info-value">${cname || clientName}</div>
            </div>
          </div>

          <p style="font-size:13px; color:#65676b;">You'll receive your Session PIN and full confirmation by email once payment is successful.</p>
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

export const bookingConfirmationMail = ({
    clientName,
    therapistName,
    clientAge,
    transactionId,
    service,
    format,
    sessionDateTime,
    sessionMode,
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
      .info-item { padding: 12px 16px; border-bottom: 2px solid #2e7d32; width: 90%; margin: 0 auto; }
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
              <div class="info-label">Session Date &amp; Time</div>
              <div class="info-value">${sessionDateTime || "To be confirmed"}</div>
            </div>
            ${sessionMode ? `<div class="info-item"><div class="info-label">Mode</div><div class="info-value">${sessionMode}</div></div>` : ''}
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
    sessionDateTime,
    sessionMode,
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
      .section-head { font-size: 13px; font-weight: 700; color: #65676b; text-transform: uppercase; letter-spacing: 1px; margin: 24px auto 12px auto; border-bottom: 2px solid #2e7d32; padding-bottom: 8px; text-align: center; width: 60%; }
      .info-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; background: #f7f8fa; border-radius: 12px; overflow: hidden; }
      .info-table td { padding: 14px 16px; border-bottom: 1px solid #2e7d32; font-size: 14px; }
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
            <tr><td class="label">Date &amp; Time</td><td class="value">${sessionDateTime || "To be confirmed"}</td></tr>
            <tr><td class="label">Mode</td><td class="value">${sessionMode || "—"}</td></tr>
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
  const { name, phone, email, concern, source, age, ...others } = data;

  const getVal = (v) => (v && v !== "Not provided") ? v : null;

  let displayAge = age || "";
  let displayConcern = getVal(concern) || getVal(others.reason) || getVal(others.service) || getVal(others.message) || "N/A";

  if (!displayAge && displayConcern.includes("Age:")) {
    const ageMatch = displayConcern.match(/Age:\s*(.+)/);
    const concernMatch = displayConcern.match(/Concern:\s*([\s\S]+)/);
    if (ageMatch) displayAge = ageMatch[1].trim();
    if (concernMatch) displayConcern = concernMatch[1].trim();
  }

  const whatsappLink = phone ? `https://wa.me/91${phone.replace(/\D/g,"")}` : "#";
  const callLink = phone ? `tel:+91${phone.replace(/\D/g,"")}` : "#";
  const now = new Date();
  const timeStr = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>New Lead | Choose Your Therapist</title>
  <style>
    body,p,h1,h2,h3,h4,td,div{margin:0;padding:0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}
    @media only screen and (max-width:600px){
      .container{width:100%!important;}
      .two-col td{display:block!important;width:100%!important;border-left:none!important;border-top:1px solid #e2e8f0!important;}
      .btn-td{display:block!important;width:100%!important;padding:4px 0!important;}
    }
  </style>
</head>
<body style="background:#eef2f7;padding:24px 0;">

<table width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center">

  <table class="container" width="600" cellpadding="0" cellspacing="0" border="0"
    style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">

    <!-- ═══ HEADER ═══ -->
    <tr>
      <td style="background:#0d3d25;padding:0;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding:24px 32px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <div style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;">#ChooseYourTherapist</div>
                  </td>
                  <td></td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Green bar -->
          <tr><td style="background:#166534;padding:10px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:12px;color:#bbf7d0;font-weight:600;">📋 Consultation Request</td>
                <td align="right" style="font-size:11px;color:rgba(255,255,255,0.6);">${timeStr} IST</td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td>
    </tr>

    <!-- ═══ PATIENT INFO SECTION ═══ -->
    <tr>
      <td style="padding:28px 32px 0;">
        <div style="font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #0d3d25;">Client Information</div>
      </td>
    </tr>

    <!-- Row: Name + Age -->
    <tr>
      <td style="padding:0 32px;">
        <table class="two-col" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:8px;">
          <tr>
            <td width="50%" style="padding:14px 18px;background:#f8fafc;vertical-align:top;">
              <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Full Name</div>
              <div style="font-size:16px;font-weight:700;color:#0f172a;">${name || "—"}</div>
            </td>
            <td width="50%" style="padding:14px 18px;background:#f8fafc;vertical-align:top;border-left:1px solid #e2e8f0;">
              <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Age</div>
              <div style="font-size:16px;font-weight:700;color:#0f172a;">${displayAge || "—"}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Row: Phone + Email -->
    <tr>
      <td style="padding:0 32px;">
        <table class="two-col" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:8px;">
          <tr>
            <td width="50%" style="padding:14px 18px;background:#f8fafc;vertical-align:top;">
              <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Phone Number</div>
              <div style="font-size:16px;font-weight:700;color:#0f172a;">${phone || "—"}</div>
            </td>
            <td width="50%" style="padding:14px 18px;background:#f8fafc;vertical-align:top;border-left:1px solid #e2e8f0;">
              <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Email Address</div>
              <div style="font-size:14px;font-weight:600;color:#0f172a;word-break:break-all;">${email || "—"}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Row: Source -->
    <tr>
      <td style="padding:0 32px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:14px 18px;background:#f8fafc;">
              <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px;">Source / Referred Via</div>
              <div style="font-size:15px;font-weight:600;color:#0f172a;">${source || "Direct Website"}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ═══ CONCERN SECTION ═══ -->
    <tr>
      <td style="padding:0 32px 24px;">
        <div style="font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #0d3d25;">Concern / Requirement</div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffbeb;border:1px solid #fde68a;border-left:4px solid #f59e0b;border-radius:8px;">
          <tr>
            <td style="padding:16px 20px;">
              <div style="font-size:14px;color:#1e293b;line-height:1.8;">${displayConcern}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ═══ ACTION BUTTONS ═══ -->
    <tr>
      <td style="padding:0 32px 32px;">
        <div style="font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #0d3d25;">Quick Actions</div>
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td class="btn-td" width="50%" style="padding-right:6px;">
              <a href="${whatsappLink}" style="display:block;background:#25d366;color:#ffffff;text-decoration:none;padding:14px;border-radius:8px;font-weight:700;font-size:14px;text-align:center;">
                💬 WhatsApp Client
              </a>
            </td>
            <td class="btn-td" width="50%" style="padding-left:6px;">
              <a href="${callLink}" style="display:block;background:#0d3d25;color:#ffffff;text-decoration:none;padding:14px;border-radius:8px;font-weight:700;font-size:14px;text-align:center;">
                📞 Call Client
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ═══ FOOTER ═══ -->
    <tr>
      <td style="background:#0d3d25;padding:18px 32px;text-align:center;">
        <p style="font-size:12px;color:rgba(255,255,255,0.6);margin:0 0 4px;">
          +91-8077757951 &nbsp;·&nbsp; hello@chooseyourtherapist.in &nbsp;·&nbsp; chooseyourtherapist.in
        </p>
        <p style="font-size:11px;color:rgba(255,255,255,0.35);margin:0;">
          © ${new Date().getFullYear()} Choose Your Therapist LLP · Automated CRM Notification
        </p>
      </td>
    </tr>

  </table>

</td></tr>
</table>

</body>
</html>`;
};

// --- OTP & AUTH TEMPLATES ---

const baseOtpTemplate = (title, greeting, message, otp) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} | CYT</title>
</head>
<body style="margin:0;padding:0;background-color:#f0f4f8;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f4f8;padding:32px 0;">
  <tr><td align="center">

    <table width="520" cellpadding="0" cellspacing="0" border="0"
      style="max-width:520px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.09);">

      <!-- TOP GREEN BAR -->
      <tr>
        <td style="height:5px;background:linear-gradient(90deg,#16a34a,#4ade80);font-size:0;line-height:0;">&nbsp;</td>
      </tr>

      <!-- HEADER -->
      <tr>
        <td style="background:linear-gradient(135deg,#14532d 0%,#16a34a 60%,#22bb33 100%);padding:32px 28px 28px;text-align:center;">
          <!-- Logo badge -->
          <div style="display:inline-block;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:50px;padding:6px 20px;margin-bottom:16px;">
            <span style="font-size:15px;font-weight:900;color:#ffffff;letter-spacing:2px;">CYT</span>
          </div>
          <div style="font-size:11px;color:rgba(255,255,255,0.75);text-transform:uppercase;letter-spacing:2px;font-weight:600;margin-bottom:6px;">Choose Your Therapist</div>
          <div style="font-size:20px;font-weight:800;color:#ffffff;">${title}</div>
        </td>
      </tr>

      <!-- GREETING -->
      <tr>
        <td style="padding:28px 32px 0;">
          <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0f172a;">Hello, ${greeting}</p>
          <p style="margin:0;font-size:14px;color:#475569;line-height:1.7;">${message}</p>
        </td>
      </tr>

      <!-- OTP CARD -->
      <tr>
        <td style="padding:24px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0"
            style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);border:1.5px solid #86efac;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:10px 0 6px;text-align:center;">
                <div style="font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:2px;">Your One-Time Code</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 24px 16px;text-align:center;">
                <!-- OTP digits split into boxes -->
                <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
                  <tr>
                    ${otp.toString().split('').map(d => `
                    <td style="padding:0 4px;">
                      <div style="width:44px;height:54px;background:#ffffff;border:2px solid #22bb33;border-radius:10px;text-align:center;line-height:54px;font-size:26px;font-weight:900;color:#14532d;font-family:'Courier New',monospace;box-shadow:0 2px 8px rgba(34,187,51,0.15);">${d}</div>
                    </td>`).join('')}
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 16px;text-align:center;">
                <div style="display:inline-block;background:#fef9c3;border:1px solid #fde047;border-radius:20px;padding:5px 16px;">
                  <span style="font-size:12px;color:#854d0e;font-weight:600;">⏱ Valid for 10 minutes</span>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- SECURITY NOTE -->
      <tr>
        <td style="padding:0 32px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0"
            style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #ef4444;border-radius:8px;">
            <tr>
              <td style="padding:12px 16px;">
                <p style="margin:0;font-size:12px;color:#7f1d1d;line-height:1.6;">
                  <strong>Security tip:</strong> CYT will never ask for this code via call, chat, or email. Do not share it with anyone.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- DIVIDER -->
      <tr>
        <td style="padding:0 32px;">
          <div style="border-top:1px solid #e2e8f0;"></div>
        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="padding:20px 32px;text-align:center;">
          <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">Choose Your Therapist &bull; Mental Wellness Platform</p>
          <p style="margin:0;font-size:11px;color:#cbd5e1;">&copy; ${new Date().getFullYear()} CYT. All rights reserved.</p>
        </td>
      </tr>

      <!-- BOTTOM GREEN BAR -->
      <tr>
        <td style="height:4px;background:linear-gradient(90deg,#22bb33,#4ade80);font-size:0;line-height:0;">&nbsp;</td>
      </tr>

    </table>

  </td></tr>
  </table>

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

export const bookingCancelledMail = ({ recipientName, otherPartyName, service, format, booking_date, action }) => {
  const actionLabel = action === "deleted" ? "removed" : "cancelled";
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Booking ${actionLabel === "removed" ? "Removed" : "Cancelled"} | CYT</title>
    <style>
      body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; color: #1c1e21; line-height: 1.6; background-color: #f0f2f5; margin: 0; padding: 0; }
      .wrapper { width: 100%; table-layout: fixed; background-color: #f0f2f5; padding-bottom: 40px; }
      .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
      .header { background: linear-gradient(135deg, #7f1d1d 0%, #b91c1c 100%); color: #ffffff; padding: 40px 20px; text-align: center; }
      .logo-text { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
      .header-tagline { font-size: 14px; opacity: 0.9; text-transform: uppercase; letter-spacing: 2px; }
      .content { padding: 32px 24px; }
      .welcome-text { font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #1c1e21; }
      .status-banner { background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 12px 16px; margin-bottom: 24px; border-radius: 4px; color: #991b1b; font-weight: 600; }
      .info-card { background-color: #f7f8fa; border-radius: 12px; padding: 8px; margin-bottom: 24px; }
      .info-item { padding: 12px 16px; border-bottom: 2px solid #dc2626; width: 90%; margin: 0 auto; }
      .info-item:last-child { border-bottom: none; }
      .info-label { font-size: 11px; color: #65676b; font-weight: 700; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
      .info-value { font-size: 15px; color: #050505; font-weight: 500; }
      .footer { text-align: center; padding: 32px 20px; color: #65676b; font-size: 13px; }
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
          <div class="status-banner">⚠️ Booking ${actionLabel === "removed" ? "Removed" : "Cancelled"}</div>
          <p class="welcome-text">Dear ${recipientName},</p>
          <p>Your session with <strong>${otherPartyName}</strong> has been ${actionLabel} by our team.</p>

          <div class="info-card" style="margin-top: 24px;">
            <div class="info-item">
              <div class="info-label">Service / Format</div>
              <div class="info-value">${service || "Counseling"} (${format || "Video Session"})</div>
            </div>
            ${booking_date ? `<div class="info-item">
              <div class="info-label">Scheduled For</div>
              <div class="info-value">${new Date(booking_date).toLocaleString("en-IN")}</div>
            </div>` : ""}
          </div>

          <p style="font-size:13px; color:#65676b;">If you have questions about this, please reach out to <a href="mailto:hello@chooseyourtherapist.in" style="color:#228756">hello@chooseyourtherapist.in</a>.</p>
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

// --- PLAIN TEXT HELPERS ---

const slotText = (d) => {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "to be confirmed";
  return dt.toLocaleString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  }) + " IST";
};

export const clientText = (booking, txId) =>
  `Session Confirmed for ${slotText(booking.booking_date)}. Transaction: ${txId}. Your unique session PIN is ${booking.otp}. Please share this with your therapist at the start of the session.`;

export const therapistText = (booking, txId) =>
  `NEW SESSION assigned for ${slotText(booking.booking_date)}. Client: ${booking.client.name}. Transaction: ${txId}. Please log in to your dashboard for details.`;

export const adminText = (booking, txId) =>
  `CONFIRMED BOOKING: ${booking.client.name} with ${booking.therapist.user.name} on ${slotText(booking.booking_date)}. Amount: ₹${booking.amount}. Transaction: ${txId}.`;

