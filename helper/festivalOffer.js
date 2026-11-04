import crypto from "crypto";
import FestivalOfferSetting from "../models/FestivalOfferSetting.js";

/* Festival "book 1, get 1 free" offers (/festival-therapy on the site).
   The client pays the normal Noida single-session fee for one session; a second, free session comes as
   a link they can use themselves or gift to someone. Both sessions fall within `validDays` of the purchase. */
export const FESTIVAL_OFFERS = {
  "diwali-2026": {
    key: "diwali-2026",
    title: "Diwali 1+1",
    bookBy: "2026-11-08",          // last day to buy (IST, till 11:59 PM)
    blockedDates: ["2026-11-08"],  // no sessions on Diwali
    validDays: 15,                 // both sessions within this many days of buying
    formats: ["in-person", "online"],
  },
};
export const CURRENT_FESTIVAL_OFFER = "diwali-2026";

// Admin can switch an offer on/off, turn each mode on/off and move its dates (admin → Festival Offer).
// Those overrides live in FestivalOfferSetting and are cached here for a few seconds.
let overrides = {};
let loadedAt = 0;
export async function refreshFestivalSettings(force = false) {
  if (!force && Date.now() - loadedAt < 15000) return;
  try {
    const rows = await FestivalOfferSetting.find().lean();
    overrides = Object.fromEntries(rows.map((r) => [r.key, r]));
    loadedAt = Date.now();
  } catch (e) { console.error("festival settings could not be loaded:", e.message); }
}
export const festivalDefaults = (key) => FESTIVAL_OFFERS[key] || null;
// The offer as it runs now: defaults + admin's switches. Call refreshFestivalSettings() first in a request.
export const festivalOffer = (key) => {
  const base = FESTIVAL_OFFERS[key];
  if (!base) return null;
  const o = overrides[key] || {};
  return {
    ...base,
    active: o.active !== false,
    formats: Array.isArray(o.formats) ? base.formats.filter((f) => o.formats.includes(f)) : base.formats,
    bookBy: o.bookBy || base.bookBy,
    blockedDates: Array.isArray(o.blockedDates) ? o.blockedDates : base.blockedDates,
    validDays: Number(o.validDays) > 0 ? Number(o.validDays) : base.validDays,
    dateFormats: o.dateFormats && typeof o.dateFormats === "object" ? o.dateFormats : {},
  };
};
// Modes open on one day: the offer's modes, narrowed by that day's own switch (admin → Festival Offer → by date).
export function formatsOn(offer, date) {
  const day = date && offer.dateFormats?.[date];
  return Array.isArray(day) ? offer.formats.filter((f) => day.includes(f)) : offer.formats;
}
// "Only online sessions are on right now." etc. — when the asked-for mode is switched off
export function formatProblem(offer, format, date) {
  if (offer.formats.includes(format)) {
    if (!date) return null;
    const on = formatsOn(offer, date);
    if (on.includes(format)) return null;
    if (!on.length) return "There are no sessions on this day — please pick another day.";
    return on[0] === "online" ? "Only online sessions on this day — please choose Online or pick another day." : "Only in-person sessions on this day — please choose In-person or pick another day.";
  }
  if (!offer.formats.length) return "Sessions under this offer are paused right now. Please WhatsApp us.";
  if (offer.formats.length === 1) return offer.formats[0] === "online" ? "Only online sessions are available right now." : "Only in-person sessions (Noida centre) are available right now.";
  return "Please choose in-person or online.";
}

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
  if (offer.blockedDates.includes(date)) return "No sessions on this day (festival holiday) — please pick another day.";
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
