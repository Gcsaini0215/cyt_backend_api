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
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #333; line-height: 1.6; background-color: #f4f7f6; margin: 0; }
      .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.08); }
      .header { background: #2c3e50; color: #ffffff; padding: 30px; text-align: center; }
      .content { padding: 35px; }
      .client-card { background: #e8f4fd; border-radius: 8px; padding: 20px; margin: 20px 0; border-left: 5px solid #3498db; }
      .info-row { margin-bottom: 10px; display: flex; }
      .info-label { font-weight: 700; width: 130px; color: #555; }
      .info-value { color: #222; flex: 1; }
      .instructions { background: #fff9db; padding: 20px; border-radius: 8px; border: 1px solid #ffe066; margin-top: 25px; }
      .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 13px; color: #777; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h2 style="margin:0">New Session Assigned</h2>
      </div>
      <div class="content">
        <p>Dear <strong>${therapistName}</strong>,</p>
        <p>A new therapy session has been assigned to you. Please review the client details below:</p>

        <div class="client-card">
          <div class="info-row"><div class="info-label">Client Name:</div><div class="info-value">${clientName}</div></div>
          <div class="info-row"><div class="info-label">Patient (Age):</div><div class="info-value">${cname || clientName} ${clientAge ? '('+clientAge+'y)' : ''}</div></div>
          <div class="info-row"><div class="info-label">Service:</div><div class="info-value">${service || "N/A"}</div></div>
          <div class="info-row"><div class="info-label">Format:</div><div class="info-value" style="text-transform: capitalize;">${format || "N/A"}</div></div>
          <div class="info-row"><div class="info-label">Relation:</div><div class="info-value">${relation_with_client || "Self"}</div></div>
          <div class="info-row"><div class="info-label">Transaction:</div><div class="info-value">${transactionId}</div></div>
          ${notes ? `<div class="info-row"><div class="info-label">Notes:</div><div class="info-value">${notes}</div></div>` : ''}
        </div>

        <div class="instructions">
          <h4 style="margin-top:0; color:#856404;">Action Required:</h4>
          <ul style="margin-bottom:0; padding-left:20px;">
            <li>Log in to your <strong>Therapist Dashboard</strong> to verify the session.</li>
            <li><strong>Collect PIN:</strong> At the start of the session, collect the client's unique PIN and update it in your dashboard.</li>
            <li><strong>Completion:</strong> After the session, mark it as "Completed" to process the records.</li>
          </ul>
        </div>
      </div>
      <div class="footer">
        <p>Choose Your Therapist LLP &bull; Support Team</p>
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
      body {
        font-family: 'Segoe UI', Arial, sans-serif;
        color: #333;
        line-height: 1.6;
        background-color: #f0f4f8;
        margin: 0;
        padding: 0;
      }
      .container {
        max-width: 600px;
        margin: 30px auto;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 10px 25px rgba(0,0,0,0.05);
        background: #ffffff;
      }
      .header {
        background: linear-gradient(135deg, #4CAF50 0%, #2e7d32 100%);
        color: white;
        padding: 40px 20px;
        text-align: center;
      }
      .header h1 {
        margin: 0;
        font-size: 26px;
        letter-spacing: 1px;
      }
      .content {
        padding: 35px;
      }
      .welcome-text {
        font-size: 18px;
        color: #1a1a1a;
        margin-bottom: 25px;
      }
      .details-card {
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 25px;
        margin-bottom: 30px;
      }
      .details-card h2 {
        margin-top: 0;
        font-size: 16px;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 1px;
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 10px;
        margin-bottom: 20px;
      }
      .detail-row {
        display: flex;
        margin-bottom: 12px;
      }
      .detail-label {
        flex: 0 0 140px;
        font-weight: 700;
        color: #475569;
      }
      .detail-value {
        flex: 1;
        color: #1e293b;
      }
      .pin-container {
        text-align: center;
        margin: 30px 0;
        padding: 25px;
        background: #fffbeb;
        border: 2px dashed #fcd34d;
        border-radius: 12px;
      }
      .pin-label {
        font-size: 14px;
        color: #92400e;
        margin-bottom: 10px;
        font-weight: 600;
      }
      .pin-value {
        font-family: 'Courier New', monospace;
        font-size: 32px;
        font-weight: 800;
        color: #1e293b;
        letter-spacing: 5px;
      }
      .instructions {
        margin-top: 30px;
      }
      .instructions h3 {
        color: #2e7d32;
        font-size: 18px;
        margin-bottom: 15px;
      }
      .instruction-item {
        margin-bottom: 12px;
        display: flex;
        align-items: flex-start;
      }
      .instruction-num {
        background: #e8f5e9;
        color: #2e7d32;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        text-align: center;
        line-height: 24px;
        font-size: 12px;
        font-weight: 700;
        margin-right: 12px;
        flex-shrink: 0;
      }
      .footer {
        background: #f1f5f9;
        padding: 25px;
        text-align: center;
        color: #64748b;
        font-size: 14px;
      }
      .social-links {
        margin-top: 15px;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h1>Booking Confirmed</h1>
      </div>
      <div class="content">
        <p class="welcome-text">Dear <strong>${clientName}</strong>,</p>
        <p>Your therapy session has been successfully booked. We're committed to supporting you on your wellness journey.</p>

        <div class="details-card">
          <h2>Session Details</h2>
          <div class="detail-row">
            <div class="detail-label">Therapist</div>
            <div class="detail-value">${therapistName}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Service</div>
            <div class="detail-value">${service || "Counseling"}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Format</div>
            <div class="detail-value" style="text-transform: capitalize;">${format || "Video Session"}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Patient Name</div>
            <div class="detail-value">${cname || clientName} ${clientAge ? '(' + clientAge + 'y)' : ''}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Relationship</div>
            <div class="detail-value">${relation_with_client || "Self"}</div>
          </div>
          <div class="detail-row">
            <div class="detail-label">Transaction ID</div>
            <div class="detail-value">${transactionId}</div>
          </div>
          ${notes ? `<div class="detail-row"><div class="detail-label">Notes</div><div class="detail-value">${notes}</div></div>` : ''}
        </div>

        <div class="pin-container">
          <div class="pin-label">YOUR UNIQUE SESSION PIN</div>
          <div class="pin-value">${pin}</div>
          <p style="margin-top:15px; font-size:13px; color: #b45309;">Share this PIN with your therapist <strong>only</strong> when the session starts.</p>
        </div>

        <div class="instructions">
          <h3>Next Steps:</h3>
          <div class="instruction-item">
            <div class="instruction-num">1</div>
            <div>Access your personal <strong>Dashboard</strong> to manage your booking and check payment status.</div>
          </div>
          <div class="instruction-item">
            <div class="instruction-num">2</div>
            <div>Be ready at the scheduled time. Your therapist will initiate the session based on the chosen format.</div>
          </div>
          <div class="instruction-item">
            <div class="instruction-num">3</div>
            <div>Provide the PIN above to your therapist at the beginning of the call to verify the session.</div>
          </div>
        </div>

        <p style="margin-top: 30px;">If you have any questions, our support team is always here to help.</p>
      </div>
      <div class="footer">
        <p><strong>Choose Your Therapist LLP</strong><br/>
        Professional Mental Health Support Platform</p>
        <p>&copy; ${new Date().getFullYear()} CYT. All rights reserved.</p>
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
    <title>New Session Notification</title>
    <style>
      body { font-family: 'Segoe UI', Arial, sans-serif; color: #333; line-height: 1.5; background-color: #f8fafc; margin: 0; }
      .container { max-width: 650px; margin: 20px auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
      .header { background: #1e293b; color: #ffffff; padding: 25px; text-align: center; }
      .content { padding: 30px; }
      .status-badge { display: inline-block; padding: 4px 12px; background: #dcfce7; color: #166534; border-radius: 99px; font-size: 12px; font-weight: 700; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
      th { text-align: left; padding: 12px; background: #f1f5f9; color: #475569; font-size: 13px; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
      td { padding: 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
      .label { font-weight: 600; color: #64748b; width: 160px; font-size: 14px; }
      .value { color: #1e293b; font-size: 15px; }
      .section-head { font-size: 16px; font-weight: 700; color: #1e293b; margin: 25px 0 15px 0; display: flex; align-items: center; }
      .footer { background: #f8fafc; padding: 20px; text-align: center; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <h2 style="margin:0">New Session Booked</h2>
      </div>
      <div class="content">
        <div class="status-badge">PAYMENT RECEIVED</div>
        <p>A new therapy session has been confirmed and recorded in the system.</p>

        <div class="section-head">Client & Session Details</div>
        <table>
          <tr><td class="label">Client Name</td><td class="value">${clientName}</td></tr>
          <tr><td class="label">Patient (Age)</td><td class="value">${cname || clientName} ${clientAge ? '('+clientAge+')' : ''}</td></tr>
          <tr><td class="label">Service</td><td class="value">${service || "N/A"}</td></tr>
          <tr><td class="label">Format</td><td class="value">${format || "N/A"}</td></tr>
          <tr><td class="label">Whom / Relation</td><td class="value">${whom} / ${relation_with_client || "Self"}</td></tr>
          <tr><td class="label">Amount Paid</td><td class="value"><strong>₹${paymentAmount}</strong></td></tr>
          <tr><td class="label">Transaction ID</td><td class="value"><code>${transactionId}</code></td></tr>
          ${notes ? `<tr><td class="label">Notes</td><td class="value">${notes}</td></tr>` : ''}
        </table>

        <div class="section-head">Assigned Therapist</div>
        <table>
          <tr><td class="label">Therapist Name</td><td class="value">${therapistName}</td></tr>
          <tr><td class="label">Profile Code</td><td class="value">${therapistId}</td></tr>
        </table>

        <p style="color: #64748b; font-size: 14px;">Please ensure the therapist is notified and the session proceeds as scheduled.</p>
      </div>
      <div class="footer">
        <p>CYT Management System &bull; Confidential Internal Notification</p>
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
        <div class="field">
          <div class="label">${key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}</div>
          <div class="value">${value}</div>
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
  <title>New Lead Notification</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f4f7f9;
    }
    .container {
      max-width: 600px;
      margin: 20px auto;
      padding: 0;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      background-color: #ffffff;
    }
    .header {
      background-color: #4CAF50;
      color: #ffffff;
      padding: 30px 20px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .content {
      padding: 30px;
    }
    .intro {
      margin-bottom: 25px;
      color: #555;
      font-size: 16px;
    }
    .section-title {
      font-size: 18px;
      color: #2e7d32;
      border-bottom: 2px solid #e8f5e9;
      padding-bottom: 8px;
      margin: 25px 0 15px 0;
      font-weight: 600;
    }
    .info-grid {
      display: flex;
      flex-wrap: wrap;
    }
    .field {
      width: 100%;
      margin-bottom: 15px;
      padding: 12px;
      background-color: #f9f9f9;
      border-radius: 8px;
      border-left: 4px solid #4CAF50;
    }
    .label {
      font-size: 12px;
      text-transform: uppercase;
      color: #888;
      font-weight: 700;
      margin-bottom: 4px;
      letter-spacing: 0.5px;
    }
    .value {
      font-size: 16px;
      color: #222;
      font-weight: 500;
    }
    .footer {
      background-color: #f1f1f1;
      padding: 20px;
      text-align: center;
      font-size: 14px;
      color: #777;
    }
    .cta-button {
      display: inline-block;
      padding: 12px 24px;
      background-color: #4CAF50;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>New Lead Received</h1>
    </div>
    <div class="content">
      <p class="intro">A new consultation request has been submitted through the website. Here are the details for your follow-up.</p>
      
      <div class="section-title">Lead Information</div>
      <div class="info-grid">
        <div class="field">
          <div class="label">Full Name</div>
          <div class="value">${name || "N/A"}</div>
        </div>
        <div class="field">
          <div class="label">Phone Number</div>
          <div class="value">${phone || "N/A"}</div>
        </div>
        <div class="field">
          <div class="label">Email Address</div>
          <div class="value">${email || "N/A"}</div>
        </div>
        <div class="field">
          <div class="label">Source</div>
          <div class="value">${source || "N/A"}</div>
        </div>
        <div class="field">
          <div class="label">Reason / Concern</div>
          <div class="value">${displayConcern}</div>
        </div>
        ${additionalFieldsHtml}
      </div>
      
      <center>
        <a href="mailto:${email}" class="cta-button">Reply to Client</a>
      </center>
    </div>
    <div class="footer">
      <p>This is an automated notification from Choose Your Therapist (CYT) System.</p>
      <p>&copy; ${new Date().getFullYear()} Choose Your Therapist LLP. All rights reserved.</p>
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
  <style>
    .container { max-width: 500px; margin: 20px auto; font-family: sans-serif; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }
    .header { background: #2563eb; color: #fff; padding: 25px; text-align: center; }
    .content { padding: 30px; line-height: 1.6; color: #334155; }
    .otp-box { background: #f8fafc; border: 2px dashed #cbd5e1; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px; }
    .otp-code { font-size: 32px; font-weight: 800; letter-spacing: 5px; color: #1e293b; }
    .footer { background: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h2>${title}</h2></div>
    <div class="content">
      <p>Hello <strong>${greeting}</strong>,</p>
      <p>${message}</p>
      <div class="otp-box">
        <div style="font-size: 12px; color: #64748b; margin-bottom: 8px; text-transform: uppercase; font-weight: 700;">Verification Code</div>
        <div class="otp-code">${otp}</div>
      </div>
      <p>This code is valid for a limited time. Please do not share this OTP with anyone.</p>
    </div>
    <div class="footer">Choose Your Therapist (CYT) &bull; Mental Wellness Platform</div>
  </div>
</body>
</html>
`;

export const loginOtpEmail = (name, otp) => 
  baseOtpTemplate("Login Verification", name, "Use the following code to complete your login to CYT.", otp);

export const registrationOtpEmail = (name, otp) => 
  baseOtpTemplate("Welcome to CYT", name, "Thank you for joining us! Please verify your email with the code below.", otp);

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

