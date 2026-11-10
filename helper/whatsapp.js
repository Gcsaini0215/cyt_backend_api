import axios from "axios";

// AiSensy WhatsApp (https://backend.aisensy.com). Every message goes out through an "API campaign"
// created in the AiSensy dashboard on top of an approved template; the campaign name picks the template.
//   AISENSY_API_KEY          — dashboard → Manage → API Key
//   AISENSY_OTP_CAMPAIGN     — the live API campaign for the login OTP template
//   AISENSY_OTP_COPY_BUTTON  — "false" if the template has no "Copy code" button (default: it has one,
//                              as Meta's Authentication templates do, and the code must be sent for it too)
const AISENSY_URL = "https://backend.aisensy.com/campaign/t1/api/v2";

export const whatsappEnabled = () => Boolean(process.env.AISENSY_API_KEY && process.env.AISENSY_OTP_CAMPAIGN);

// Users.phone is a bare 10-digit Indian number; AiSensy wants it with the country code, no "+".
const toDestination = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return null;
};

// Never throws: WhatsApp is a second channel next to email, so a failure here must not block a login.
export const sendWhatsappOtp = async (phone, otp, name = "") => {
  if (!whatsappEnabled()) return false;
  const destination = toDestination(phone);
  if (!destination) return false;

  const code = String(otp);
  const body = {
    apiKey: process.env.AISENSY_API_KEY,
    campaignName: process.env.AISENSY_OTP_CAMPAIGN,
    destination,
    userName: name || "CYT user",
    source: "cyt-login",
    templateParams: [code],
  };
  if (process.env.AISENSY_OTP_COPY_BUTTON !== "false") {
    body.buttons = [{ type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: code }] }];
  }

  try {
    await axios.post(AISENSY_URL, body, { timeout: 10000 });
    return true;
  } catch (err) {
    console.error("AiSensy WhatsApp OTP failed:", destination.slice(0, 4) + "******" + destination.slice(-2), err.response?.status, JSON.stringify(err.response?.data || err.message));
    return false;
  }
};
