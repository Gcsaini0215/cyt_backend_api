import Booking from "../models/Booking.js";

/* Chat rules (owner, 2026-11-23):
   - Before any paid booking: the client may ask ONE question; the therapist may send ONE reply.
   - After a paid booking: open while a session is coming up, or until 15 days after the latest session.
     After that the thread is read-only with "Book a session to continue".
   - Phone numbers, emails and outside links are hidden automatically.
   - The therapist can switch chat off and set office hours; outside them the client gets an auto-reply. */

export const OPEN_DAYS = 15;
const DAY = 864e5;

export const CRISIS = /suicid|kill (my ?self|me)|end (my|this) life|want to die|wanna die|self[- ]?harm|hurt myself|cut myself|no reason to live|marna (chahta|chahti|hai)|khud ko (khatam|maar)|jeena nahi|zindagi khatam/i;

// phone numbers (7+ digits, with spaces / dashes / +91), emails, and links that move the chat off CYT
const PHONE = /(?:\+?\d[\s\-().]*){9,}\d/g; // 10+ digits, so dates like 21-11-2026 stay visible
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b(?:wa\.me|t\.me|telegram\.me|instagram\.com|facebook\.com|fb\.me|linkedin\.com|zoom\.us|meet\.google\.com|calendly\.com|upi:\/\/)\S*/gi;
const UPI = /\b[\w.-]{2,}@(?:ok\w+|ybl|ibl|axl|upi|paytm|apl|yapl|icici|sbi|hdfc\w*|kotak|barodampay|aubank|pnb|fbl|jupiteraxis|slc|freecharge)\b/gi;
const WORDS = /\b(?:whatsapp|whats app|watsapp|telegram|insta(?:gram)?|signal app)\b/i;

export function maskContacts(text) {
  let masked = false;
  const hide = () => { masked = true; return "[hidden]"; };
  let out = String(text || "");
  out = out.replace(LINK, hide).replace(EMAIL, hide).replace(UPI, hide).replace(PHONE, hide);
  // naming an outside app is allowed, but counted so the admin can see it
  if (WORDS.test(out)) masked = true;
  return { text: out, masked };
}

/* the state of a client–therapist pair right now */
export async function chatState(clientId, therapistId) {
  const paid = await Booking.find({ client: clientId, therapist: therapistId, payment_status: "Paid", status: { $nin: ["Cancelled", "cancelled", "Refunded"] } }, { booking_date: 1, status: 1 }).lean();
  if (!paid.length) return { mode: "pre" };
  const now = Date.now();
  const upcoming = paid.some((b) => b.booking_date && new Date(b.booking_date).getTime() > now);
  const last = Math.max(...paid.map((b) => (b.booking_date ? new Date(b.booking_date).getTime() : 0)));
  const openUntil = last + OPEN_DAYS * DAY;
  if (upcoming || now <= openUntil) return { mode: "open", openUntil: upcoming ? null : new Date(openUntil) };
  return { mode: "closed", closedAt: new Date(openUntil) };
}

const hm = (s) => { const [h, m] = String(s || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
// is it inside the therapist's office hours (IST)?
export function inOfficeHours(st, at = new Date()) {
  if (!st) return true;
  const ist = new Date(at.getTime() + 5.5 * 36e5);
  const day = ist.getUTCDay(), mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (Array.isArray(st.days) && st.days.length && !st.days.includes(day)) return false;
  const a = hm(st.start), b = hm(st.end);
  return a <= b ? mins >= a && mins < b : mins >= a || mins < b;
}

const fmt12 = (s) => { const t = hm(s); const h = Math.floor(t / 60), m = t % 60; return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`; };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function hoursText(st) {
  if (!st) return "";
  const d = (st.days || []).slice().sort((a, b) => a - b);
  const days = d.length === 7 ? "every day" : d.length === 6 && !d.includes(0) ? "Mon–Sat" : d.length === 5 && !d.includes(0) && !d.includes(6) ? "Mon–Fri" : d.map((x) => DAYS[x]).join(", ");
  return `${days}, ${fmt12(st.start)} – ${fmt12(st.end)}`;
}
