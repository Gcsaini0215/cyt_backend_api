import expressAsyncHandler from "express-async-handler";
import Booking from "../models/Booking.js";
import NoidaAppointment from "../models/NoidaAppointment.js";

// Public numbers for the website's trust badges: sessions booked so far (online bookings with
// therapists + Noida centre bookings) and the Google rating of the CYT Noida Business Profile.
// Cached in memory — the counts every 10 minutes, the Google rating every 12 hours.

const SESSIONS_TTL = 10 * 60 * 1000;
const GOOGLE_TTL = 12 * 60 * 60 * 1000;
let sessionsCache = { at: 0, data: null };
let googleCache = { at: 0, data: null };

async function sessionCounts() {
  if (sessionsCache.data && Date.now() - sessionsCache.at < SESSIONS_TTL) return sessionsCache.data;
  const [online, noida] = await Promise.all([
    Booking.countDocuments({ payment_status: "Paid" }),
    NoidaAppointment.countDocuments({ status: "confirmed", paymentStatus: { $in: ["paid", "package-credit"] } }),
  ]);
  // the badge counts on from SESSIONS_BASE (sessions before bookings were recorded here; default 5000)
  const base = Number(process.env.SESSIONS_BASE ?? 5000) || 0;
  const data = { total: base + online + noida, base, online, noida, updatedAt: new Date().toISOString() };
  sessionsCache = { at: Date.now(), data };
  return data;
}

// Google rating: Places API (New) when GOOGLE_PLACES_API_KEY + GOOGLE_PLACE_ID are set,
// otherwise the figures in GBP_RATING / GBP_REVIEWS (kept up to date by hand).
async function googleRating() {
  if (googleCache.data && Date.now() - googleCache.at < GOOGLE_TTL) return googleCache.data;
  const fallback = {
    rating: Number(process.env.GBP_RATING || 5.0),
    count: Number(process.env.GBP_REVIEWS || 183),
    source: "manual",
  };
  let data = fallback;
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;
  if (key && placeId) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
        headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "rating,userRatingCount" },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const j = await r.json();
      if (r.ok && typeof j.rating === "number") data = { rating: j.rating, count: j.userRatingCount || 0, source: "google" };
      else console.error("google rating:", j?.error?.message || r.status);
    } catch (e) {
      console.error("google rating:", e.message);
    }
  }
  googleCache = { at: Date.now(), data };
  return data;
}

export const getPublicStats = expressAsyncHandler(async (req, res) => {
  const [sessions, google] = await Promise.all([
    sessionCounts().catch(() => sessionsCache.data),
    googleRating().catch(() => googleCache.data),
  ]);
  res.set("Cache-Control", "public, max-age=300");
  res.json({ status: true, data: { sessions, google } });
});
