import crypto from "crypto";
import axios from "axios";
import Jwt from "jsonwebtoken";
import TherapistGoogle from "../models/TherapistGoogle.js";

/* Google Calendar + Meet for therapists who connected their own Google account.
   Plain REST calls (no googleapis dependency). Keys: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. */

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];
const API_BASE = process.env.API_PUBLIC_URL || "https://api.chooseyourtherapist.in";
export const SITE_URL = process.env.SITE_URL || "https://www.chooseyourtherapist.in";
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `${API_BASE}/api/google/callback`;
const SESSION_MINUTES = 60;

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

// refresh tokens are encrypted at rest
const key = () => crypto.createHash("sha256").update(String(process.env.GOOGLE_TOKEN_KEY || process.env.JWT_SECRET || "")).digest();
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}
export function decrypt(blob) {
  const [iv, tag, enc] = String(blob).split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}

// signed, short-lived "state" so the callback knows which therapist is connecting
export function authUrlFor(userId) {
  const state = Jwt.sign({ uid: String(userId), p: "gcal" }, process.env.JWT_SECRET, { expiresIn: "15m", algorithm: "HS256" });
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
export function readState(state) {
  const d = Jwt.verify(state, process.env.JWT_SECRET, { algorithms: ["HS256"] });
  if (d.p !== "gcal" || !d.uid) throw new Error("bad state");
  return d.uid;
}

const form = (o) => new URLSearchParams(o).toString();
const formHeaders = { "Content-Type": "application/x-www-form-urlencoded" };

export async function exchangeCode(code) {
  const { data } = await axios.post("https://oauth2.googleapis.com/token", form({
    code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: REDIRECT_URI, grant_type: "authorization_code",
  }), { headers: formHeaders, timeout: 15000 });
  let email = "";
  try { email = JSON.parse(Buffer.from(String(data.id_token).split(".")[1], "base64url").toString()).email || ""; } catch { /* no id token */ }
  return { refreshToken: data.refresh_token || "", accessToken: data.access_token, scope: data.scope || "", email };
}

async function accessTokenFor(conn) {
  const { data } = await axios.post("https://oauth2.googleapis.com/token", form({
    client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: decrypt(conn.refresh_token), grant_type: "refresh_token",
  }), { headers: formHeaders, timeout: 15000 });
  return data.access_token;
}

export async function revoke(conn) {
  try {
    await axios.post("https://oauth2.googleapis.com/revoke", form({ token: decrypt(conn.refresh_token) }), { headers: formHeaders, timeout: 10000 });
  } catch { /* already revoked */ }
}

export const isOnlineFormat = (format) => !/offline|in[- ]?person|clinic/i.test(String(format || ""));

/* Create the calendar event + Meet link on the therapist's calendar for a paid online booking.
   booking: populated with client (name, email) and therapist.user (_id). Returns { link, eventId } or null.
   Never throws — booking confirmation must not fail because of Google. */
export async function createMeetForBooking(booking) {
  try {
    if (!googleConfigured() || !booking || booking.meet_link || !isOnlineFormat(booking.format)) return null;
    const therapistUserId = booking.therapist?.user?._id || booking.therapist?.user;
    if (!therapistUserId) return null;
    const conn = await TherapistGoogle.findOne({ user: therapistUserId });
    if (!conn) return null;

    const start = new Date(booking.booking_date);
    if (isNaN(start)) return null;
    const end = new Date(start.getTime() + SESSION_MINUTES * 60000);
    const clientEmail = booking.client?.email;
    const first = String(booking.cname || booking.client?.name || "Client").trim().split(/\s+/)[0];

    const token = await accessTokenFor(conn);
    const { data } = await axios.post(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
      {
        summary: `Therapy session with ${first} · Choose Your Therapist`,
        description: `${booking.service || "Session"} booked on Choose Your Therapist.\nOpen your therapist dashboard for the client's details: ${SITE_URL}/appointments`,
        start: { dateTime: start.toISOString(), timeZone: "Asia/Kolkata" },
        end: { dateTime: end.toISOString(), timeZone: "Asia/Kolkata" },
        attendees: clientEmail ? [{ email: clientEmail }] : [],
        guestsCanInviteOthers: false,
        guestsCanSeeOtherGuests: false,
        conferenceData: { createRequest: { requestId: `cyt-${booking._id}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
        reminders: { useDefault: true },
      },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
    );
    const link = data.hangoutLink || data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri || "";
    if (conn.last_error) await TherapistGoogle.updateOne({ _id: conn._id }, { $set: { last_error: "", last_error_at: null } });
    return link ? { link, eventId: data.id } : null;
  } catch (err) {
    const msg = err?.response?.data?.error?.message || err?.response?.data?.error_description || err.message;
    console.error(`[google-meet] booking ${booking?._id}: ${msg}`);
    try {
      const uid = booking?.therapist?.user?._id || booking?.therapist?.user;
      if (uid) await TherapistGoogle.updateOne({ user: uid }, { $set: { last_error: String(msg).slice(0, 300), last_error_at: new Date() } });
    } catch { /* ignore */ }
    return null;
  }
}

// same, but gives up after `ms` so payment confirmation is never held up
export function createMeetWithTimeout(booking, ms = 9000) {
  return Promise.race([createMeetForBooking(booking), new Promise((r) => setTimeout(() => r(null), ms))]);
}
