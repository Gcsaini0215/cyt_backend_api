import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Razorpay from "razorpay";
import crypto from "crypto";
import NoidaAppointment from "../models/NoidaAppointment.js";
import NoidaLastMinuteRequest from "../models/NoidaLastMinuteRequest.js";
import NoidaPendingBooking from "../models/NoidaPendingBooking.js";
import NoidaFollowupSlot from "../models/NoidaFollowupSlot.js";
import NoidaPackage from "../models/NoidaPackage.js";
import { resolveCoupon, normalizeCouponCode } from "../helper/noidaCoupon.js";
import { ensureClientCode, ensureBackfilled } from "../helper/noidaClient.js";
import { resolveOfferedTherapist } from "../helper/noidaTherapist.js";
import NoidaClientCredit from "../models/NoidaClientCredit.js";
import Lead from "../models/Lead.js";
import Admin from "../models/Admin.js";
import UPIInfo from "../models/UPIInfo.js";
import { sendMail } from "../helper/mailer.js";
import { generateQrCode } from "../helper/generate.js";
import { leadNotificationEmail, noidaAppointmentConfirmationEmail } from "../services/mailTemplates.js";
import { getOrCreatePricing } from "./NoidaPricingController.js";
import { getActiveCredit } from "./NoidaClientCreditController.js";

const getRazorpayInstance = () => new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const VALID_SESSION_MODES = ["individual", "couple", "package"];
const VALID_FORMATS = ["in-person", "online", "home-visit"];

function priceFieldFor(sessionMode, format) {
  const fmt = format === "home-visit" ? "homevisit" : format === "online" ? "online" : "inperson";
  const mode = sessionMode === "couple" ? "couple" : "individual";
  return `${mode}_${fmt}`;
}

// Single source of truth for what a booking costs — never trust a client-supplied
// amount. Returns { baseAmount, platformFee, totalAmount, packageName }.
export async function computeBookingAmount({ sessionMode, format, packageId, customSessions, couponCode, phone, lockedDiscount }) {
  const pricing = await getOrCreatePricing();
  let baseAmount;
  let packageName = "";
  let sessionsCount = 0;

  if (sessionMode === "package") {
    if (packageId && mongoose.Types.ObjectId.isValid(packageId)) {
      const pkg = await NoidaPackage.findOne({ _id: packageId, active: true });
      if (!pkg) throw new Error("That package is no longer available.");
      baseAmount = pkg.price;
      packageName = pkg.name;
      sessionsCount = pkg.sessionsCount;
    } else if (customSessions) {
      // A custom package: the client chose the number of sessions.
      const c = pricing.customPackage || {};
      const n = Number(customSessions);
      if (!c.enabled || !(c.perSessionPrice > 0)) throw new Error("Custom packages aren't available right now.");
      if (!Number.isInteger(n) || n < c.minSessions || n > c.maxSessions) {
        throw new Error(`Please choose between ${c.minSessions} and ${c.maxSessions} sessions.`);
      }
      baseAmount = n * c.perSessionPrice;
      packageName = `Custom package · ${n} sessions`;
      sessionsCount = n;
    } else {
      throw new Error("Please select a valid package.");
    }
  } else {
    baseAmount = pricing[priceFieldFor(sessionMode, format)];
  }

  // A coupon takes money off the session/package price — never the platform fee.
  // `lockedDiscount` is the figure fixed when a paid order was created: the
  // client already paid that price, so it is honoured even if the coupon has
  // since run out or expired.
  let discountAmount = 0;
  let appliedCode = "";
  if (couponCode) {
    if (lockedDiscount > 0) {
      discountAmount = Math.min(Math.floor(lockedDiscount), baseAmount);
      appliedCode = normalizeCouponCode(couponCode);
    } else {
      const r = await resolveCoupon({ code: couponCode, phone, baseAmount, isPackage: sessionMode === "package" });
      discountAmount = r.discountAmount;
      appliedCode = r.coupon.code;
    }
  }

  const platformFee = pricing.platformFee;
  const totalAmount = baseAmount - discountAmount + platformFee;
  if (totalAmount < 1) throw new Error("That coupon would make this booking free, which isn't supported. Please ask us for a smaller discount.");
  return { baseAmount, platformFee, totalAmount, packageName, sessionsCount, discountAmount, couponCode: appliedCode };
}

// A well-formed ObjectId or null — the clients send "" / undefined for custom packages.
const asPackageId = (v) => (v && mongoose.Types.ObjectId.isValid(v) ? v : null);

// Both "new" and "followup" bookings now draw exclusively from admin-opened
// slots (see NoidaFollowupSlot) — there's no more auto-generated fixed grid.
const MAX_DAYS_AHEAD = 60;

// A same-day slot stays instantly bookable until it's this close to
// starting — inside that window it's still shown (right up to start time)
// but the public page switches to the request-and-wait flow instead of
// letting anyone book it outright. See createLastMinuteRequest below.
const LAST_MINUTE_WINDOW_MINUTES = 15;
// Staff's deadline to accept a last-minute request, measured from when the
// client sent it — not from the slot's own start time.
const LAST_MINUTE_ACCEPT_SLA_MINUTES = 10;

const pad2 = (n) => String(n).padStart(2, "0");

// Current wall-clock time in Asia/Kolkata, independent of the server's own timezone.
function istNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
}

function istDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isValidDateStr(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function normalizeType(t) {
  return t === "new" ? "new" : "followup";
}

function slotStartMinutes(label) {
  const startLabel = label.split(" - ")[0];
  const [time, ampm] = startLabel.split(" ");
  let [h, m] = time.split(":").map(Number);
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

// For today's date: flags slots whose start time has already passed (kept in
// the list so the table stays complete until the day actually ends — the
// client shows them as inert), and the ones inside the last-minute window
// (still visible, right up to start — just no longer instantly bookable).
function annotateSameDaySlots(slots, date, today, now) {
  if (date !== today) return slots.map((label) => ({ slot: label, lastMinute: false, past: false }));
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return slots.map((label) => {
    const minutesToStart = slotStartMinutes(label) - nowMinutes;
    return { slot: label, past: minutesToStart <= 0, lastMinute: minutesToStart > 0 && minutesToStart <= LAST_MINUTE_WINDOW_MINUTES };
  });
}

export const getAvailableSlots = expressAsyncHandler(async (req, res, next) => {
  const { date } = req.query;
  const type = normalizeType(req.query.type);
  if (!isValidDateStr(date)) {
    res.status(400);
    return next(new Error("A valid date (YYYY-MM-DD) is required."));
  }

  const now = istNow();
  const today = istDateStr(now);
  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + MAX_DAYS_AHEAD);

  if (date < today || date > istDateStr(maxDate)) {
    return res.status(200).json({ status: true, data: [] });
  }

  const saved = await NoidaFollowupSlot.find({ date, type }).select("slot").lean();
  const annotated = annotateSameDaySlots(saved.map((s) => s.slot), date, today, now);

  // Physical slot occupancy is global — a "new" and a "followup" booking can't share a time.
  // Booked slots stay in the list (marked booked) rather than disappearing, so the client
  // can see the full picture of what's taken vs. open.
  const booked = await NoidaAppointment.find({ date, status: "confirmed" }).select("slot").lean();
  const bookedSet = new Set(booked.map((b) => b.slot));
  const data = annotated.map(({ slot, lastMinute, past }) => ({ slot, booked: bookedSet.has(slot), lastMinute, past }));

  return res.status(200).json({ status: true, data });
});

// Public: full date x time availability in one call — same underlying data
// as getAvailableSlots (one date at a time) and getFollowupDates (which
// dates have anything open), just combined so the public booking page can
// render its slots-first table without firing a request per date.
export const getPublicSlotsMatrix = expressAsyncHandler(async (req, res, next) => {
  await ensureBackfilled();
  const type = normalizeType(req.query.type);
  const now = istNow();
  const today = istDateStr(now);
  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + MAX_DAYS_AHEAD);

  const [allSlots, booked] = await Promise.all([
    NoidaFollowupSlot.find({ date: { $gte: today, $lte: istDateStr(maxDate) }, type }).select("date slot").lean(),
    NoidaAppointment.find({ date: { $gte: today }, status: "confirmed" }).select("date slot").lean(),
  ]);

  // Public: only whether a slot is taken — no name, phone or client number.
  const bookedSet = new Set(booked.map((b) => `${b.date}|${b.slot}`));
  const byDate = new Map();
  for (const s of allSlots) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s.slot);
  }

  const data = [];
  for (const [date, slots] of byDate) {
    const annotated = annotateSameDaySlots(slots, date, today, now);
    for (const { slot, lastMinute, past } of annotated) {
      const isBooked = bookedSet.has(`${date}|${slot}`);
      data.push({ date, slot, booked: isBooked, lastMinute, past });
    }
  }
  data.sort((a, b) => a.date === b.date ? 0 : a.date < b.date ? -1 : 1);

  return res.status(200).json({ status: true, data });
});

// Public: which dates currently have at least one open (unbooked) slot for
// the given type — lets the booking page show only dates worth offering,
// instead of blindly rendering N days and querying each one.
export const getFollowupDates = expressAsyncHandler(async (req, res, next) => {
  try {
    const type = normalizeType(req.query.type);
    const now = istNow();
    const today = istDateStr(now);

    const [allSlots, booked] = await Promise.all([
      NoidaFollowupSlot.find({ date: { $gte: today }, type }).select("date slot").lean(),
      NoidaAppointment.find({ date: { $gte: today }, status: "confirmed" }).select("date slot").lean(),
    ]);

    const bookedSet = new Set(booked.map((b) => `${b.date}|${b.slot}`));
    const openDates = new Set();
    for (const s of allSlots) {
      if (!bookedSet.has(`${s.date}|${s.slot}`)) openDates.add(s.date);
    }

    return res.status(200).json({ status: true, data: Array.from(openDates).sort() });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Public: the nearest upcoming confirmed booking for a phone number — powers
// the self-service Reschedule tab. Only name/date/slot/type are exposed,
// same privacy bar as lookupClientByPhone.
export const getUpcomingAppointment = expressAsyncHandler(async (req, res, next) => {
  const phone = (req.query.phone || "").trim();
  if (!/^\d{10}$/.test(phone)) {
    return res.status(400).json({ status: false, message: "A valid 10-digit phone number is required." });
  }

  try {
    const today = istDateStr(istNow());
    const appointment = await NoidaAppointment.findOne({ phone, status: "confirmed", date: { $gte: today } })
      .sort({ date: 1, slot: 1 })
      .select("name date slot type")
      .lean();

    if (!appointment) {
      return res.status(200).json({ status: true, data: { found: false } });
    }
    return res.status(200).json({
      status: true,
      data: { found: true, name: appointment.name, date: appointment.date, slot: appointment.slot, type: appointment.type },
    });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Public: moves a client's nearest upcoming booking to a new date/slot.
// Re-derives the booking from phone server-side (never trusts a client-sent
// appointment id) and re-validates the target slot exactly like a fresh
// booking would — open, and not already taken by someone else.
export const rescheduleNoidaAppointment = expressAsyncHandler(async (req, res, next) => {
  const phone = (req.body.phone || "").trim();
  const newDate = req.body.newDate;
  const newSlot = (req.body.newSlot || "").trim();

  if (!/^\d{10}$/.test(phone)) {
    res.status(400);
    return next(new Error("A valid 10-digit phone number is required."));
  }
  if (!isValidDateStr(newDate) || !newSlot) {
    res.status(400);
    return next(new Error("Please select a valid date and time slot."));
  }

  try {
    const today = istDateStr(istNow());
    const appointment = await NoidaAppointment.findOne({ phone, status: "confirmed", date: { $gte: today } })
      .sort({ date: 1, slot: 1 });

    if (!appointment) {
      res.status(404);
      return next(new Error("No upcoming appointment found for this number."));
    }

    const isOpen = await NoidaFollowupSlot.findOne({ date: newDate, slot: newSlot, type: appointment.type });
    if (!isOpen) {
      res.status(400);
      return next(new Error("That slot isn't open for booking on the selected date."));
    }
    const clash = await NoidaAppointment.findOne({ date: newDate, slot: newSlot, status: "confirmed" });
    if (clash) {
      res.status(409);
      return next(new Error("Sorry, that slot was just booked by someone else. Please pick another."));
    }

    const previousDate = appointment.date;
    const previousSlot = appointment.slot;

    appointment.previousDate = previousDate;
    appointment.previousSlot = previousSlot;
    appointment.rescheduleCount = (appointment.rescheduleCount || 0) + 1;
    appointment.date = newDate;
    appointment.slot = newSlot;
    await appointment.save();

    // Notify whoever owns this booking (assignee if set, else the fixed inbox) —
    // same pattern as a brand-new booking, just framed as a reschedule.
    const notifyTarget = appointment.assignedTo
      ? await Admin.findById(appointment.assignedTo).select("name email")
      : null;
    const notifyEmail = notifyTarget?.email || "chooseyourtherapist@gmail.com";
    try {
      await sendMail(
        notifyEmail,
        `🔄 Rescheduled: ${appointment.name} — now ${newDate} ${newSlot}`,
        `${appointment.name} (${phone}) moved their appointment from ${previousDate} ${previousSlot} to ${newDate} ${newSlot}.`,
        leadNotificationEmail({
          name: appointment.name, phone, email: appointment.email,
          concern: `Rescheduled from ${previousDate} ${previousSlot} to ${newDate} ${newSlot}${appointment.concern ? ` — "${appointment.concern}"` : ""}`,
          source: notifyTarget ? "Assigned to you — Noida Reschedule" : "CYT Noida Reschedule",
        })
      );
    } catch (mailErr) {
      console.error("Reschedule notification email failed (non-fatal):", mailErr.message);
    }

    if (appointment.email?.trim()) {
      try {
        await sendMail(
          appointment.email.trim(),
          "CYT Noida Appointment Has Been Rescheduled",
          `Your appointment is now confirmed for ${newDate} at ${newSlot}.`,
          noidaAppointmentConfirmationEmail({ name: appointment.name, date: newDate, slot: newSlot, concern: appointment.concern })
        );
      } catch (mailErr) {
        console.error("Reschedule client confirmation failed (non-fatal):", mailErr.message);
      }
    }

    return res.status(200).json({ status: true, message: "Appointment rescheduled.", data: appointment });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Public: "have we seen this phone number before?" — used by the follow-up
// tab to greet a returning client by name instead of asking them to
// re-type everything. Checks past Noida bookings first, then the general
// Lead inbox. Name only — nothing else about them is exposed pre-booking.
export const lookupClientByPhone = expressAsyncHandler(async (req, res, next) => {
  const phone = (req.query.phone || "").trim();
  if (!/^\d{10}$/.test(phone)) {
    return res.status(400).json({ status: false, message: "A valid 10-digit phone number is required." });
  }

  try {
    const credit = await getActiveCredit(phone);
    const creditInfo = credit
      ? { available: true, sessionsRemaining: credit.totalSessions - credit.sessionsUsed, packageName: credit.packageName }
      : { available: false, sessionsRemaining: 0, packageName: "" };

    const pastAppointment = await NoidaAppointment.findOne({ phone }).sort({ createdAt: -1 }).select("name").lean();
    if (pastAppointment?.name) {
      return res.status(200).json({ status: true, data: { found: true, name: pastAppointment.name, credit: creditInfo } });
    }

    const pastLead = await Lead.findOne({ phone }).sort({ created_at: -1 }).select("name").lean();
    if (pastLead?.name) {
      return res.status(200).json({ status: true, data: { found: true, name: pastLead.name, credit: creditInfo } });
    }

    // Not found in Lead/past bookings, but might still have credit if admin
    // manually registered them (e.g. an existing/offline client).
    if (credit) {
      return res.status(200).json({ status: true, data: { found: true, name: credit.name, credit: creditInfo } });
    }

    return res.status(200).json({ status: true, data: { found: false, name: null, credit: creditInfo } });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Step 1 of the pay-first flow: figures out the authoritative price for the
// chosen session mode/format/package and opens a Razorpay order for it.
// The frontend never gets to say what the amount is.
export const createNoidaOrder = expressAsyncHandler(async (req, res, next) => {
  const { sessionMode, format, packageId, customSessions, couponCode, therapistId, address, phone } = req.body;
  const type = normalizeType(req.body.type);

  if (!VALID_SESSION_MODES.includes(sessionMode)) {
    res.status(400);
    return next(new Error("Invalid session mode."));
  }
  if (!VALID_FORMATS.includes(format)) {
    res.status(400);
    return next(new Error("Invalid session format."));
  }
  if (format === "home-visit" && !address?.trim()) {
    res.status(400);
    return next(new Error("Please provide an address for the home visit."));
  }

  // Follow-up client with sessions left on a package (bought online or set
  // up by admin for an existing client) — no payment needed, skip straight
  // past Razorpay.
  if (type === "followup" && /^\d{10}$/.test(phone || "")) {
    const credit = await getActiveCredit(phone.trim());
    if (credit) {
      return res.status(200).json({
        status: true,
        data: { freeSession: true, sessionsRemaining: credit.totalSessions - credit.sessionsUsed, packageName: credit.packageName },
      });
    }
  }

  // Newer clients send the full booking with the order. Refuse up front if
  // that slot can't be booked, so nobody is charged for a slot that's gone —
  // and remember what they were booking so the webhook can finish (or refund) it.
  const { name, age, email, concern, date, slot } = req.body;
  const bookingSent = !!(name?.trim() && /^\d{10}$/.test(phone || "") && isValidDateStr(date) && slot?.trim());
  if (bookingSent) {
    const blocked = await slotUnavailableReason({ date, slot, type, phone: phone.trim() });
    if (blocked) {
      res.status(blocked.status);
      return next(new Error(blocked.message));
    }
  }

  try {
    if (therapistId && !(await resolveOfferedTherapist(therapistId))) {
      res.status(400);
      return next(new Error("That therapist isn't available for booking right now. Please pick another or choose no preference."));
    }
    const { baseAmount, platformFee, totalAmount, packageName, discountAmount, couponCode: appliedCoupon } = await computeBookingAmount({ sessionMode, format, packageId, customSessions, couponCode, phone });

    const razorpay = getRazorpayInstance();
    const order = await razorpay.orders.create({
      amount: Math.round(totalAmount * 100), // paise
      currency: "INR",
      receipt: `noida_${Date.now()}`,
    });

    if (bookingSent) {
      try {
        await NoidaPendingBooking.create({
          orderId: order.id,
          amount: totalAmount,
          payload: {
            name: name.trim(), age: age?.toString().trim() || "", phone: phone.trim(),
            email: email?.trim() || "", concern: concern?.trim() || "",
            date, slot: slot.trim(), type, sessionMode, format,
            address: format === "home-visit" ? address.trim() : "",
            packageId: sessionMode === "package" ? asPackageId(packageId) : null,
            customSessions: sessionMode === "package" && !asPackageId(packageId) ? Number(customSessions) || 0 : 0,
            couponCode: appliedCoupon, discountAmount,
            therapistId: therapistId && mongoose.Types.ObjectId.isValid(therapistId) ? therapistId : null,
          },
        });
      } catch (pendingErr) {
        // Non-fatal: without it the browser callback still books as before.
        console.error("Could not save pending Noida booking:", pendingErr.message);
      }
    }

    return res.status(200).json({
      status: true,
      data: {
        orderId: order.id,
        keyId: process.env.RAZORPAY_KEY_ID,
        baseAmount,
        platformFee,
        discountAmount,
        amount: totalAmount,
        packageName,
      },
    });
  } catch (err) {
    return next(new Error(err.message || "Could not start payment. Please try again."));
  }
});

// Shared by both the public pay-first flow and the admin reception-booking
// flow — caller has already verified payment (Razorpay signature) or
// established there's an active credit before calling this. `paymentMethod`
// is one of "razorpay" | "cash" | "qr" (ignored when credit is set).
async function finalizeNoidaBooking({
  name, phone, email, concern, date, slot, type, age,
  sessionMode, format, address, packageId, customSessions, couponCode, discountAmount: lockedDiscount, therapistId,
  credit, paymentMethod, razorpayOrderId, razorpayPaymentId, bookedByAdmin,
}) {
  const alreadyBooked = await NoidaAppointment.findOne({ date, slot, status: "confirmed" });
  if (alreadyBooked) {
    const err = new Error("Sorry, that slot was just booked by someone else. Please pick another.");
    err.status = 409;
    throw err;
  }

  let baseAmount = 0, platformFee = 0, totalAmount = 0, packageName = "", creditUsedId = null, sessionsCount = 0;
  let discountAmount = 0, appliedCoupon = "";

  if (credit) {
    // Atomically claim one session — the sessionsUsed condition means only
    // one concurrent request can win if two both raced in on the same credit.
    const claimed = await NoidaClientCredit.findOneAndUpdate(
      { _id: credit._id, sessionsUsed: credit.sessionsUsed },
      { $inc: { sessionsUsed: 1 } },
      { new: true }
    );
    if (!claimed) {
      const err = new Error("That session credit was just claimed elsewhere. Please refresh and try again.");
      err.status = 409;
      throw err;
    }
    packageName = claimed.packageName;
    creditUsedId = claimed._id;
  } else {
    // Recomputed fresh (never trusts a client-sent amount) — matches what the
    // order was created for, since both calls read the same live pricing.
    const computed = await computeBookingAmount({ sessionMode, format, packageId, customSessions, couponCode, phone, lockedDiscount });
    discountAmount = computed.discountAmount;
    appliedCoupon = computed.couponCode;
    sessionsCount = computed.sessionsCount;
    baseAmount = computed.baseAmount;
    platformFee = computed.platformFee;
    totalAmount = computed.totalAmount;
    packageName = computed.packageName;
  }

  const clientCode = await ensureClientCode({ phone: phone.trim(), name: name.trim() });
  // The client's preferred therapist — looked up leniently: a booking that is already
  // paid for is never refused just because a therapist went off-air meanwhile.
  const therapist = therapistId ? await resolveOfferedTherapist(therapistId) : null;

  const appointment = await NoidaAppointment.create({
    name: name.trim(),
    age: age?.toString().trim() || "",
    phone: phone.trim(),
    clientCode,
    therapist: therapist ? therapist._id : null,
    therapistName: therapist ? therapist.name : "",
    email: email?.trim() || "",
    concern: concern?.trim() || "",
    date,
    slot,
    type,
    sessionMode,
    format,
    address: format === "home-visit" ? address.trim() : "",
    packageId: sessionMode === "package" ? asPackageId(packageId) : null,
    packageName,
    couponCode: appliedCoupon,
    discountAmount,
    amount: totalAmount,
    platformFee,
    paymentStatus: credit ? "package-credit" : "paid",
    paymentMethod: credit ? "credit" : paymentMethod,
    razorpayOrderId: razorpayOrderId || "",
    razorpayPaymentId: razorpayPaymentId || "",
    creditUsed: creditUsedId,
    bookedByAdmin: bookedByAdmin || null,
  });

  // A brand-new (paid, not credit-funded) package purchase — open a credit
  // record so this client's future follow-ups skip payment automatically.
  if (!credit && sessionMode === "package" && sessionsCount > 0) {
    await NoidaClientCredit.create({
      phone: phone.trim(),
      name: name.trim(),
      packageName,
      totalSessions: sessionsCount,
      sessionsUsed: 1, // this booking is the first session of the bundle
      source: "online-purchase",
    });
  }

  const formatLabel = format === "home-visit" ? "Home Visit" : format === "online" ? "Online" : "In-person";
  const modeLabel = sessionMode === "package" ? `Package (${packageName})` : sessionMode === "couple" ? "Couple" : "Individual";
  const paidLabel = credit ? `used 1 package session (${packageName})` : `₹${totalAmount} paid (${paymentMethod})`;

  try {
    await sendMail(
      "chooseyourtherapist@gmail.com",
      `CYT Noida Booking (${type === "followup" ? "Follow-up" : "New"}): ${name} — ${date} ${slot}`,
      `New CYT Noida appointment: ${name}, ${phone}, ${date} ${slot}`,
      leadNotificationEmail({
        name, phone, email, age,
        concern: `${modeLabel} · ${formatLabel}${address ? ` · ${address}` : ""} — ${date} at ${slot} — ${paidLabel}${concern ? ` — "${concern}"` : ""}`,
        source: bookedByAdmin ? "CYT Noida Booking (Reception)" : "CYT Noida Booking",
        amount: totalAmount,
      })
    );
  } catch (mailErr) {
    console.error("Noida appointment admin alert failed (non-fatal):", mailErr.message);
  }

  // Auto-assign to whoever the admin has set as the default owner for new
  // Noida bookings (Pricing tab), and email them the same details — so
  // someone owns follow-up without needing to notice and self-assign.
  const pricingForAssignee = await getOrCreatePricing();
  if (pricingForAssignee.defaultAssignee) {
    const assignee = await Admin.findById(pricingForAssignee.defaultAssignee).select("name email");
    if (assignee) {
      appointment.assignedTo = assignee._id;
      await appointment.save();
      if (assignee.email) {
        try {
          await sendMail(
            assignee.email,
            `📅 Noida Booking Assigned to You: ${name} — ${date} ${slot}`,
            `A CYT Noida appointment has been assigned to you: ${name}, ${phone}, ${date} ${slot}`,
            leadNotificationEmail({
              name, phone, email, age,
              concern: `${modeLabel} · ${formatLabel}${address ? ` · ${address}` : ""} — ${date} at ${slot} — ${paidLabel}${concern ? ` — "${concern}"` : ""}`,
              source: "Assigned to you — CYT Noida Booking",
              amount: totalAmount,
            })
          );
        } catch (mailErr) {
          console.error("Noida appointment assignee email failed (non-fatal):", mailErr.message);
        }
      }
    }
  }

  if (email?.trim()) {
    try {
      await sendMail(
        email.trim(),
        "CYT Noida Appointment is Confirmed",
        `Your appointment is confirmed for ${date} at ${slot}.`,
        noidaAppointmentConfirmationEmail({ name, date, slot, concern })
      );
    } catch (mailErr) {
      console.error("Noida appointment client confirmation failed (non-fatal):", mailErr.message);
    }
  }

  return appointment;
}

// A slot this close to start (or already started today) needs staff to have
// accepted a request first — regardless of payment method, since it's about
// whether the center can take a walk-in this soon, not about payment risk.
function isLastMinuteSlot(date, slot) {
  const now = istNow();
  return date === istDateStr(now) && slotStartMinutes(slot) - (now.getHours() * 60 + now.getMinutes()) <= LAST_MINUTE_WINDOW_MINUTES;
}

// Why a public client can't book this slot right now, or null if they can.
// Used both before taking payment (so nobody is charged for a taken slot) and
// again after payment, since a slot can vanish while checkout is open.
async function slotUnavailableReason({ date, slot, type, phone }) {
  const isOpen = await NoidaFollowupSlot.findOne({ date, slot, type });
  if (!isOpen) return { status: 400, message: "That slot isn't open for booking on the selected date." };
  const booked = await NoidaAppointment.findOne({ date, slot, status: "confirmed" });
  if (booked) return { status: 409, message: "Sorry, that slot was just booked by someone else. Please pick another." };
  if (isLastMinuteSlot(date, slot)) {
    const approved = await NoidaLastMinuteRequest.findOne({ phone, date, slot, status: "accepted" });
    if (!approved) return { status: 400, message: "This slot needs staff approval first — please send a request and wait for it to be accepted." };
  }
  return null;
}

// Turns a verified Razorpay payment into a booking. Idempotent on the payment
// id, so the browser callback and the webhook can both call it safely.
async function completePaidBooking({ payload, orderId, paymentId }) {
  const existing = await NoidaAppointment.findOne({ razorpayPaymentId: paymentId });
  if (existing) return existing;
  const blocked = await slotUnavailableReason({ date: payload.date, slot: payload.slot, type: payload.type, phone: payload.phone });
  if (blocked) {
    const err = new Error(blocked.message);
    err.status = blocked.status;
    throw err;
  }
  return finalizeNoidaBooking({
    ...payload, credit: null,
    paymentMethod: "razorpay", razorpayOrderId: orderId, razorpayPaymentId: paymentId,
  });
}

async function refundPayment(paymentId, reason) {
  try {
    const refund = await getRazorpayInstance().payments.refund(paymentId, {
      speed: "optimum",
      notes: { reason: String(reason || "Booking could not be completed").slice(0, 200) },
    });
    return { ok: true, refundId: refund.id };
  } catch (err) {
    console.error("Noida auto-refund failed:", JSON.stringify(err?.error || err?.message || err));
    return { ok: false, error: err?.error?.description || err?.message || "refund failed" };
  }
}

function paidBookingFailureMessage({ refunded, reason, amount, paymentId }) {
  const amt = amount ? ` of ₹${amount}` : "";
  const why = reason || "We couldn't complete your booking.";
  return refunded
    ? `${why} Your payment${amt} has been refunded automatically — it should reach your account in 5–7 working days.`
    : `${why} We couldn't refund your payment${amt} automatically, but our team has been alerted and will refund it shortly. Payment ID: ${paymentId}.`;
}

// A client has paid but the booking can't happen: refund them, and tell staff
// either way (loudly when the automatic refund itself failed).
async function handlePaidBookingFailure({ pending, payload, orderId, paymentId, amount, err }) {
  const reason = err?.message || "Booking could not be completed.";
  const refund = await refundPayment(paymentId, reason);
  if (pending) {
    await NoidaPendingBooking.updateOne(
      { _id: pending._id },
      { status: refund.ok ? "refunded" : "refund_failed", failureReason: reason, refundId: refund.refundId || "", paymentId }
    );
  }
  try {
    await sendMail(
      "chooseyourtherapist@gmail.com",
      `${refund.ok ? "Auto-refunded" : "REFUND NEEDED"}: Noida booking payment — ${payload?.name || "unknown"}`,
      `${refund.ok ? "A payment was refunded automatically" : "A payment could NOT be refunded automatically and needs a manual refund"}. ${payload?.name} (${payload?.phone}) wanted ${payload?.date} ${payload?.slot}. Reason: ${reason}. Payment ${paymentId}, order ${orderId}.${refund.ok ? "" : ` Refund error: ${refund.error}`}`,
      `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">
        <h3 style="margin:0 0 8px;color:${refund.ok ? "#166534" : "#b91c1c"}">${refund.ok ? "Payment auto-refunded" : "Manual refund needed"}</h3>
        <div><b>Client:</b> ${payload?.name || "—"} · ${payload?.phone || "—"}</div>
        <div><b>Wanted:</b> ${payload?.date || "—"} ${payload?.slot || ""}</div>
        <div><b>Why it failed:</b> ${reason}</div>
        <div><b>Payment ID:</b> ${paymentId}</div>
        <div><b>Order ID:</b> ${orderId}</div>
        ${refund.ok ? `<div><b>Refund ID:</b> ${refund.refundId}</div>` : `<div style="color:#b91c1c"><b>Refund error:</b> ${refund.error} — please refund this payment from the Razorpay dashboard.</div>`}
      </div>`
    );
  } catch (mailErr) {
    console.error("Payment-issue alert email failed (non-fatal):", mailErr.message);
  }
  return { refunded: refund.ok, message: paidBookingFailureMessage({ refunded: refund.ok, reason, amount, paymentId }) };
}

const PROCESSING_STALE_MS = 2 * 60 * 1000;

// Claims a pending paid order and books it — exactly once, however many
// times or from however many places (browser callback, webhook, retries)
// it's asked. Returns { appointment } | { failure } | { skipped, pending }.
export async function processPaidOrder({ orderId, paymentId }) {
  const claimed = await NoidaPendingBooking.findOneAndUpdate(
    {
      orderId,
      $or: [
        { status: "pending" },
        { status: "processing", updatedAt: { $lt: new Date(Date.now() - PROCESSING_STALE_MS) } }, // a previous attempt died midway
      ],
    },
    { status: "processing", paymentId },
    { new: true }
  );
  if (!claimed) {
    return { skipped: true, pending: await NoidaPendingBooking.findOne({ orderId }) };
  }

  const payload = claimed.toObject().payload;
  try {
    const appointment = await completePaidBooking({ payload, orderId, paymentId });
    await NoidaPendingBooking.updateOne({ _id: claimed._id }, { status: "completed", appointment: appointment._id });
    return { appointment };
  } catch (err) {
    const failure = await handlePaidBookingFailure({ pending: claimed, payload, orderId, paymentId, amount: claimed.amount, err });
    return { failure: { ...failure, status: err.status || 500 } };
  }
}

export const createNoidaAppointment = expressAsyncHandler(async (req, res, next) => {
  const {
    name, phone, email, concern, date, slot, age,
    sessionMode, format, address, packageId, customSessions, couponCode, therapistId,
    razorpay_order_id, razorpay_payment_id, razorpay_signature,
  } = req.body;
  const type = normalizeType(req.body.type);

  if (!name?.trim() || !phone?.trim()) {
    res.status(400);
    return next(new Error("Name and phone number are required."));
  }
  if (!/^\d{10}$/.test(phone.trim())) {
    res.status(400);
    return next(new Error("Please enter a valid 10-digit phone number."));
  }
  if (!isValidDateStr(date) || !slot?.trim()) {
    res.status(400);
    return next(new Error("Please select a valid date and time slot."));
  }
  if (!VALID_SESSION_MODES.includes(sessionMode) || !VALID_FORMATS.includes(format)) {
    res.status(400);
    return next(new Error("Please select a session type and format."));
  }
  if (format === "home-visit" && !address?.trim()) {
    res.status(400);
    return next(new Error("Please provide an address for the home visit."));
  }

  // Server decides credit eligibility itself — never trusts a client flag.
  const credit = type === "followup" ? await getActiveCredit(phone.trim()) : null;

  // ── Package-credit booking: no payment involved.
  if (credit) {
    const blocked = await slotUnavailableReason({ date, slot, type, phone: phone.trim() });
    if (blocked) {
      res.status(blocked.status);
      return next(new Error(blocked.message));
    }
    try {
      const appointment = await finalizeNoidaBooking({
        name, phone, email, concern, date, slot, type, age,
        sessionMode, format, address, packageId, therapistId, credit,
        paymentMethod: "razorpay",
      });
      return res.status(201).json({ status: true, message: "Appointment booked successfully.", data: appointment });
    } catch (err) {
      res.status(err.status || 500);
      return next(new Error(err.message || "Something went wrong"));
    }
  }

  // ── Paid booking. Verify the payment first — everything after this point
  // has taken the client's money, so a booking that can't go through has to
  // refund it rather than just error out.
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    res.status(400);
    return next(new Error("Payment is required to confirm this booking."));
  }
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");
  if (razorpay_signature !== expectedSignature) {
    res.status(400);
    return next(new Error("Payment verification failed."));
  }

  const hasPending = await NoidaPendingBooking.exists({ orderId: razorpay_order_id });
  let outcome;
  if (hasPending) {
    // Shared with the webhook: whichever gets there first books it, the other sees it done.
    outcome = await processPaidOrder({ orderId: razorpay_order_id, paymentId: razorpay_payment_id });
  } else {
    // Order created before this flow existed, or its pending record couldn't be saved.
    const payload = { name, phone, email, concern, date, slot, type, age, sessionMode, format, address, packageId, customSessions, couponCode, therapistId };
    try {
      const appointment = await completePaidBooking({ payload, orderId: razorpay_order_id, paymentId: razorpay_payment_id });
      outcome = { appointment };
    } catch (err) {
      const failure = await handlePaidBookingFailure({ pending: null, payload, orderId: razorpay_order_id, paymentId: razorpay_payment_id, amount: 0, err });
      outcome = { failure: { ...failure, status: err.status || 500 } };
    }
  }

  // The other side (webhook) already had this order — wait briefly for it to settle.
  if (outcome.skipped) {
    let pending = outcome.pending;
    for (let i = 0; i < 12 && pending?.status === "processing"; i++) {
      await new Promise((r) => setTimeout(r, 500));
      pending = await NoidaPendingBooking.findOne({ orderId: razorpay_order_id });
    }
    if (pending?.status === "completed" && pending.appointment) {
      const appointment = await NoidaAppointment.findById(pending.appointment);
      if (appointment) return res.status(201).json({ status: true, message: "Appointment booked successfully.", data: appointment });
    }
    if (pending?.status === "refunded" || pending?.status === "refund_failed") {
      const failure = paidBookingFailureMessage({ refunded: pending.status === "refunded", reason: pending.failureReason, amount: pending.amount, paymentId: razorpay_payment_id });
      return res.status(409).json({ status: false, message: failure, paymentHandled: true, refunded: pending.status === "refunded", data: null });
    }
    return res.status(409).json({
      status: false,
      paymentHandled: true,
      message: "We've received your payment and are confirming your booking — you'll get a confirmation shortly. If you don't, WhatsApp us with payment ID " + razorpay_payment_id + ".",
      data: null,
    });
  }

  if (outcome.failure) {
    return res.status(outcome.failure.status).json({
      status: false, message: outcome.failure.message,
      paymentHandled: true, refunded: outcome.failure.refunded, data: null,
    });
  }

  return res.status(201).json({ status: true, message: "Appointment booked successfully.", data: outcome.appointment });
});

// Once staff accepts, an unconsumed request would otherwise block the slot
// for everyone else forever if the client just never comes back to pay —
// give it the same grace window as the accept SLA itself.
const LAST_MINUTE_BOOKING_GRACE_MINUTES = 10;

// Flips a request to "expired" in place if its clock has run out but no one
// has touched it yet — keeps status honest without needing a cron job.
async function expireIfStale(request) {
  if (!request) return request;
  const deadline = request.status === "pending"
    ? new Date(request.requestedAt.getTime() + LAST_MINUTE_ACCEPT_SLA_MINUTES * 60000)
    : request.status === "accepted"
    ? new Date(request.respondedAt.getTime() + LAST_MINUTE_BOOKING_GRACE_MINUTES * 60000)
    : null;
  if (deadline && Date.now() > deadline.getTime()) {
    request.status = "expired";
    await request.save();
  }
  return request;
}

// Public: a client hitting a slot inside the last-minute window sends one
// of these instead of booking outright — staff has to accept it first (see
// acceptLastMinuteRequest) before createNoidaAppointment will let them pay.
export const createLastMinuteRequest = expressAsyncHandler(async (req, res, next) => {
  const {
    name, phone, email, concern, date, slot, age,
    sessionMode, format, address, packageId, customSessions,
  } = req.body;
  const type = normalizeType(req.body.type);

  if (!name?.trim() || !phone?.trim()) {
    res.status(400);
    return next(new Error("Name and phone number are required."));
  }
  if (!/^\d{10}$/.test(phone.trim())) {
    res.status(400);
    return next(new Error("Please enter a valid 10-digit phone number."));
  }
  if (!isValidDateStr(date) || !slot?.trim()) {
    res.status(400);
    return next(new Error("Please select a valid date and time slot."));
  }
  if (!VALID_SESSION_MODES.includes(sessionMode) || !VALID_FORMATS.includes(format)) {
    res.status(400);
    return next(new Error("Please select a session type and format."));
  }
  if (format === "home-visit" && !address?.trim()) {
    res.status(400);
    return next(new Error("Please provide an address for the home visit."));
  }

  // Honeypot: the real form never fills this hidden field, bots usually do.
  if (req.body.website) {
    res.status(400);
    return next(new Error("Could not send request."));
  }

  // Never trust the client's claim that this is a last-minute slot —
  // recompute it the same way the slots list does.
  const now = istNow();
  const today = istDateStr(now);
  const minutesToStart = slotStartMinutes(slot) - (now.getHours() * 60 + now.getMinutes());
  if (date !== today || minutesToStart <= 0) {
    res.status(400);
    return next(new Error("That slot's time has already passed."));
  }
  if (minutesToStart > LAST_MINUTE_WINDOW_MINUTES) {
    res.status(400);
    return next(new Error("That slot doesn't need a request — please book it directly."));
  }

  const isOpenSlot = await NoidaFollowupSlot.findOne({ date, slot, type });
  if (!isOpenSlot) {
    res.status(400);
    return next(new Error("That slot isn't open for booking."));
  }
  const alreadyBooked = await NoidaAppointment.findOne({ date, slot, status: "confirmed" });
  if (alreadyBooked) {
    res.status(409);
    return next(new Error("Sorry, that slot was just booked by someone else."));
  }

  // Idempotent for the same client double-tapping "Send Request".
  const ownExisting = await expireIfStale(
    await NoidaLastMinuteRequest.findOne({ date, slot, phone: phone.trim(), status: { $in: ["pending", "accepted"] } })
  );
  if (ownExisting && ownExisting.status !== "expired") {
    return res.status(200).json({ status: true, data: ownExisting });
  }

  const othersActive = await expireIfStale(
    await NoidaLastMinuteRequest.findOne({ date, slot, status: { $in: ["pending", "accepted"] } })
  );
  if (othersActive && othersActive.status !== "expired") {
    res.status(409);
    return next(new Error("Someone else has already requested this slot — please try another."));
  }

  // Abuse controls — a request costs nothing to send but takes staff time.
  const nowMs = Date.now();
  const pendingCutoff = new Date(nowMs - LAST_MINUTE_ACCEPT_SLA_MINUTES * 60000);
  const acceptedCutoff = new Date(nowMs - LAST_MINUTE_BOOKING_GRACE_MINUTES * 60000);
  const since = new Date(nowMs - 24 * 60 * 60 * 1000);
  const [activeElsewhere, sentToday, noShows, pendingTotal] = await Promise.all([
    NoidaLastMinuteRequest.exists({
      phone: phone.trim(),
      $or: [
        { status: "pending", requestedAt: { $gt: pendingCutoff } },
        { status: "accepted", respondedAt: { $gt: acceptedCutoff } },
      ],
    }),
    NoidaLastMinuteRequest.countDocuments({ phone: phone.trim(), createdAt: { $gte: since } }),
    // Staff accepted, the client never came back to pay — that's a no-show.
    NoidaLastMinuteRequest.countDocuments({ phone: phone.trim(), status: "expired", respondedAt: { $ne: null }, createdAt: { $gte: since } }),
    NoidaLastMinuteRequest.countDocuments({ status: "pending", requestedAt: { $gt: pendingCutoff } }),
  ]);
  if (activeElsewhere) {
    res.status(409);
    return next(new Error("You already have a request in progress — please wait for it to finish before sending another."));
  }
  if (sentToday >= 4) {
    res.status(429);
    return next(new Error("You've sent several requests today. Please WhatsApp us and we'll help directly."));
  }
  if (noShows >= 2) {
    res.status(429);
    return next(new Error("Earlier approved requests weren't completed, so new ones are paused for today. Please WhatsApp us."));
  }
  if (pendingTotal >= 10) {
    res.status(429);
    return next(new Error("The center is handling a lot of requests right now. Please WhatsApp us."));
  }

  const request = await NoidaLastMinuteRequest.create({
    name: name.trim(), age: age?.toString().trim() || "", phone: phone.trim(),
    email: email?.trim() || "", concern: concern?.trim() || "",
    date, slot, type, sessionMode, format,
    address: format === "home-visit" ? address.trim() : "",
    packageId: sessionMode === "package" ? asPackageId(packageId) : null,
    customSessions: sessionMode === "package" && !asPackageId(packageId) ? Number(customSessions) || 0 : 0,
  });

  try {
    await sendMail(
      "chooseyourtherapist@gmail.com",
      `⏱️ Last-minute request: ${name} — ${date} ${slot}`,
      `${name} (${phone}) wants the ${date} ${slot} slot right now. Accept within ${LAST_MINUTE_ACCEPT_SLA_MINUTES} minutes from the admin panel or it will expire.`,
      leadNotificationEmail({
        name, phone, email, age,
        concern: `Last-minute request for ${date} at ${slot}${concern ? ` — "${concern}"` : ""}`,
        source: "CYT Noida — Last-Minute Request",
      })
    );
  } catch (mailErr) {
    console.error("Last-minute request notification failed (non-fatal):", mailErr.message);
  }

  return res.status(201).json({ status: true, data: request });
});

// Public: polled by the client while waiting on staff to respond. Only
// exposes status + the accept deadline — no name/phone/etc for a caller
// who's just holding an id.
export const getLastMinuteRequestStatus = expressAsyncHandler(async (req, res, next) => {
  const request = await expireIfStale(await NoidaLastMinuteRequest.findById(req.params.id));
  if (!request) {
    res.status(404);
    return next(new Error("Request not found."));
  }
  const deadline = request.status === "pending"
    ? request.requestedAt.getTime() + LAST_MINUTE_ACCEPT_SLA_MINUTES * 60000
    : request.status === "accepted"
    ? request.respondedAt.getTime() + LAST_MINUTE_BOOKING_GRACE_MINUTES * 60000
    : null;
  return res.status(200).json({
    status: true,
    data: {
      status: request.status,
      expiresInSeconds: deadline ? Math.max(0, Math.round((deadline - Date.now()) / 1000)) : null,
    },
  });
});

// Admin: pending + recently-resolved requests for the staff panel.
export const getLastMinuteRequests = expressAsyncHandler(async (req, res, next) => {
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000); // last 3 hours of history
  const requests = await NoidaLastMinuteRequest.find({ createdAt: { $gte: cutoff } }).sort({ createdAt: -1 }).lean();
  await Promise.all(
    requests
      .filter((r) => r.status === "pending" || r.status === "accepted")
      .map(async (r) => {
        const fresh = await expireIfStale(await NoidaLastMinuteRequest.findById(r._id));
        r.status = fresh.status;
      })
  );
  return res.status(200).json({ status: true, data: requests });
});

// Admin: accept a pending request — must still be inside its SLA, and the
// slot must not have been snapped up by a walk-in/other booking meanwhile.
export const acceptLastMinuteRequest = expressAsyncHandler(async (req, res, next) => {
  const request = await NoidaLastMinuteRequest.findById(req.params.id);
  if (!request) {
    res.status(404);
    return next(new Error("Request not found."));
  }
  await expireIfStale(request);
  if (request.status !== "pending") {
    res.status(400);
    return next(new Error(`This request is no longer pending (${request.status}).`));
  }
  const clash = await NoidaAppointment.findOne({ date: request.date, slot: request.slot, status: "confirmed" });
  if (clash) {
    request.status = "rejected";
    await request.save();
    res.status(409);
    return next(new Error("That slot was just booked by someone else."));
  }
  request.status = "accepted";
  request.respondedAt = new Date();
  request.respondedBy = req.user._id;
  await request.save();
  return res.status(200).json({ status: true, message: "Request accepted.", data: request });
});

// Admin: explicitly decline a pending request (frees the slot up immediately
// instead of making the client wait out the full SLA for nothing).
export const rejectLastMinuteRequest = expressAsyncHandler(async (req, res, next) => {
  const request = await NoidaLastMinuteRequest.findById(req.params.id);
  if (!request) {
    res.status(404);
    return next(new Error("Request not found."));
  }
  if (request.status !== "pending") {
    res.status(400);
    return next(new Error(`This request is no longer pending (${request.status}).`));
  }
  request.status = "rejected";
  request.respondedAt = new Date();
  request.respondedBy = req.user._id;
  await request.save();
  return res.status(200).json({ status: true, message: "Request declined.", data: request });
});

// Admin-only (reception): books an appointment on the client's behalf,
// without a Razorpay checkout — payment is either an existing credit,
// or collected as cash/QR and confirmed by the staff member themselves.
// A public page can never safely offer this (anyone could claim "paid"
// without paying), so this stays behind admin auth.
export const adminCreateNoidaAppointment = expressAsyncHandler(async (req, res, next) => {
  const {
    name, phone, email, concern, date, slot, age,
    sessionMode, format, address, packageId, customSessions, couponCode, therapistId, paymentMethod,
  } = req.body;
  const type = normalizeType(req.body.type);

  if (!name?.trim() || !phone?.trim()) {
    res.status(400);
    return next(new Error("Name and phone number are required."));
  }
  if (!/^\d{10}$/.test(phone.trim())) {
    res.status(400);
    return next(new Error("Please enter a valid 10-digit phone number."));
  }
  if (!isValidDateStr(date) || !slot?.trim()) {
    res.status(400);
    return next(new Error("Please select a valid date and time slot."));
  }
  if (!VALID_SESSION_MODES.includes(sessionMode) || !VALID_FORMATS.includes(format)) {
    res.status(400);
    return next(new Error("Please select a session type and format."));
  }
  if (format === "home-visit" && !address?.trim()) {
    res.status(400);
    return next(new Error("Please provide an address for the home visit."));
  }

  const credit = type === "followup" ? await getActiveCredit(phone.trim()) : null;

  if (!credit && !["cash", "qr"].includes(paymentMethod)) {
    res.status(400);
    return next(new Error("Please choose how payment was collected (cash or QR)."));
  }

  const isOpen = await NoidaFollowupSlot.findOne({ date, slot, type });
  if (!isOpen) {
    res.status(400);
    return next(new Error("That slot isn't open for booking on the selected date."));
  }

  try {
    const appointment = await finalizeNoidaBooking({
      name, phone, email, concern, date, slot, type, age,
      sessionMode, format, address, packageId, customSessions, couponCode, therapistId, credit,
      paymentMethod: credit ? undefined : paymentMethod,
      bookedByAdmin: req.user._id,
    });
    return res.status(201).json({ status: true, message: "Appointment booked.", data: appointment });
  } catch (err) {
    res.status(err.status || 500);
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Admin-only: generates a UPI QR code (reuses the same UPIInfo config + QR
// helper already used for therapist bookings) for the given amount, so
// reception can show it to a walk-in client to scan-and-pay.
export const getNoidaPaymentQr = expressAsyncHandler(async (req, res, next) => {
  const amount = Number(req.query.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400);
    return next(new Error("A valid amount is required."));
  }
  try {
    const upi = await UPIInfo.findOne();
    if (!upi) {
      res.status(400);
      return next(new Error("UPI payment info is not configured yet — set it up first."));
    }
    const qrImage = await generateQrCode({ upiID: upi.upi_id, name: upi.name, amount, note: "CYT Noida Session" });
    return res.status(200).json({ status: true, data: { qrImage, upiId: upi.upi_id, name: upi.name, amount } });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Shared by the list, the CSV export and the summary: turns the admin's
// query-string filters into a Mongo filter (+ the sort that suits the view).
function buildAppointmentFilter(q) {
  const today = istDateStr(istNow());
  const filter = {};
  if (q.archived === "1") filter.archived = true;
  else filter.archived = { $ne: true };

  if (q.status) filter.status = q.status;
  if (q.type) filter.type = q.type;
  if (q.format) filter.format = q.format;
  if (q.therapist && mongoose.Types.ObjectId.isValid(q.therapist)) filter.therapist = q.therapist;
  if (q.date) filter.date = q.date;

  const range = {};
  if (q.from && isValidDateStr(q.from)) range.$gte = q.from;
  if (q.to && isValidDateStr(q.to)) range.$lte = q.to;
  if (q.when === "upcoming") range.$gte = range.$gte && range.$gte > today ? range.$gte : today;
  if (q.when === "past") range.$lt = today;
  if (Object.keys(range).length && !q.date) filter.date = range;

  if (q.payment === "paid") filter.paymentStatus = "paid";
  else if (q.payment === "pending") filter.paymentStatus = "pending";
  else if (q.payment === "credit") filter.paymentStatus = "package-credit";
  else if (q.payment === "cash") filter.paymentMethod = "cash";

  if (q.attendance === "none") filter.attendance = { $in: ["", null] };
  else if (["arrived", "completed", "no_show"].includes(q.attendance)) filter.attendance = q.attendance;

  const term = String(q.search || "").trim().slice(0, 60);
  if (term) {
    const rx = new RegExp(escapeRegex(term), "i");
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }, { clientCode: rx }];
  }

  const sort = q.when === "upcoming" ? { date: 1, slot: 1 } : { date: -1, slot: 1 };
  return { filter, sort };
}

export const getNoidaAppointments = expressAsyncHandler(async (req, res, next) => {
  try {
    await ensureBackfilled();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 30));
    const { filter, sort } = buildAppointmentFilter(req.query);

    const [items, total] = await Promise.all([
      NoidaAppointment.find(filter)
        .sort(sort)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate("assignedTo", "name email")
        .populate("bookedByAdmin", "name")
        .lean(),
      NoidaAppointment.countDocuments(filter),
    ]);

    return res.status(200).json({
      status: true,
      data: items,
      total,
      page,
      pages: Math.ceil(total / pageSize) || 1,
    });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Everything the current filters match (capped) — the admin turns it into a CSV.
export const exportNoidaAppointments = expressAsyncHandler(async (req, res, next) => {
  try {
    await ensureBackfilled();
    const { filter, sort } = buildAppointmentFilter(req.query);
    const rows = await NoidaAppointment.find(filter)
      .sort(sort)
      .limit(5000)
      .populate("assignedTo", "name")
      .lean();
    return res.status(200).json({ status: true, data: rows });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// The four numbers at the top of the admin's appointments page.
export const getNoidaAppointmentsSummary = expressAsyncHandler(async (req, res, next) => {
  try {
    const now = istNow();
    const today = istDateStr(now);
    const plus = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return istDateStr(d); };
    const notArchived = { archived: { $ne: true } };
    const live = { ...notArchived, status: "confirmed" };

    const [todayRows, upcoming7, pendingPayment, incomeAgg] = await Promise.all([
      NoidaAppointment.find({ ...live, date: today }).select("attendance").lean(),
      NoidaAppointment.countDocuments({ ...live, date: { $gt: today, $lte: plus(7) } }),
      NoidaAppointment.countDocuments({ ...live, date: { $gte: today }, paymentStatus: "pending" }),
      NoidaAppointment.aggregate([
        { $match: { ...live, paymentStatus: "paid", date: { $gte: plus(-6), $lte: today } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    return res.status(200).json({
      status: true,
      data: {
        today: todayRows.length,
        todayArrived: todayRows.filter((r) => r.attendance === "arrived" || r.attendance === "completed").length,
        upcoming7,
        pendingPayment,
        income7: incomeAgg[0]?.total || 0,
        dates: { today, tomorrow: plus(1), plus7: plus(7), minus6: plus(-6) },
      },
    });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const updateNoidaAppointment = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { status, adminNote, attendance, archived, notifyClient } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid appointment ID format."));
  }
  if (status && !["confirmed", "cancelled"].includes(status)) {
    res.status(400);
    return next(new Error("Invalid status value."));
  }
  if (attendance !== undefined && !["", "arrived", "completed", "no_show"].includes(attendance)) {
    res.status(400);
    return next(new Error("Invalid attendance value."));
  }

  try {
    const update = {};
    if (status) update.status = status;
    if (adminNote !== undefined) update.adminNote = adminNote;
    if (attendance !== undefined) {
      update.attendance = attendance;
      update.attendanceAt = attendance ? new Date() : null;
    }
    if (archived !== undefined) {
      const current = await NoidaAppointment.findById(id).select("status").lean();
      if (!current) {
        res.status(404);
        return next(new Error("Appointment not found."));
      }
      // Only a cancelled booking can be tucked away — a live one still holds its slot.
      if (archived && (status || current.status) !== "cancelled") {
        res.status(400);
        return next(new Error("Cancel the appointment first, then archive it."));
      }
      update.archived = !!archived;
      update.archivedAt = archived ? new Date() : null;
    }

    const before = status ? await NoidaAppointment.findById(id).select("status date slot type").lean() : null;
    if (status === "confirmed" && before && before.status === "cancelled") {
      // Bringing a cancelled booking back — only if nobody else has taken the slot since.
      const taken = await NoidaAppointment.exists({ _id: { $ne: id }, date: before.date, slot: before.slot, status: "confirmed" });
      if (taken) {
        res.status(409);
        return next(new Error("Someone else has booked that slot since — it can't be re-confirmed."));
      }
    }

    const appointment = await NoidaAppointment.findByIdAndUpdate(id, update, { new: true });
    if (!appointment) {
      res.status(404);
      return next(new Error("Appointment not found."));
    }

    // A booking cancelled by the admin closes its slot for good (reopen it from Manage
    // Slots); bringing the booking back reopens the slot so it shows up in the tables again.
    let slotClosed = false;
    if (status === "cancelled" && before && before.status !== "cancelled" && req.body.closeSlot !== false) {
      const r = await NoidaFollowupSlot.deleteMany({ date: appointment.date, slot: appointment.slot });
      slotClosed = r.deletedCount > 0;
    }
    if (status === "confirmed" && before && before.status === "cancelled") {
      await NoidaFollowupSlot.updateOne(
        { date: appointment.date, slot: appointment.slot, type: appointment.type },
        { $setOnInsert: { date: appointment.date, slot: appointment.slot, type: appointment.type } },
        { upsert: true }
      );
    }

    let notified = false;
    if (status === "cancelled" && notifyClient && appointment.email) {
      try {
        await sendMail(
          appointment.email,
          "Your appointment at Choose Your Therapist has been cancelled",
          `Hi ${appointment.name}, your appointment on ${appointment.date} (${appointment.slot}) at CYT Noida has been cancelled. If you'd like to rebook, visit chooseyourtherapist.in/noida-appointment or WhatsApp us.`,
          `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">
            <p>Hi ${appointment.name},</p>
            <p>Your appointment on <b>${appointment.date}</b> (${appointment.slot}) at CYT Noida has been cancelled.</p>
            <p>If you'd like to rebook, visit <a href="https://chooseyourtherapist.in/noida-appointment">chooseyourtherapist.in/noida-appointment</a> or reply on WhatsApp.</p>
          </div>`
        );
        notified = true;
      } catch (mailErr) {
        console.error("Cancellation email failed (non-fatal):", mailErr.message);
      }
    }
    return res.status(200).json({ status: true, message: "Appointment updated.", data: appointment, notified, slotClosed });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Assigns (or unassigns, with adminId: null) a booking to a team member and
// emails them the booking details.
export const assignNoidaAppointment = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { adminId } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid appointment ID format."));
  }

  let admin = null;
  if (adminId) {
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      res.status(400);
      return next(new Error("Invalid team member ID."));
    }
    admin = await Admin.findById(adminId).select("name email");
    if (!admin) {
      res.status(404);
      return next(new Error("Team member not found."));
    }
  }

  try {
    const appointment = await NoidaAppointment.findByIdAndUpdate(id, { assignedTo: adminId || null }, { new: true })
      .populate("assignedTo", "name email");
    if (!appointment) {
      res.status(404);
      return next(new Error("Appointment not found."));
    }

    if (admin?.email) {
      const formatLabel = appointment.format === "home-visit" ? "Home Visit" : appointment.format === "online" ? "Online" : "In-person";
      const modeLabel = appointment.sessionMode === "package" ? `Package (${appointment.packageName})` : appointment.sessionMode === "couple" ? "Couple" : "Individual";
      try {
        await sendMail(
          admin.email,
          `📅 Noida Booking Assigned to You: ${appointment.name} — ${appointment.date} ${appointment.slot}`,
          `A CYT Noida appointment has been assigned to you: ${appointment.name}, ${appointment.phone}, ${appointment.date} ${appointment.slot}`,
          leadNotificationEmail({
            name: appointment.name, phone: appointment.phone, email: appointment.email,
            concern: `${modeLabel} · ${formatLabel} — ${appointment.date} at ${appointment.slot}${appointment.concern ? ` — "${appointment.concern}"` : ""}`,
            source: "Assigned to you — CYT Noida Booking",
          })
        );
      } catch (mailErr) {
        console.error("Noida appointment assignment email failed (non-fatal):", mailErr.message);
      }
    }

    return res.status(200).json({ status: true, message: admin ? "Appointment assigned." : "Appointment unassigned.", data: appointment });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const deleteNoidaAppointment = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid appointment ID format."));
  }

  try {
    const appointment = await NoidaAppointment.findByIdAndDelete(id);
    if (!appointment) {
      res.status(404);
      return next(new Error("Appointment not found."));
    }
    return res.status(200).json({ status: true, message: "Appointment deleted." });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Admin-only: books a session directly against an existing client credit,
// bypassing the public phone-lookup flow — for when the admin is scheduling
// on the client's behalf (e.g. over a call) instead of the client
// self-booking through the site. Always type "followup" since it draws
// from a package credit, same as the public credit-based flow.
export const adminBookCreditSession = expressAsyncHandler(async (req, res, next) => {
  const { creditId, date, slot } = req.body;

  if (!mongoose.Types.ObjectId.isValid(creditId)) {
    res.status(400);
    return next(new Error("Invalid credit ID."));
  }
  if (!isValidDateStr(date) || !slot?.trim()) {
    res.status(400);
    return next(new Error("Please select a valid date and time slot."));
  }

  try {
    const credit = await NoidaClientCredit.findById(creditId);
    if (!credit || !credit.active) {
      res.status(404);
      return next(new Error("Client credit not found or inactive."));
    }
    if (credit.sessionsUsed >= credit.totalSessions) {
      res.status(400);
      return next(new Error("This client has no sessions remaining on this credit."));
    }

    const isOpen = await NoidaFollowupSlot.findOne({ date, slot, type: "followup" });
    if (!isOpen) {
      res.status(400);
      return next(new Error("That slot isn't open for booking on the selected date."));
    }
    const clash = await NoidaAppointment.findOne({ date, slot, status: "confirmed" });
    if (clash) {
      res.status(409);
      return next(new Error("That slot is already booked."));
    }

    // Same optimistic-lock claim pattern as the public credit-based flow.
    const claimed = await NoidaClientCredit.findOneAndUpdate(
      { _id: credit._id, sessionsUsed: credit.sessionsUsed },
      { $inc: { sessionsUsed: 1 } },
      { new: true }
    );
    if (!claimed) {
      res.status(409);
      return next(new Error("That credit was just updated elsewhere. Please refresh and try again."));
    }

    const appointment = await NoidaAppointment.create({
      name: credit.name,
      phone: credit.phone,
      clientCode: await ensureClientCode({ phone: credit.phone, name: credit.name }),
      date, slot,
      type: "followup",
      sessionMode: "individual",
      format: "in-person",
      packageName: credit.packageName,
      paymentStatus: "package-credit",
      creditUsed: credit._id,
    });

    return res.status(201).json({ status: true, message: "Session booked.", data: appointment });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// ── Slot management (admin) ─────────────────────────────────────────────
// Admin opens up specific date+slot combinations, tagged "new" or
// "followup"; clients on the matching tab can only pick from what's been
// opened here.

export const getFollowupSlots = expressAsyncHandler(async (req, res, next) => {
  try {
    await ensureBackfilled();
    const filter = {};
    if (req.query.date) filter.date = req.query.date;
    if (req.query.type) filter.type = normalizeType(req.query.type);

    const slots = await NoidaFollowupSlot.find(filter).sort({ date: 1, slot: 1 }).lean();
    const dates = [...new Set(slots.map((s) => s.date))];
    const booked = await NoidaAppointment.find({ status: "confirmed", archived: { $ne: true }, date: { $in: dates } })
      .select("date slot name clientCode therapistName age phone email concern type sessionMode format address packageName paymentStatus paymentMethod amount couponCode discountAmount attendance adminNote bookedByAdmin previousDate previousSlot createdAt")
      .lean();
    const byKey = new Map(booked.map((b) => [`${b.date}|${b.slot}`, b]));

    // Who holds a booked slot travels with it — this endpoint is admin-only, and the
    // reception screen shows the name in the box and the full details on tap.
    const data = slots.map((s) => {
      const b = byKey.get(`${s.date}|${s.slot}`);
      if (!b) return { ...s, booked: false };
      const { date, slot, bookedByAdmin, ...rest } = b;
      return { ...s, booked: true, booking: { ...rest, bookedByAdmin: !!bookedByAdmin } };
    });
    return res.status(200).json({ status: true, data });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Every session is 60 minutes; only the start time varies. Labels look like
// "2:30 PM - 3:30 PM".
const SLOT_LABEL_RE = /^(1[0-2]|[1-9]):[0-5]\d (AM|PM) - (1[0-2]|[1-9]):[0-5]\d (AM|PM)$/;
function isValidSlotLabel(label) {
  if (typeof label !== "string" || !SLOT_LABEL_RE.test(label)) return false;
  const [from, to] = label.split(" - ");
  return (slotStartMinutes(to) - slotStartMinutes(from) + 1440) % 1440 === 60;
}
const INVALID_SLOT_MESSAGE = "Each slot must be 60 minutes long, like 2:30 PM - 3:30 PM.";

export const addFollowupSlots = expressAsyncHandler(async (req, res, next) => {
  const { date, slots } = req.body;
  const type = normalizeType(req.body.type);
  if (!isValidDateStr(date) || !Array.isArray(slots) || slots.length === 0) {
    res.status(400);
    return next(new Error("A date and at least one slot are required."));
  }
  if (!slots.every(isValidSlotLabel)) {
    res.status(400);
    return next(new Error(INVALID_SLOT_MESSAGE));
  }

  try {
    const ops = slots.map((slot) => ({
      updateOne: {
        filter: { date, slot, type },
        update: { $setOnInsert: { date, slot, type } },
        upsert: true,
      },
    }));
    await NoidaFollowupSlot.bulkWrite(ops);
    const saved = await NoidaFollowupSlot.find({ date, type, slot: { $in: slots } }).sort({ slot: 1 }).lean();
    return res.status(201).json({ status: true, message: "Slots opened.", data: saved });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Admin convenience: open the same set of slot labels across many dates in
// one click, instead of clicking through each date individually — mainly
// for populating the next couple of weeks' worth of availability at once.
export const addFollowupSlotsBulk = expressAsyncHandler(async (req, res, next) => {
  const { dates, slots } = req.body;
  const type = normalizeType(req.body.type);
  if (!Array.isArray(dates) || dates.length === 0 || !Array.isArray(slots) || slots.length === 0) {
    res.status(400);
    return next(new Error("At least one date and one slot are required."));
  }
  if (!dates.every(isValidDateStr)) {
    res.status(400);
    return next(new Error("One or more dates are invalid."));
  }
  if (!slots.every(isValidSlotLabel)) {
    res.status(400);
    return next(new Error(INVALID_SLOT_MESSAGE));
  }

  try {
    const ops = [];
    for (const date of dates) {
      for (const slot of slots) {
        ops.push({
          updateOne: {
            filter: { date, slot, type },
            update: { $setOnInsert: { date, slot, type } },
            upsert: true,
          },
        });
      }
    }
    await NoidaFollowupSlot.bulkWrite(ops);
    return res.status(201).json({ status: true, message: `Opened up to ${ops.length} slots across ${dates.length} date(s).` });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const deleteFollowupSlot = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid slot ID format."));
  }

  try {
    const slot = await NoidaFollowupSlot.findById(id);
    if (!slot) {
      res.status(404);
      return next(new Error("Slot not found."));
    }
    const booked = await NoidaAppointment.findOne({ date: slot.date, slot: slot.slot, status: "confirmed" });
    if (booked) {
      res.status(409);
      return next(new Error("This slot already has a booking — cancel that appointment first."));
    }
    await slot.deleteOne();
    return res.status(200).json({ status: true, message: "Slot removed." });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});


// ── Payment problems (admin) ────────────────────────────────────────────────
// Public bookings that were paid for but couldn't be finished, and what
// happened to the money. "needsAction" is what staff must handle by hand.
const STUCK_PROCESSING_MS = 10 * 60 * 1000;

function problemView(doc) {
  return {
    _id: doc._id,
    orderId: doc.orderId,
    paymentId: doc.paymentId || "",
    amount: doc.amount || 0,
    status: doc.status,
    failureReason: doc.failureReason || "",
    refundId: doc.refundId || "",
    resolved: !!doc.resolved,
    resolvedNote: doc.resolvedNote || "",
    resolvedAt: doc.resolvedAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    name: doc.payload?.name || "",
    phone: doc.payload?.phone || "",
    date: doc.payload?.date || "",
    slot: doc.payload?.slot || "",
  };
}

export const getPaymentProblems = expressAsyncHandler(async (req, res, next) => {
  try {
    const stuckBefore = new Date(Date.now() - STUCK_PROCESSING_MS);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [needs, recent] = await Promise.all([
      NoidaPendingBooking.find({
        resolved: { $ne: true },
        $or: [{ status: "refund_failed" }, { status: "processing", updatedAt: { $lt: stuckBefore } }],
      }).sort({ updatedAt: -1 }).limit(100).lean(),
      NoidaPendingBooking.find({
        updatedAt: { $gte: since },
        $or: [{ status: "refunded" }, { resolved: true }],
      }).sort({ updatedAt: -1 }).limit(100).lean(),
    ]);
    return res.status(200).json({
      status: true,
      data: { needsAction: needs.map(problemView), recent: recent.map(problemView) },
    });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Tries again: a failed refund is re-sent to Razorpay; an order stuck
// mid-booking is re-run (books it, or refunds if the slot is gone).
export const retryPaymentProblem = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid ID format."));
  }
  try {
    const doc = await NoidaPendingBooking.findById(id);
    if (!doc) {
      res.status(404);
      return next(new Error("Payment record not found."));
    }
    if (!doc.paymentId) {
      res.status(400);
      return next(new Error("No payment is recorded against this order, so there is nothing to retry."));
    }

    let message;
    if (doc.status === "refund_failed") {
      const refund = await refundPayment(doc.paymentId, doc.failureReason || "Booking could not be completed");
      const alreadyRefunded = !refund.ok && /fully refunded|already.*refund/i.test(refund.error || "");
      if (refund.ok || alreadyRefunded) {
        await NoidaPendingBooking.updateOne({ _id: doc._id }, { status: "refunded", refundId: refund.refundId || doc.refundId });
        message = alreadyRefunded ? "Razorpay says this payment was already refunded — marked as refunded." : "Refund sent to Razorpay.";
      } else {
        res.status(502);
        return next(new Error(`Refund still failing: ${refund.error}`));
      }
    } else if (doc.status === "processing") {
      const out = await processPaidOrder({ orderId: doc.orderId, paymentId: doc.paymentId });
      if (out.appointment) message = "Booking completed.";
      else if (out.failure) message = out.failure.refunded ? "Slot is no longer available — payment refunded." : "Slot is no longer available and the refund failed again.";
      else message = "Another process is already handling this order — check again in a minute.";
    } else {
      res.status(400);
      return next(new Error("This order does not need a retry."));
    }

    const fresh = await NoidaPendingBooking.findById(id).lean();
    return res.status(200).json({ status: true, message, data: problemView(fresh) });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const resolvePaymentProblem = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid ID format."));
  }
  try {
    const note = String(req.body?.note || "").trim().slice(0, 300);
    const doc = await NoidaPendingBooking.findByIdAndUpdate(
      id, { resolved: true, resolvedNote: note, resolvedAt: new Date() }, { new: true }
    ).lean();
    if (!doc) {
      res.status(404);
      return next(new Error("Payment record not found."));
    }
    return res.status(200).json({ status: true, message: "Marked as resolved.", data: problemView(doc) });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});
