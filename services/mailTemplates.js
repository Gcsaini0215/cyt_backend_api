// ============================================================================
// Choose Your Therapist — transactional email system  ·  "Statement" design
// ----------------------------------------------------------------------------
// White card on warm grey · one deep-green accent · structured detail tables ·
// the number that matters (code / PIN / amount) blown up as the hero.
// Warm messages (confirmations, reminders, certificate) carry a calm banner;
// security + internal-alert mails stay clean and bannerless on purpose.
//
// All builders return a full HTML string ready for helper/mailer.js -> sendMail.
// ============================================================================

const BRAND = {
  name: "Choose Your Therapist",
  email: "hello@chooseyourtherapist.in",
  phone: "+91 80777 57951",
  site: "https://chooseyourtherapist.in",
  green: "#0f3d24",
  ink: "#111111",
  soft: "#5f645d",
  faint: "#8a8f88",
  line: "#ededea",
  ground: "#f4f4f1",
};

const OK = "#15803d";   // confirmed / success
const WARN = "#b45309";  // pending / rescheduled
const STOP = "#b91c1c";  // cancelled
const INFO = "#0f3d24";  // neutral informational
const MUTE = "#8a8f88";  // low-key (security codes, check-ins)

// escape user-supplied text before it lands in markup
const esc = (s) =>
  String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

const defaultFoot =
  `${BRAND.name} LLP &middot; <a href="mailto:${BRAND.email}" style="color:#9a9f97;text-decoration:none;">${BRAND.email}</a> &middot; ${BRAND.phone}`;

// ---- layout ---------------------------------------------------------------

// warm relatable banner — hosted photo (soft daylight through green leaves).
// Falls back to a calm green wash if the recipient blocks images.
// To self-host later, swap BANNER_IMG for your own https URL (~1200x300, jpg).
const BANNER_IMG =
  "https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=1200&h=300&q=70";

const bannerRow = () => `
  <tr><td style="padding:0;font-size:0;line-height:0;background:#e6efe8;">
    <img src="${BANNER_IMG}" alt="" width="400" style="display:block;width:100%;max-width:400px;height:96px;object-fit:cover;border-bottom:1px solid ${BRAND.line};" />
  </td></tr>`;

const shell = ({ preheader = "", withBanner = false, body = "", foot }) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${BRAND.name}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.ground};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.ground};padding:20px 12px;font-family:'Helvetica Neue',Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="400" cellpadding="0" cellspacing="0" border="0" style="width:400px;max-width:400px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08),0 10px 26px rgba(0,0,0,0.06);">
        <tr><td style="padding:15px 20px;border-bottom:1px solid ${BRAND.line};">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="width:26px;height:26px;background:${BRAND.green};border-radius:13px;color:#ffffff;font-size:9px;font-weight:700;text-align:center;line-height:26px;font-family:Arial,sans-serif;letter-spacing:0.5px;">CYT</td>
            <td style="padding-left:9px;font-size:13.5px;font-weight:700;color:${BRAND.ink};font-family:'Helvetica Neue',Arial,sans-serif;">${BRAND.name}</td>
          </tr></table>
        </td></tr>
        ${withBanner ? bannerRow() : ""}
        <tr><td style="padding:22px 20px;color:${BRAND.ink};font-family:'Helvetica Neue',Arial,sans-serif;">
          ${body}
        </td></tr>
        <tr><td style="background:#fafaf8;border-top:1px solid ${BRAND.line};padding:13px 20px;font-size:10px;color:#9a9f97;line-height:1.55;font-family:'Helvetica Neue',Arial,sans-serif;">
          ${foot || defaultFoot}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ---- components (callers escape their own dynamic values) ----------------

const eyebrow = (text, color = MUTE) =>
  `<div style="font-size:10.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${color};margin-bottom:12px;">&#9679;&nbsp; ${text}</div>`;

const heading = (html) =>
  `<div style="font-size:17px;font-weight:700;line-height:1.3;margin-bottom:8px;color:${BRAND.ink};">${html}</div>`;

const para = (html) =>
  `<div style="font-size:13px;color:${BRAND.soft};line-height:1.65;margin-bottom:16px;">${html}</div>`;

const note = (html) =>
  `<div style="font-size:11.5px;color:#6b7069;line-height:1.55;margin-bottom:14px;">${html}</div>`;

// rows: [label, valueHtml, mono?]  — falsy rows are dropped
const kvTable = (rows) => {
  const clean = rows.filter(Boolean);
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-bottom:16px;">
    ${clean.map(([k, v, mono], i) => {
      const b = i === clean.length - 1 ? "0" : "1px solid #f0f0ed";
      return `<tr>
      <td style="padding:9px 12px 9px 0;border-bottom:${b};font-size:12px;color:${BRAND.faint};vertical-align:top;">${k}</td>
      <td style="padding:9px 0;border-bottom:${b};font-size:12px;color:${BRAND.ink};font-weight:600;text-align:right;vertical-align:top;${mono ? "font-family:'Courier New',Courier,monospace;font-weight:400;" : ""}">${v}</td>
    </tr>`;
    }).join("")}
  </table>`;
};

const codeHero = (otp) => `
  <div style="background:#f0f4f1;border-radius:12px;text-align:center;padding:20px 12px;margin-bottom:12px;">
    <div style="font-family:'Courier New',Courier,monospace;font-size:31px;font-weight:700;letter-spacing:7px;color:${BRAND.green};">${esc(otp)}</div>
  </div>
  <div style="text-align:center;margin-bottom:16px;">
    <span style="display:inline-block;background:#fef9c3;color:#854d0e;font-size:11px;font-weight:600;padding:4px 11px;border-radius:999px;">Valid for 10 minutes</span>
  </div>`;

const securityNote = `<div style="font-size:11.5px;color:#6b7069;line-height:1.55;">${BRAND.name} will never ask you for this code by call, chat or email. If you didn't request it, you can safely ignore this message.</div>`;

const pinBlock = (pin, caption = "Share with your therapist only when the session begins") => `
  <div style="border:1px dashed #c9cdc6;border-radius:12px;text-align:center;padding:14px;margin-bottom:16px;">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${BRAND.faint};margin-bottom:7px;">Session PIN</div>
    <div style="font-family:'Courier New',Courier,monospace;font-size:26px;font-weight:700;letter-spacing:7px;color:${BRAND.green};">${esc(pin)}</div>
    <div style="font-size:11px;color:#9a9f97;margin-top:6px;">${caption}</div>
  </div>`;

const button = (label, href = BRAND.site) => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px auto 0;"><tr>
    <td style="background:${BRAND.green};border-radius:999px;">
      <a href="${href}" style="display:inline-block;padding:11px 26px;font-size:12.5px;font-weight:600;color:#ffffff;text-decoration:none;font-family:'Helvetica Neue',Arial,sans-serif;">${label}</a>
    </td>
  </tr></table>`;

// ============================================================================
// ONE-TIME CODES  (bannerless)
// ============================================================================

const otpMail = ({ title, greetingName, intro, otp, eyebrowText, eyebrowColor = MUTE }) =>
  shell({
    preheader: `${otp} is your ${BRAND.name} code`,
    body:
      eyebrow(eyebrowText, eyebrowColor) +
      heading(title) +
      (greetingName ? para(`Hi ${esc(greetingName)},`) : "") +
      para(intro) +
      codeHero(otp) +
      securityNote,
    foot: `${BRAND.name} &middot; Automated security message &middot; Please don't reply.`,
  });

export const loginOtpEmail = (name, otp) =>
  otpMail({ title: "Sign in to CYT", greetingName: name, intro: "Enter this code to finish signing in.", otp, eyebrowText: "Verification code" });

export const registrationOtpEmail = (name, otp) =>
  otpMail({ title: "Welcome to CYT", greetingName: name, intro: "One step left — confirm your email with the code below.", otp, eyebrowText: "Confirm your email", eyebrowColor: INFO });

export const newsletterSubscriptionOtpEmail = (_email, otp) =>
  otpMail({ title: "Confirm your subscription", intro: "Verify your email to start receiving the CYT newsletter.", otp, eyebrowText: "Confirm subscription", eyebrowColor: INFO });

export const therapistVerificationEmail = (_email, otp) =>
  otpMail({ title: "Verify your email", intro: "Your application is under review. Verify your email to continue onboarding.", otp, eyebrowText: "Therapist onboarding", eyebrowColor: INFO });

export const otpVerificationEmail = (otp) =>
  otpMail({ title: "Verify to continue", intro: "Use this one-time code to verify your email and continue.", otp, eyebrowText: "Verification code" });

export const passwordResetMail = ({ name, otp }) =>
  shell({
    preheader: `${otp} is your password reset code`,
    body:
      eyebrow("Password reset", WARN) +
      heading("Reset your password") +
      (name ? para(`Hi ${esc(name)},`) : "") +
      para("Use this code to set a new password. If you didn't ask for this, you can ignore this email.") +
      codeHero(otp) +
      securityNote,
    foot: `${BRAND.name} &middot; Automated security message &middot; Please don't reply.`,
  });

// ============================================================================
// BOOKING
// ============================================================================

export const bookingRequestReceivedMail = ({
  clientName, therapistName, service, format, sessionDateTime, sessionMode, whom, cname, relation_with_client, notes,
}) =>
  shell({
    preheader: "Complete payment to confirm your session",
    body:
      eyebrow("Payment pending", WARN) +
      heading("We've got your request") +
      para(`Dear ${esc(clientName || "there")}, your session with ${esc(therapistName || "your therapist")} is being held for you. It's confirmed the moment payment is complete.`) +
      kvTable([
        ["Therapist", esc(therapistName || "—")],
        ["Service", esc(service || "Counselling")],
        ["Format", esc(format || "Video session")],
        sessionMode && ["Mode", esc(sessionMode)],
        ["Requested slot", esc(sessionDateTime || "To be confirmed")],
        cname && ["Patient", esc(cname)],
      ]) +
      note("You'll get your session PIN and full confirmation by email as soon as payment succeeds.") +
      button("Complete payment"),
  });

export const bookingConfirmationMail = ({
  clientName, therapistName, clientAge, transactionId, service, format, sessionDateTime, sessionMode, whom, cname, relation_with_client, notes, pin,
}) =>
  shell({
    preheader: `Confirmed · ${sessionDateTime || "your session"}${pin ? " · PIN " + pin : ""}`,
    withBanner: true,
    body:
      eyebrow("Booking confirmed", OK) +
      heading(esc(therapistName || "Your session is confirmed")) +
      para(`${esc(service || "Counselling")} &middot; ${esc(format || "Video session")}`) +
      kvTable([
        ["Date & time", esc(sessionDateTime || "To be confirmed")],
        sessionMode && ["Mode", esc(sessionMode)],
        cname && ["Patient", `${esc(cname)}${clientAge ? " (" + esc(clientAge) + ")" : ""}`],
        transactionId && ["Transaction", esc(transactionId), true],
      ]) +
      (pin ? pinBlock(pin) : "") +
      button("View in dashboard"),
    foot: `${BRAND.name} LLP &middot; Keep this email as your receipt.`,
  });

export const therapistSessionMail = ({
  therapistName, clientName, clientAge, paymentAmount, transactionId, service, format, sessionDateTime, sessionMode, whom, cname, relation_with_client, notes,
}) =>
  shell({
    preheader: `New session · ${clientName || ""} · ${sessionDateTime || ""}`,
    body:
      eyebrow("New session", INFO) +
      heading("New session assigned") +
      para(`Hello${therapistName ? " " + esc(therapistName) : ""}, a new session has been booked with you. Log in to verify it and view the details.`) +
      kvTable([
        ["Client", `${esc(clientName || "—")}${clientAge ? " (" + esc(clientAge) + ")" : ""}`],
        cname && cname !== clientName && ["Patient", esc(cname)],
        ["Service", esc(service || "N/A")],
        ["Format", esc(format || "N/A")],
        ["Date & time", esc(sessionDateTime || "To be confirmed")],
        sessionMode && ["Mode", esc(sessionMode)],
        transactionId && ["Transaction", esc(transactionId), true],
        notes && ["Notes", esc(notes)],
      ]) +
      note("Collect the client's PIN at the start of the session, then mark it complete when you're done.") +
      button("Open therapist dashboard"),
  });

export const newSessionAdminMail = ({
  clientName, clientAge, paymentAmount, transactionId, therapistName, therapistId, service, format, sessionDateTime, sessionMode, whom, cname, relation_with_client, notes,
}) =>
  shell({
    preheader: "New booking recorded",
    body:
      eyebrow("Payment received", OK) +
      heading("New booking recorded") +
      kvTable([
        ["Client", `${esc(clientName || "—")}${clientAge ? " (" + esc(clientAge) + ")" : ""}`],
        cname && cname !== clientName && ["Patient", esc(cname)],
        ["Therapist", `${esc(therapistName || "—")}${therapistId ? " &middot; " + esc(therapistId) : ""}`],
        ["Service", esc(service || "N/A")],
        ["Format", esc(format || "N/A")],
        ["Date & time", esc(sessionDateTime || "To be confirmed")],
        sessionMode && ["Mode", esc(sessionMode)],
        relation_with_client && ["Relation", esc(relation_with_client)],
        (paymentAmount || paymentAmount === 0) && ["Amount", `&#8377;${esc(paymentAmount)}`],
        transactionId && ["Transaction", esc(transactionId), true],
        notes && ["Notes", esc(notes)],
      ]),
    foot: "CYT Management System &middot; Internal notification",
  });

export const bookingCancelledMail = ({ recipientName, otherPartyName, service, format, booking_date, action }) => {
  const label = action === "deleted" ? "removed" : "cancelled";
  const when = booking_date ? new Date(booking_date).toLocaleString("en-IN") : null;
  return shell({
    preheader: `Your session has been ${label}`,
    body:
      eyebrow(`Booking ${label}`, STOP) +
      heading(`Your session was ${label}`) +
      para(`Dear ${esc(recipientName || "there")}, your session with ${esc(otherPartyName || "the other party")} has been ${label} by our team.`) +
      kvTable([
        ["Service", `${esc(service || "Counselling")} &middot; ${esc(format || "Video session")}`],
        when && ["Was scheduled", esc(when)],
      ]) +
      note(`Questions about this? Just reply to this email, or write to <a href="mailto:${BRAND.email}" style="color:${BRAND.green};">${BRAND.email}</a>.`),
  });
};

// ============================================================================
// APPOINTMENT REQUESTS  (pre-booking enquiry flow)
// ============================================================================

export const appointmentStatusMail = ({ firstName, isConfirmed, confirmedTime, concern, phone, adminNote }) =>
  shell({
    preheader: isConfirmed ? "Your appointment is confirmed" : "Your appointment has been rescheduled",
    withBanner: true,
    body:
      eyebrow(isConfirmed ? "Appointment confirmed" : "Appointment rescheduled", isConfirmed ? OK : WARN) +
      heading(`Hi ${esc(firstName || "there")}!`) +
      para(
        isConfirmed
          ? "Good news — your appointment has been confirmed. We look forward to seeing you."
          : "Your appointment has been rescheduled. Please note the updated time below."
      ) +
      kvTable([
        confirmedTime && [isConfirmed ? "Confirmed time" : "New time", esc(confirmedTime)],
        concern && ["Concern", esc(concern)],
        phone && ["Your phone", esc(phone)],
      ]) +
      (adminNote ? note(esc(adminNote)) : "") +
      note(`Any questions or need to reschedule? WhatsApp us at ${BRAND.phone} or reply to this email.`),
  });

// ============================================================================
// NOIDA CENTER — CALENDLY-STYLE BOOKING
// ============================================================================

export const noidaAppointmentConfirmationEmail = ({ name, date, slot, concern }) =>
  shell({
    preheader: `Your Noida center visit is booked for ${date}, ${slot}`,
    withBanner: true,
    body:
      eyebrow("Appointment confirmed", OK) +
      heading(`See you soon, ${esc((name || "there").split(/\s+/)[0])}`) +
      para("Your in-person session at our Noida therapy center is booked. Please arrive 10 minutes early.") +
      kvTable([
        ["Date", esc(date)],
        ["Time", esc(slot)],
        concern && ["Concern", esc(concern)],
      ]) +
      note(`Need to reschedule or cancel? WhatsApp us at ${BRAND.phone} or reply to this email.`),
  });

// ============================================================================
// INTERNAL ALERTS  (sent to the CYT inbox, not to clients)
// ============================================================================

export const leadNotificationEmail = (data) => {
  const { name, phone, email, concern, source, age, ...others } = data;
  const getVal = (v) => (v && v !== "Not provided" ? v : null);

  let displayAge = age || "";
  let displayConcern =
    getVal(concern) || getVal(others.reason) || getVal(others.service) || getVal(others.message) || "N/A";

  if (!displayAge && String(displayConcern).includes("Age:")) {
    const ageMatch = String(displayConcern).match(/Age:\s*(.+)/);
    const concernMatch = String(displayConcern).match(/Concern:\s*([\s\S]+)/);
    if (ageMatch) displayAge = ageMatch[1].trim();
    if (concernMatch) displayConcern = concernMatch[1].trim();
  }

  let num = phone ? String(phone).replace(/\D/g, "") : "";
  if (num.length === 10) num = "91" + num; // bare Indian mobile -> add country code
  const tel = num ? "+" + num : "";
  const wa = num ? "https://wa.me/" + num : "";
  const first = (name || "them").split(/\s+/)[0];
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

  const amount = getVal(others.amount);
  const kicker = amount ? `Paid consultation &middot; &#8377;${esc(amount)}` : "Consultation request";

  const dl = (label, val) =>
    val
      ? `<tr>
          <td style="padding:11px 0;border-bottom:1px solid #ece9e2;font-family:Arial,sans-serif;font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:#a0a096;width:34%;vertical-align:top;">${label}</td>
          <td style="padding:11px 0;border-bottom:1px solid #ece9e2;font-size:13.5px;color:#222;vertical-align:top;">${val}</td>
        </tr>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${BRAND.name} — new lead</title>
</head>
<body style="margin:0;padding:0;background:#eceee8;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">New ${amount ? "paid " : ""}consultation lead: ${esc(name || "")}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eceee8;padding:18px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#fcfcfa;font-family:Georgia,'Times New Roman',serif;">
        <tr><td style="padding:0;font-size:0;line-height:0;">
          <img src="https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=1200&h=360&q=70" alt="" width="600" style="display:block;width:100%;max-width:600px;height:132px;object-fit:cover;" />
        </td></tr>
        <tr><td style="padding:30px 30px 10px;">
          <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#8a8a80;">${kicker}</div>
          <div style="font-size:24px;color:#222;margin-top:10px;line-height:1.25;">A new person has asked to talk</div>
          <div style="font-family:Arial,sans-serif;font-size:12px;color:#8a8a80;margin-top:8px;">Received ${esc(now)} IST</div>
        </td></tr>
        <tr><td style="padding:8px 30px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
            ${dl("Name", esc(name || "&mdash;"))}
            ${dl("Phone", tel ? `<a href="tel:${tel}" style="color:#3f6b4f;">${esc(phone)}</a>` : esc(phone || "&mdash;"))}
            ${dl("Email", email ? `<a href="mailto:${esc(email)}" style="color:#3f6b4f;">${esc(email)}</a>` : "&mdash;")}
            ${dl("Age", esc(displayAge || ""))}
            ${dl("Source", esc(source || "Website"))}
          </table>
          <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:#a0a096;margin:22px 0 8px;">In their words</div>
          <div style="font-size:14.5px;color:#33332e;font-style:italic;line-height:1.8;">&ldquo;${esc(displayConcern)}&rdquo;</div>
        </td></tr>
        <tr><td style="padding:24px 30px 30px;">
          ${tel ? `<a href="tel:${tel}" style="font-family:Arial,sans-serif;font-size:13px;color:#ffffff;background:#3f6b4f;padding:12px 26px;border-radius:6px;font-weight:700;text-decoration:none;display:inline-block;">Call ${esc(first)}</a>` : ""}
          ${wa ? `<a href="${wa}" style="font-family:Arial,sans-serif;font-size:13px;color:#3f6b4f;padding:12px 18px;text-decoration:none;display:inline-block;">or WhatsApp &rarr;</a>` : ""}
        </td></tr>
        <tr><td style="padding:16px 30px;border-top:1px solid #ece9e2;font-family:Arial,sans-serif;font-size:10px;color:#a0a096;">
          ${BRAND.name} &middot; forwarded from the consultation form
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
};

// ============================================================================
// ONBOARDING & LIFECYCLE
// ============================================================================

export const therapistApprovedMail = ({ name, email }) =>
  shell({
    preheader: "Your CYT therapist profile is approved",
    body:
      eyebrow("Profile approved", OK) +
      heading(`You're approved${name ? ", " + esc(name) : ""}`) +
      para("Your therapist profile has been successfully approved. You can now sign in and start offering your services to clients.") +
      kvTable([["Login email", esc(email || "—"), true]]) +
      button("Sign in", `${BRAND.site}/login`) +
      note(`Any issues or questions? Write to <a href="mailto:${BRAND.email}" style="color:${BRAND.green};">${BRAND.email}</a>.`),
  });

export const welcomeCredentialsMail = ({ name, email }) =>
  shell({
    preheader: `Welcome to ${BRAND.name}`,
    withBanner: true,
    body:
      eyebrow("Welcome", INFO) +
      heading(`Welcome to CYT${name ? ", " + esc(name) : ""}`) +
      para("Thank you for registering. Use the email below to sign in to your dashboard.") +
      kvTable([["Login email", esc(email || "—"), true]]) +
      button("Go to login", `${BRAND.site}/login`),
  });

export const certificateIssuedMail = ({ recipientName, certLabel, certNumber, role, startDate, endDate }) =>
  shell({
    preheader: `Your ${certLabel || "certificate"} from ${BRAND.name}`,
    withBanner: true,
    body:
      eyebrow("Certificate issued", OK) +
      heading(esc(certLabel || "Certificate")) +
      para(`Dear ${esc(recipientName || "there")}, congratulations! We're pleased to issue your ${esc(certLabel || "certificate")} from ${BRAND.name} LLP.`) +
      kvTable([
        certNumber && ["Certificate no.", esc(certNumber), true],
        role && ["Role / designation", esc(role)],
        startDate && ["Start date", esc(startDate)],
        endDate && ["End date", esc(endDate)],
        ["Organisation", `${BRAND.name} LLP`],
      ]) +
      note(`&#128206; Your certificate is attached as a PDF. Contact <a href="mailto:${BRAND.email}" style="color:${BRAND.green};">${BRAND.email}</a> for a duplicate or any change.`) +
      `<div style="font-size:12px;color:${BRAND.soft};line-height:1.6;margin-top:14px;">With warm regards,<br><strong style="color:${BRAND.ink};">Mr. Deepak Kumar</strong><br>Director, Psychologist &middot; ${BRAND.name} LLP</div>`,
  });

export const broadcastMail = ({ firstName, message, ctaText, ctaLink }) =>
  shell({
    preheader: message ? String(message).replace(/\s+/g, " ").slice(0, 90) : `A note from ${BRAND.name}`,
    withBanner: true,
    body:
      eyebrow("From the CYT team", INFO) +
      heading(`Hi ${esc(firstName || "there")},`) +
      `<div style="font-size:13px;color:${BRAND.soft};line-height:1.7;white-space:pre-wrap;margin-bottom:16px;">${message || ""}</div>` +
      (ctaText && ctaLink ? button(esc(ctaText), ctaLink) : ""),
    foot: "You're receiving this as a member of Choose Your Therapist &middot; Unsubscribe anytime",
  });

export const reminderCheckinMail = ({ firstName, customNote }) =>
  shell({
    preheader: "A gentle check-in from Choose Your Therapist",
    withBanner: true,
    body:
      eyebrow("Checking in", MUTE) +
      heading(`It's been a while, ${esc(firstName || "there")}`) +
      para("Consistency is where therapy does its work. Whenever you're ready to pick things back up, booking your next session takes under a minute.") +
      (customNote ? note(esc(customNote)) : "") +
      button("Book your next session"),
    foot: "You're receiving this as a past client of CYT &middot; Unsubscribe anytime",
  });

// ============================================================================
// PLAIN-TEXT BODIES  (unchanged — used alongside the HTML above)
// ============================================================================

const slotText = (d) => {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "to be confirmed";
  return (
    dt.toLocaleString("en-IN", {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
    }) + " IST"
  );
};

export const clientText = (booking, txId) =>
  `Session Confirmed for ${slotText(booking.booking_date)}. Transaction: ${txId}. Your unique session PIN is ${booking.otp}. Please share this with your therapist at the start of the session.`;

export const therapistText = (booking, txId) =>
  `NEW SESSION assigned for ${slotText(booking.booking_date)}. Client: ${booking.client.name}. Transaction: ${txId}. Please log in to your dashboard for details.`;

export const adminText = (booking, txId) =>
  `CONFIRMED BOOKING: ${booking.client.name} with ${booking.therapist.user.name} on ${slotText(booking.booking_date)}. Amount: ₹${booking.amount}. Transaction: ${txId}.`;
