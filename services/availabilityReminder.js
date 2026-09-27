// "Your slots are empty — update your timings" reminder emails for therapists.
//
// Once a day, at a random time between 10:00 and 19:00 IST, look at every approved therapist and
// email the ones whose next 3 days still have free session slots (or who have no hours set at all).
// Each therapist gets at most one reminder every REMIND_EVERY_DAYS, and can switch them off with the
// one-click link in the email. Runs in this process (pm2 fork mode — a single instance) and only when
// AVAILABILITY_REMINDERS=on, so local / dev copies pointed at the live database never send mail.

import crypto from "crypto";
import Therapists from "../models/Therapists.js";
import Booking from "../models/Booking.js";
import { sendMail } from "../helper/mailer.js";
import { therapistAvailabilityReminderMail } from "./mailTemplates.js";

const SITE = (process.env.SITE_URL || "https://www.chooseyourtherapist.in").replace(/\/$/, "");
const API = (process.env.API_PUBLIC_URL || "https://api.chooseyourtherapist.in/api").replace(/\/$/, "");
const REMIND_EVERY_DAYS = 3;
const LOOKAHEAD_DAYS = 3;
const MIN_FREE_SLOTS = 3;      // only nudge when at least this many sessions are still open
const WINDOW_START_H = 10;     // IST
const WINDOW_END_H = 19;       // IST
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const IST_OFFSET_MIN = 330;

function toMinutes(t) {
  if (!t) return null;
  const lower = String(t).trim().toLowerCase();
  const isPm = lower.endsWith("pm");
  const isAm = lower.endsWith("am");
  const [hStr, mStr] = lower.replace("am", "").replace("pm", "").trim().split(":");
  let h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return null;
  const m = parseInt(mStr, 10) || 0;
  if (isPm && h !== 12) h += 12;
  if (isAm && h === 12) h = 0;
  return h * 60 + m;
}

// IST wall-clock parts for a UTC instant
const istParts = (d) => {
  const x = new Date(d.getTime() + IST_OFFSET_MIN * 60000);
  return { y: x.getUTCFullYear(), mo: x.getUTCMonth(), d: x.getUTCDate(), dow: x.getUTCDay(), mins: x.getUTCHours() * 60 + x.getUTCMinutes() };
};
// UTC instant for an IST date + minutes
const istInstant = (y, mo, d, mins) => new Date(Date.UTC(y, mo, d, 0, 0) + (mins - IST_OFFSET_MIN) * 60000);

export const unsubscribeToken = (therapistId) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET || "cyt").update(`avail-remind:${therapistId}`).digest("hex").slice(0, 32);

/** Free session slots in the next LOOKAHEAD_DAYS for one therapist. */
export async function freeSlotsFor(t, now = new Date()) {
  const avail = t.availabilities || [];
  const booked = await Booking.find({
    therapist: t._id,
    status: { $ne: "Cancelled" },
    booking_date: { $gte: now, $lt: new Date(now.getTime() + (LOOKAHEAD_DAYS + 1) * 864e5) },
  }).select("booking_date").lean();
  const taken = new Set(booked.map((b) => new Date(b.booking_date).getTime()));

  const out = [];
  const today = istParts(now);
  for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
    const day = istParts(istInstant(today.y, today.mo, today.d + i, 12 * 60));
    const av = avail.find((a) => a.day === DAYS[day.dow]);
    (av?.times || []).forEach(({ open, close }) => {
      const o = toMinutes(open), c = toMinutes(close);
      if (o == null || c == null) return;
      for (let m = o; m + 60 <= c; m += 60) {
        const at = istInstant(day.y, day.mo, day.d, m);
        if (at > now && !taken.has(at.getTime())) out.push({ at, dow: day.dow, mins: m });
      }
    });
  }
  return out;
}

export async function runAvailabilityReminders(now = new Date(), { onlyIds } = {}) {
  const cutoff = new Date(now.getTime() - REMIND_EVERY_DAYS * 864e5);
  const list = await Therapists.find({
    availability_reminders_off: { $ne: true },
    ...(onlyIds ? { _id: { $in: onlyIds } } : {}),
    $or: [{ availability_reminder_last_at: null }, { availability_reminder_last_at: { $lt: cutoff } }],
  }).populate("user", "name email is_verified").select("availabilities user availability_reminder_last_at");

  let sent = 0;
  for (const t of list) {
    if (!t.user?.email || t.user.is_verified !== 1) continue;
    const hasHours = (t.availabilities || []).some((a) => a.times?.length);
    const free = hasHours ? await freeSlotsFor(t, now) : [];
    if (hasHours && free.length < MIN_FREE_SLOTS) continue; // well booked — no nudge needed

    const html = therapistAvailabilityReminderMail({
      name: t.user.name,
      hasHours,
      freeCount: free.length,
      sample: free.slice(0, 4).map(({ dow, mins }) => `${DAYS[dow].slice(0, 3)} ${Math.floor(mins / 60) % 12 || 12}:${String(mins % 60).padStart(2, "0")} ${mins < 720 ? "AM" : "PM"}`),
      link: `${SITE}/my-schedule?tab=availability`,
      unsubscribe: `${API}/availability-reminders/unsubscribe?id=${t._id}&t=${unsubscribeToken(t._id)}`,
    });
    const subject = hasHours ? `You have ${free.length} open slots in the next ${LOOKAHEAD_DAYS} days` : "Set your session timings so clients can book you";
    const ok = await sendMail(t.user.email, subject, subject, html).catch(() => false);
    if (ok) {
      await Therapists.updateOne({ _id: t._id }, { availability_reminder_last_at: now });
      sent++;
    }
  }
  console.log(`[availability-reminders] checked ${list.length}, emailed ${sent}`);
  return sent;
}

// ── daily scheduler at a random IST time inside the window ──
function nextRunDelay(now = new Date()) {
  const p = istParts(now);
  const pick = WINDOW_START_H * 60 + Math.floor(Math.random() * (WINDOW_END_H - WINDOW_START_H) * 60);
  let at = istInstant(p.y, p.mo, p.d, pick);
  if (at <= now) at = istInstant(p.y, p.mo, p.d + 1, pick);
  return at.getTime() - now.getTime();
}

let timer = null;
export function startAvailabilityReminders() {
  if (process.env.AVAILABILITY_REMINDERS !== "on") {
    console.log("[availability-reminders] off (set AVAILABILITY_REMINDERS=on to enable)");
    return;
  }
  const schedule = () => {
    const ms = nextRunDelay();
    console.log(`[availability-reminders] next run in ${Math.round(ms / 60000)} min`);
    timer = setTimeout(async () => {
      try { await runAvailabilityReminders(); } catch (e) { console.error("[availability-reminders] failed:", e.message); }
      schedule();
    }, ms);
  };
  if (!timer) schedule();
}
