// Sends a sample of all 20 transactional emails (new "Statement" design)
// to one address, so you can eyeball them in one inbox.
//
//   node send-samples.js you@example.com
//
// Delete when done:  rm send-samples.js
import "dotenv/config";
import { sendMail, sendReminderMail } from "./helper/mailer.js";
import * as T from "./services/mailTemplates.js";

const TO = process.argv[2];
if (!TO || !TO.includes("@")) {
  console.error("Usage: node send-samples.js you@example.com");
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const d = {
  clientName: "Aarav Sharma",
  therapistName: "Dr. Meera Nair",
  clientAge: 27,
  transactionId: "pay_SAMPLE12345",
  paymentAmount: 1499,
  service: "Individual Counselling",
  format: "Video",
  sessionDateTime: "Wed, 10 Sep 2025, 5:30 PM IST",
  sessionMode: "Google Meet",
  cname: "Aarav Sharma",
  relation_with_client: "Self",
  notes: "First session — anxiety management.",
  pin: "4821",
  therapistId: "CYT-THP-014",
};

const items = [
  ["Login OTP", T.loginOtpEmail(d.clientName, "482913")],
  ["Registration OTP", T.registrationOtpEmail(d.clientName, "716245")],
  ["Newsletter OTP", T.newsletterSubscriptionOtpEmail(TO, "330199")],
  ["Therapist onboarding OTP", T.therapistVerificationEmail(TO, "550821")],
  ["Guest verification code", T.otpVerificationEmail("903214")],
  ["Password reset OTP", T.passwordResetMail({ name: d.clientName, otp: "558210" })],

  ["Booking request received", T.bookingRequestReceivedMail(d)],
  ["Booking confirmed + PIN", T.bookingConfirmationMail(d)],
  ["New session (therapist)", T.therapistSessionMail(d)],
  ["New session (admin)", T.newSessionAdminMail(d)],
  ["Booking cancelled (client)", T.bookingCancelledMail({ recipientName: d.clientName, otherPartyName: d.therapistName, service: d.service, format: d.format, booking_date: new Date(), action: "cancelled" })],
  ["Booking cancelled (therapist)", T.bookingCancelledMail({ recipientName: d.therapistName, otherPartyName: d.clientName, service: d.service, format: d.format, booking_date: new Date(), action: "cancelled" })],

  ["Appointment confirmed", T.appointmentStatusMail({ firstName: "Aarav", isConfirmed: true, confirmedTime: "10 Sep 2025, 5:30 PM", concern: "Anxiety & sleep", phone: "+91 98765 43210", adminNote: "Please join 5 minutes early." })],
  ["Appointment rescheduled", T.appointmentStatusMail({ firstName: "Aarav", isConfirmed: false, confirmedTime: "12 Sep 2025, 6:00 PM", concern: "Anxiety & sleep", phone: "+91 98765 43210" })],

  ["New lead (admin)", T.leadNotificationEmail({ name: "Priya Verma", phone: "90000 12345", email: "priya@example.com", concern: "Stress & sleep support", source: "Instagram", age: "31" })],

  ["Therapist profile approved", T.therapistApprovedMail({ name: d.therapistName, email: "meera@example.com" })],
  ["Welcome to CYT (credentials)", T.welcomeCredentialsMail({ name: d.therapistName, email: "meera@example.com" })],
  ["Certificate issued", T.certificateIssuedMail({ recipientName: "Aarav Sharma", certLabel: "Internship Completion Certificate", certNumber: "CYT/INT/2025/014", role: "Psychology Intern", startDate: "01 Jun 2025", endDate: "31 Aug 2025" })],
  ["Broadcast / announcement", T.broadcastMail({ firstName: "Aarav", message: "We've added evening appointments for working professionals.\nSessions now run till 9 PM on weekdays.", ctaText: "Book a session", ctaLink: "https://chooseyourtherapist.in" })],
];

const run = async () => {
  let ok = 0, fail = 0;
  for (const [name, html] of items) {
    const sent = await sendMail(TO, "[SAMPLE] " + name, "Sample: " + name, html, "CYT Samples");
    console.log((sent ? "  OK   " : "  FAIL ") + name);
    sent ? ok++ : fail++;
    await wait(1500);
  }
  const rem = await sendReminderMail(TO, "Aarav Sharma", "We'd love to see you back whenever you're ready.");
  console.log((rem ? "  OK   " : "  FAIL ") + "Session reminder / check-in");
  rem ? ok++ : fail++;

  console.log(`\nDone. Sent ${ok}, failed ${fail}. Check ${TO} (incl. spam).`);
  process.exit(fail ? 1 : 0);
};

run();
