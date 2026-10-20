import Booking from "../models/Booking.js";
import Transaction from "../models/Transaction.js";
import Users from "../models/Users.js";
import Therapists from "../models/Therapists.js";
import NoidaPricing from "../models/NoidaPricing.js";
import NoidaAppointment from "../models/NoidaAppointment.js";
import NoidaClientCredit from "../models/NoidaClientCredit.js";
import NoidaPackage from "../models/NoidaPackage.js";
import { generate6DigitOTP } from "./generate.js";
import { PAYMENT_STATUS, SESSION_STATUS } from "./status.js";
import { sendMail } from "./mailer.js";
import { createMeetWithTimeout, deleteMeetEvent, moveMeetEvent } from "./googleMeet.js";
import { notifyTherapists, therapistBookingsChanged, therapistUserId } from "../services/therapistNotify.js";
import { notifyClient, changed as clientBookingsChanged } from "../services/clientNotify.js";

/* A CYT Noida appointment also shows up the normal way: as a Booking in the chosen psychologist's
   dashboard (Appointments / My Schedule), and in the client's own dashboard — the client gets a
   site account on their email, so they can log in with the usual email OTP.
   "No preference" goes to the admin's default Noida psychologist (Deepak Kumar unless set).
   The mirror is worth ₹0: the client paid CYT, so it never adds to the therapist's earnings or
   invoices. It is kept in step with the appointment (reschedule, cancel, attendance, delete). */

const SITE = "https://www.chooseyourtherapist.in";
const FORMAT = { "in-person": "In-Person", online: "Online", "home-visit": "Home Visit (In-Person)" };
const SESSION_TYPE = { "in-person": "in-person", online: "video", "home-visit": "in-person" };

function slotStartMinutes(label) {
  const [time, ampm] = String(label || "").split(" - ")[0].trim().split(" ");
  let [h, m] = String(time || "").split(":").map(Number);
  if (!Number.isFinite(h)) return 0;
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + (m || 0);
}
// "2026-10-20" + "11:00 AM - 11:45 AM" → that moment in India time
export const noidaSlotDate = (date, slot) => new Date(new Date(`${date}T00:00:00+05:30`).getTime() + slotStartMinutes(slot) * 60000);

const PAID_VIA = { razorpay: "Online (Razorpay)", qr: "UPI QR", cash: "Cash", credit: "Package session" };
// how many sessions a package bought with this appointment covers
async function packageSessions(a) {
  if (a.packageId) { const p = await NoidaPackage.findById(a.packageId).select("sessionsCount").lean(); if (p?.sessionsCount) return p.sessionsCount; }
  const c = await NoidaClientCredit.findOne({ phone: a.phone, ...(a.packageName ? { packageName: a.packageName } : {}), source: "online-purchase" }).sort({ _id: -1 }).select("totalSessions").lean();
  return c?.totalSessions || 1;
}
// the centre's standard fee for this kind of session (when a package's price can't be found)
async function standardFee(a) {
  const p = await NoidaPricing.findOne({}).lean();
  const fmt = a.format === "home-visit" ? "homevisit" : a.format === "online" ? "online" : "inperson";
  return Number(p?.[`${a.sessionMode === "couple" ? "couple" : "individual"}_${fmt}`]) || 0;
}
/* what one session is worth for the payout split (platform fee excluded):
   a single session → what was paid for it; a package → its price ÷ its sessions (the purchase booking and
   every later session drawn from it alike); a package with no price on record → the standard session fee */
export async function noidaSessionValue(a) {
  const fee = Number(a.platformFee) || 0;
  const paidBase = Math.max(0, (Number(a.amount) || 0) - fee);
  const isPackage = a.sessionMode === "package" || a.paymentStatus === "package-credit" || !!a.creditUsed || !!a.receptionCreditClientId;
  if (!isPackage) return paidBase || standardFee(a);
  let total = 0, count = 0;
  if (a.paymentStatus !== "package-credit" && paidBase > 0) { total = paidBase; count = await packageSessions(a); }
  else {
    const credit = a.creditUsed ? await NoidaClientCredit.findById(a.creditUsed).select("packageName totalSessions").lean() : null;
    const buy = await NoidaAppointment.findOne({
      phone: a.phone, sessionMode: "package", paymentStatus: "paid", amount: { $gt: 0 },
      ...(credit?.packageName || a.packageName ? { packageName: credit?.packageName || a.packageName } : {}),
    }).sort({ _id: -1 }).lean();
    if (buy) { total = Math.max(0, (Number(buy.amount) || 0) - (Number(buy.platformFee) || 0)); count = credit?.totalSessions || await packageSessions(buy); }
  }
  if (total > 0 && count > 0) return Math.round(total / count);
  return standardFee(a);
}

// what the client paid CYT (shown on the dashboards and the invoice — the Booking amount itself stays ₹0)
const charges = (a) => ({
  noida_amount: Number(a.amount) || 0, noida_fee: Number(a.platformFee) || 0, noida_discount: Number(a.discountAmount) || 0,
  noida_paid_via: a.paymentStatus === "package-credit" ? `Package session${a.packageName ? ` (${a.packageName})` : ""}` : PAID_VIA[a.paymentMethod] || "",
});

const serviceLabel = (a) => a.sessionMode === "couple" ? "Couple Therapy"
  : a.sessionMode === "package" ? `Therapy Package${a.packageName ? ` — ${a.packageName}` : ""}` : "Individual Therapy";

// "No preference" → the admin's pick, else Deepak Kumar from the Noida team (cached for 10 min)
let cachedDefault = { id: null, at: 0 };
export async function noPreferenceTherapist() {
  if (cachedDefault.id && Date.now() - cachedDefault.at < 10 * 60000) return cachedDefault.id;
  const p = await NoidaPricing.findOne({}).select("defaultTherapist therapists").lean();
  let id = p?.defaultTherapist || null;
  if (!id) {
    const deepakIn = async (filter) => {
      const rows = await Therapists.find(filter).select("_id user").populate("user", "name").lean();
      return rows.find((t) => /\bdeepak\b/i.test(t.user?.name || ""))?._id || null;
    };
    id = (p?.therapists?.length ? await deepakIn({ _id: { $in: p.therapists } }) : null) || null;
    if (!id) {
      const users = await Users.find({ role: 1, name: /\bdeepak kumar\b/i }).select("_id").lean();
      id = users.length ? await deepakIn({ user: { $in: users.map((u) => u._id) }, show_to_page: { $gt: 0 } }) : null;
    }
  }
  cachedDefault = { id, at: Date.now() };
  return id;
}
export const clearNoPreferenceCache = () => { cachedDefault = { id: null, at: 0 }; };

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// the client's site account: by the booking's email, else the email from an earlier Noida booking
// of the same phone, else an existing client account on that phone. Creates one when it has an email.
async function clientAccountFor(a) {
  let email = String(a.email || "").trim().toLowerCase();
  if (!email) {
    const prev = await NoidaAppointment.findOne({ phone: a.phone, email: { $nin: ["", null] } }).sort({ _id: -1 }).select("email").lean();
    email = String(prev?.email || "").trim().toLowerCase();
  }
  if (email && EMAIL_RX.test(email)) {
    const found = await Users.findOne({ email });
    if (found) return { user: found, created: false };
    if (!/^\d{10}$/.test(a.phone || "")) return {};
    const age = Number(a.age);
    try {
      const user = await Users.create({ name: a.name, email, phone: a.phone, ...(Number.isFinite(age) && age > 0 ? { age } : {}) });
      return { user, created: true };
    } catch (e) {
      if (e?.code === 11000) { const u = await Users.findOne({ email }); if (u) return { user: u, created: false }; }
      throw e;
    }
  }
  const byPhone = await Users.findOne({ phone: a.phone, role: 0 });
  return byPhone ? { user: byPhone, created: false } : {};
}

const populated = (id) => Booking.findById(id)
  .populate("client", "name email")
  .populate({ path: "therapist", select: "_id user", populate: { path: "user", select: "name email" } });

function statusFor(a, current) {
  if (a.status === "cancelled" || a.attendance === "no_show") return SESSION_STATUS.CANCELED;
  if (a.attendance === "completed") return SESSION_STATUS.COMPLETED;
  if (current === SESSION_STATUS.STARTED || current === SESSION_STATUS.COMPLETED) return current;
  return SESSION_STATUS.NEW;
}

async function tellTherapist(b, a, user) {
  const tUser = b.therapist?.user;
  if (!tUser) return;
  const when = `${a.date} · ${a.slot}`;
  notifyTherapists([tUser._id], {
    type: "booking", title: "New CYT Noida session",
    body: `${a.name} · ${b.service} · ${when}`, link: "/appointments", ref: `booking:${b._id}`,
  }).catch(() => {});
  if (!tUser.email) return;
  const rows = [
    ["Client", a.name], ["Phone", a.phone], ["Email", user?.email || a.email || "—"], ["When", when],
    ["Session", `${b.service} · ${FORMAT[a.format] || a.format}`], ...(a.address ? [["Address", a.address]] : []),
    ...(a.concern ? [["Concern", a.concern]] : []), ["Booked for", a.therapist ? "You (client's choice)" : "No preference — assigned to you"],
  ];
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:560px">
    <p>Hi ${esc(tUser.name || "")},</p>
    <p>A new session has been booked for you at <b>CYT Noida Centre</b> (Sector 51).</p>
    <table cellpadding="6" style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="color:#64748b;padding-right:14px">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join("")}</table>
    <p>It's in your dashboard under <a href="${SITE}/appointments" style="color:#166534;font-weight:bold">Appointments</a>. The client has paid CYT for this session.</p>
    <p style="color:#64748b;font-size:12.5px">Choose Your Therapist · CYT Noida Centre</p></div>`;
  sendMail(tUser.email, `NEW CYT NOIDA SESSION: ${a.name} · ${when}`, `New CYT Noida session: ${a.name}, ${a.phone}, ${when}. See ${SITE}/appointments`, html)
    .catch(() => {});
}

function welcomeClient(user, a, therapistName) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:560px">
    <p>Hi ${esc(user.name)},</p>
    <p>Your Choose Your Therapist account is ready. Your CYT Noida session on <b>${esc(a.date)}</b> at <b>${esc(a.slot)}</b>${therapistName ? ` with <b>${esc(therapistName)}</b>` : ""} is in your dashboard.</p>
    <p><a href="${SITE}/login" style="display:inline-block;background:#166534;color:#fff;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:8px">Log in to your dashboard</a></p>
    <p>Log in with this email (<b>${esc(user.email)}</b>) — we'll send you a one-time code. No password needed.</p>
    <p style="color:#64748b;font-size:12.5px">Choose Your Therapist · CYT Noida Centre, Sector 51</p></div>`;
  sendMail(user.email, "Your CYT account is ready — see your Noida session", `Log in at ${SITE}/login with ${user.email} to see your CYT Noida session on ${a.date} at ${a.slot}.`, html)
    .catch(() => {});
}

/* Creates or updates the Booking for one Noida appointment. notify = a brand-new booking
   (tell the therapist, and the client about their account). Never throws. */
export async function syncNoidaBooking(appointmentOrId, { notify = false, meet = true } = {}) {
  try {
    const a = appointmentOrId?._id && appointmentOrId?.date
      ? (appointmentOrId.toObject ? appointmentOrId.toObject() : appointmentOrId)
      : await NoidaAppointment.findById(appointmentOrId).lean();
    if (!a) return null;
    const existing = await Booking.findOne({ noida_appointment: a._id });
    const therapistId = a.therapist || await noPreferenceTherapist();
    const when = noidaSlotDate(a.date, a.slot);

    if (existing) {
      const moved = existing.booking_date?.getTime() !== when.getTime();
      const status = statusFor(a, existing.status);
      const before = existing.therapist;
      existing.set({
        therapist: therapistId || existing.therapist, booking_date: when, status,
        service: serviceLabel(a), format: FORMAT[a.format] || "In-Person", session_type: SESSION_TYPE[a.format] || "in-person",
        notes: a.concern || "", cname: a.name, noida_phone: a.phone || "", ...charges(a), noida_session_value: await noidaSessionValue(a),
      });
      if (moved) { existing.therapist_joined_at = null; existing.client_joined_at = null; }
      await existing.save();
      if (existing.calendar_event_id) {
        const full = await populated(existing._id);
        if (status === SESSION_STATUS.CANCELED) await deleteMeetEvent(full);
        else if (moved) await moveMeetEvent(full);
      }
      clientBookingsChanged(existing.client);
      // the psychologist's open dashboard updates at once (and the old one's, if it moved to someone else)
      for (const t of new Set([String(before), String(existing.therapist)])) therapistBookingsChanged(await therapistUserId(t));
      if (String(before) !== String(existing.therapist) && status !== SESSION_STATUS.CANCELED) {
        notifyTherapists([await therapistUserId(existing.therapist)], {
          type: "booking", title: "CYT Noida session assigned to you",
          body: `${a.name} · ${a.date} · ${a.slot}`, link: "/appointments", ref: `noida-assign:${existing._id}:${existing.therapist}`,
        }).catch(() => {});
      }
      return existing;
    }

    if (a.status === "cancelled" || !therapistId) return null;
    const { user, created } = await clientAccountFor(a);
    // no email anywhere → still on the psychologist's dashboard (name + phone from the appointment), just no client login

    let booking;
    try {
      booking = await Booking.create({
        therapist: therapistId, ...(user ? { client: user._id } : {}), noida_phone: a.phone || "", service: serviceLabel(a),
        format: FORMAT[a.format] || "In-Person", session_type: SESSION_TYPE[a.format] || "in-person",
        whom: "Self", cname: a.name, notes: a.concern || "", amount: 0, otp: generate6DigitOTP(),
        booking_date: when, status: statusFor(a), payment_status: "Paid",
        source: "noida", noida_appointment: a._id, noida_client_code: a.clientCode || "", ...charges(a), noida_session_value: await noidaSessionValue(a),
      });
    } catch (e) {
      if (e?.code === 11000) return Booking.findOne({ noida_appointment: a._id }); // made by a parallel call
      throw e;
    }
    if (user) {
      const tx = await Transaction.create({
        booking: booking._id, bookingModel: "Booking", user: user._id, amount: 0,
        payment_method: "CYT Noida", is_payment_success: true, status: PAYMENT_STATUS.SUCCESS,
        transaction_id: a.razorpayPaymentId || `NOIDA-${a.clientCode || ""}-${String(a._id).slice(-6)}`,
      });
      booking.transaction = tx._id;
      await booking.save();
    }

    const full = await populated(booking._id);
    const ev = meet ? await createMeetWithTimeout(full) : null;
    if (ev) await Booking.updateOne({ _id: booking._id }, { $set: { meet_link: ev.link, calendar_event_id: ev.eventId } });

    if (notify) {
      tellTherapist(full, a, user);
      if (user) notifyClient(user._id, {
        type: "booking", title: `CYT Noida session confirmed${full.therapist?.user?.name ? ` with ${full.therapist.user.name}` : ""}`,
        body: `${a.date} · ${a.slot}`, link: "/client/my-bookings", ref: `booking:${booking._id}`,
      }).catch(() => {});
      if (created) welcomeClient(user, a, full.therapist?.user?.name);
    }
    if (user) clientBookingsChanged(user._id);
    therapistBookingsChanged(full.therapist?.user?._id);
    return booking;
  } catch (e) {
    console.error("[noida→booking] sync failed:", e?.message);
    return null;
  }
}

// the appointment is gone: drop its booking too (a session already started/done is kept)
export async function removeNoidaBookings(appointmentIds) {
  try {
    const rows = await Booking.find({ noida_appointment: { $in: appointmentIds }, status: { $nin: [SESSION_STATUS.STARTED, SESSION_STATUS.COMPLETED] } })
      .select("_id transaction client therapist calendar_event_id");
    for (const b of rows) {
      if (b.calendar_event_id) await deleteMeetEvent(b);
      if (b.transaction) await Transaction.deleteOne({ _id: b.transaction });
      await Booking.deleteOne({ _id: b._id });
      clientBookingsChanged(b.client);
      therapistBookingsChanged(await therapistUserId(b.therapist)); // gone from their open dashboard at once
    }
  } catch (e) {
    console.error("[noida→booking] remove failed:", e?.message);
  }
}

/* Keeps every Noida booking in step even when a change skipped the hooks above (e.g. made through a
   server still on older code): runs at start-up and every 10 minutes.
   1) a booking whose appointment was deleted goes (a session already started/done is kept)
   2) upcoming confirmed appointments without a booking (or without its charges) get one
   3) upcoming bookings follow their appointment (cancelled / moved) */
export async function reconcileNoidaBookings() {
  const out = { removed: 0, created: 0, updated: 0 };
  const open = await Booking.find({ source: "noida", status: { $nin: [SESSION_STATUS.STARTED, SESSION_STATUS.COMPLETED] } })
    .select("noida_appointment status booking_date").lean();
  const appts = await NoidaAppointment.find({ _id: { $in: open.map((b) => b.noida_appointment) } }).select("_id status date slot attendance").lean();
  const byId = new Map(appts.map((a) => [String(a._id), a]));
  const orphans = open.filter((b) => !byId.has(String(b.noida_appointment))).map((b) => b.noida_appointment);
  if (orphans.length) { await removeNoidaBookings(orphans); out.removed = orphans.length; }
  for (const b of open) {
    const a = byId.get(String(b.noida_appointment));
    if (!a) continue;
    const wantCancelled = a.status === "cancelled" || a.attendance === "no_show";
    const moved = new Date(b.booking_date).getTime() !== noidaSlotDate(a.date, a.slot).getTime();
    if (wantCancelled !== (b.status === SESSION_STATUS.CANCELED) || moved) { await syncNoidaBooking(a._id); out.updated++; }
  }

  // any Noida booking (past ones too) made before its session value was recorded gets it once — so its payout can start
  const stale = await Booking.find({ source: "noida", noida_session_value: { $exists: false } }).select("noida_appointment").limit(500).lean();
  for (const b of stale) if (byId.has(String(b.noida_appointment)) || await NoidaAppointment.exists({ _id: b.noida_appointment })) { await syncNoidaBooking(b.noida_appointment); out.updated++; }

  const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  const rows = await NoidaAppointment.find({ status: "confirmed", date: { $gte: today } }).select("_id").lean();
  // (a booking made before the charges were recorded is refreshed once too)
  const done = new Set((await Booking.find({ noida_appointment: { $in: rows.map((r) => r._id) }, noida_amount: { $exists: true }, noida_session_value: { $exists: true } }).select("noida_appointment").lean()).map((b) => String(b.noida_appointment)));
  for (const r of rows) if (!done.has(String(r._id)) && await syncNoidaBooking(r._id)) out.created++;
  return out;
}
export const backfillNoidaBookings = async () => { const r = await reconcileNoidaBookings(); return r.created; };

/* Earlier CYT Noida sessions (dated before the payouts system went live) onto the psychologists' dashboards as a
   record: the chosen psychologist, else the default one (Deepak). A session that took place shows Completed, a
   no-show Cancelled; cancelled bookings are left out. noida_legacy = no earning and no payout for them. No email,
   notification or Meet event. Idempotent (skips appointments that already have their booking). */
export const LEGACY_BEFORE = "2026-10-21";
export async function backfillPastNoidaBookings() {
  const rows = await NoidaAppointment.find({ status: "confirmed", date: { $lt: LEGACY_BEFORE } }).select("_id date slot attendance").lean();
  if (!rows.length) return 0;
  const have = new Set((await Booking.find({ noida_appointment: { $in: rows.map((r) => r._id) } }).select("noida_appointment").lean()).map((b) => String(b.noida_appointment)));
  let n = 0;
  for (const r of rows) {
    if (have.has(String(r._id))) continue;
    const b = await syncNoidaBooking(r._id, { meet: false });
    if (!b) continue;
    const start = noidaSlotDate(r.date, r.slot);
    const held = r.attendance !== "no_show";
    await Booking.updateOne({ _id: b._id }, { $set: {
      noida_legacy: true, status: held ? SESSION_STATUS.COMPLETED : SESSION_STATUS.CANCELED,
      ...(held ? { session_started_at: start, session_completed_at: new Date(start.getTime() + 60 * 60000) } : {}),
    } });
    n++;
  }
  return n;
}
