import crypto from "crypto";

/* Festival "book 1, get 1 free" offers (/festival-therapy on the site).
   The client pays the normal Noida single-session fee for one session; a second, free session comes as
   a link they can use themselves or gift to someone. Both sessions fall within `validDays` of the purchase. */
export const FESTIVAL_OFFERS = {
  "diwali-2026": {
    key: "diwali-2026",
    title: "Diwali 1+1",
    bookBy: "2026-11-07",          // last day to buy (IST)
    blockedDates: ["2026-11-08"],  // no sessions on Diwali
    validDays: 15,                 // both sessions within this many days of buying
    formats: ["in-person", "online"],
  },
};
export const CURRENT_FESTIVAL_OFFER = "diwali-2026";
export const festivalOffer = (key) => FESTIVAL_OFFERS[key] || null;

const pad2 = (n) => String(n).padStart(2, "0");
export function istToday() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Why this session date can't be used under the offer (null = fine). `from` is the purchase day.
export function offerDateProblem(offer, date, from = istToday()) {
  if (offer.blockedDates.includes(date)) return "No sessions on Diwali (8 Nov) — please pick another day.";
  if (date < from) return "Please pick a date from today onwards.";
  if (date > addDays(from, offer.validDays)) return `Under this offer, sessions are within ${offer.validDays} days — please pick an earlier date.`;
  return null;
}

// 8-character link code, XXXX-XXXX, without look-alike characters
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function giftCode() {
  const b = crypto.randomBytes(8);
  const s = Array.from(b, (x) => ALPHA[x % ALPHA.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export const SITE = "https://www.chooseyourtherapist.in";
export const giftLink = (code) => `${SITE}/festival-therapy/gift/${code}`;
