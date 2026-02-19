import nodemailer from "nodemailer";

// Configure the transporter with Namecheap SMTP settings
// const transporter = nodemailer.createTransport({
//   host: "chooseyourtherapist.in", // Namecheap SMTP server
//   port: 465, // SMTP port (typically 465 for secure connection)
//   secure: true, // true for 465, false for other ports
//   auth: {
//     user: "no-reply@chooseyourtherapist.in", // Your Namecheap email address
//     pass: "Cyt&7697deepak", // Your Namecheap email password
//   },
// });

const transporter = nodemailer.createTransport({
 service: 'gmail',
  auth: {
    user: "chooseyourtherapist@gmail.com",
    pass: "thboznmqzpnwcpln",
  },
});


// Function to send an email
export const sendMail = async (to, subject, text, html) => {
  try {
    const info = await transporter.sendMail({
      from: '"ChooseYourTherapist" <chooseyourtherapist@gmail.com>', // Sender address
      to: to, // List of receivers
      subject: subject, // Subject line
      text: text, // Plain text body
      html: html, // HTML body
    });
    console.log("Email sent: %s", info.messageId);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
};
