import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Razorpay from "razorpay";
import crypto from "crypto";
import NoidaAppointment from "../models/NoidaAppointment.js";
import NoidaFollowupSlot from "../models/NoidaFollowupSlot.js";
import NoidaPackage from "../models/NoidaPackage.js";
import NoidaClientCredit from "../models/NoidaClientCredit.js";
import Lead from "../models/Lead.js";
import Admin from "../models/Admin.js";
import { sendMail } from "../helper/mailer.js";
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
async function computeBookingAmount({ sessionMode, format, packageId }) {
  const pricing = await getOrCreatePricing();
  let baseAmount;
  let packageName = "";

  if (sessionMode === "package") {
    if (!packageId || !mongoose.Types.ObjectId.isValid(packageId)) {
      throw new Error("Please select a valid package.");
    }
    const pkg = await NoidaPackage.findOne({ _id: packageId, active: true });
    if (!pkg) throw new Error("That package is no longer available.");
    baseAmount = pkg.price;
    packageName = pkg.name;
  } else {
    baseAmount = pricing[priceFieldFor(sessionMode, format)];
  }

  const platformFee = pricing.platformFee;
  return { baseAmount, platformFee, totalAmount: baseAmount + platformFee, packageName };
}

// Both "new" and "followup" bookings now draw exclusively from admin-opened
// slots (see NoidaFollowupSlot) — there's no more auto-generated fixed grid.
// These two constants are the only leftover "business hours" concept, and
// they only matter for the same-day notice cutoff below.
const MIN_NOTICE_MINUTES = 60; // can't book a same-day slot starting sooner than this
const MAX_DAYS_AHEAD = 60;

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

// Drops slots starting within the same-day notice window. No-op for future dates.
function dropPastNotice(slots, date, today, now) {
  if (date !== today) return slots;
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + MIN_NOTICE_MINUTES;
  return slots.filter((label) => {
    const startLabel = label.split(" - ")[0];
    const [time, ampm] = startLabel.split(" ");
    let [h, m] = time.split(":").map(Number);
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return h * 60 + m >= nowMinutes;
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
  let slotLabels = saved.map((s) => s.slot);

  slotLabels = dropPastNotice(slotLabels, date, today, now);

  // Physical slot occupancy is global — a "new" and a "followup" booking can't share a time.
  // Booked slots stay in the list (marked booked) rather than disappearing, so the client
  // can see the full picture of what's taken vs. open.
  const booked = await NoidaAppointment.find({ date, status: "confirmed" }).select("slot").lean();
  const bookedSet = new Set(booked.map((b) => b.slot));
  const data = slotLabels.map((slot) => ({ slot, booked: bookedSet.has(slot) }));

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
  const { sessionMode, format, packageId, address, phone } = req.body;
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

  try {
    const { baseAmount, platformFee, totalAmount, packageName } = await computeBookingAmount({ sessionMode, format, packageId });

    const razorpay = getRazorpayInstance();
    const order = await razorpay.orders.create({
      amount: Math.round(totalAmount * 100), // paise
      currency: "INR",
      receipt: `noida_${Date.now()}`,
    });

    return res.status(200).json({
      status: true,
      data: {
        orderId: order.id,
        keyId: process.env.RAZORPAY_KEY_ID,
        baseAmount,
        platformFee,
        amount: totalAmount,
        packageName,
      },
    });
  } catch (err) {
    return next(new Error(err.message || "Could not start payment. Please try again."));
  }
});

export const createNoidaAppointment = expressAsyncHandler(async (req, res, next) => {
  const {
    name, phone, email, concern, date, slot, age,
    sessionMode, format, address, packageId,
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

  if (!credit) {
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
  }

  const isOpen = await NoidaFollowupSlot.findOne({ date, slot, type });
  if (!isOpen) {
    res.status(400);
    return next(new Error("That slot isn't open for booking on the selected date."));
  }

  try {
    const alreadyBooked = await NoidaAppointment.findOne({ date, slot, status: "confirmed" });
    if (alreadyBooked) {
      res.status(409);
      return next(new Error("Sorry, that slot was just booked by someone else. Please pick another — your payment will be refunded."));
    }

    let baseAmount = 0, platformFee = 0, totalAmount = 0, packageName = "", creditUsedId = null;

    if (credit) {
      // Atomically claim one session — the sessionsUsed condition means only
      // one concurrent request can win if two both raced in on the same credit.
      const claimed = await NoidaClientCredit.findOneAndUpdate(
        { _id: credit._id, sessionsUsed: credit.sessionsUsed },
        { $inc: { sessionsUsed: 1 } },
        { new: true }
      );
      if (!claimed) {
        res.status(409);
        return next(new Error("Your session credit was just claimed elsewhere. Please refresh and try again, or WhatsApp us."));
      }
      packageName = claimed.packageName;
      creditUsedId = claimed._id;
    } else {
      // Recomputed fresh (never trusts a client-sent amount) — matches what the
      // order was created for, since both calls read the same live pricing.
      const computed = await computeBookingAmount({ sessionMode, format, packageId });
      baseAmount = computed.baseAmount;
      platformFee = computed.platformFee;
      totalAmount = computed.totalAmount;
      packageName = computed.packageName;
    }

    const appointment = await NoidaAppointment.create({
      name: name.trim(),
      age: age?.toString().trim() || "",
      phone: phone.trim(),
      email: email?.trim() || "",
      concern: concern?.trim() || "",
      date,
      slot,
      type,
      sessionMode,
      format,
      address: format === "home-visit" ? address.trim() : "",
      packageId: sessionMode === "package" ? packageId : null,
      packageName,
      amount: totalAmount,
      platformFee,
      paymentStatus: credit ? "package-credit" : "paid",
      razorpayOrderId: credit ? "" : razorpay_order_id,
      razorpayPaymentId: credit ? "" : razorpay_payment_id,
      creditUsed: creditUsedId,
    });

    // A brand-new (paid, not credit-funded) package purchase — open a credit
    // record so this client's future follow-ups skip payment automatically.
    if (!credit && sessionMode === "package" && packageId) {
      const pkg = await NoidaPackage.findById(packageId).lean();
      if (pkg) {
        await NoidaClientCredit.create({
          phone: phone.trim(),
          name: name.trim(),
          packageName: pkg.name,
          totalSessions: pkg.sessionsCount,
          sessionsUsed: 1, // this booking is the first session of the bundle
          source: "online-purchase",
        });
      }
    }

    const formatLabel = format === "home-visit" ? "Home Visit" : format === "online" ? "Online" : "In-person";
    const modeLabel = sessionMode === "package" ? `Package (${packageName})` : sessionMode === "couple" ? "Couple" : "Individual";
    const paidLabel = credit ? `used 1 package session (${packageName})` : `₹${totalAmount} paid`;

    try {
      await sendMail(
        "chooseyourtherapist@gmail.com",
        `Noida Center Booking (${type === "followup" ? "Follow-up" : "New"}): ${name} — ${date} ${slot}`,
        `New Noida center appointment: ${name}, ${phone}, ${date} ${slot}`,
        leadNotificationEmail({
          name, phone, email, age,
          concern: `${modeLabel} · ${formatLabel}${address ? ` · ${address}` : ""} — ${date} at ${slot} — ${paidLabel}${concern ? ` — "${concern}"` : ""}`,
          source: "Noida Center Booking",
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
              `A Noida center appointment has been assigned to you: ${name}, ${phone}, ${date} ${slot}`,
              leadNotificationEmail({
                name, phone, email, age,
                concern: `${modeLabel} · ${formatLabel}${address ? ` · ${address}` : ""} — ${date} at ${slot} — ${paidLabel}${concern ? ` — "${concern}"` : ""}`,
                source: "Assigned to you — Noida Center Booking",
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
          "Your Noida Center Appointment is Confirmed",
          `Your appointment is confirmed for ${date} at ${slot}.`,
          noidaAppointmentConfirmationEmail({ name, date, slot, concern })
        );
      } catch (mailErr) {
        console.error("Noida appointment client confirmation failed (non-fatal):", mailErr.message);
      }
    }

    return res.status(201).json({
      status: true,
      message: "Appointment booked successfully.",
      data: appointment,
    });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const getNoidaAppointments = expressAsyncHandler(async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 30));
    const filter = {};
    if (req.query.date) filter.date = req.query.date;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type) filter.type = req.query.type;

    const [items, total] = await Promise.all([
      NoidaAppointment.find(filter)
        .sort({ date: -1, slot: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate("assignedTo", "name email")
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

export const updateNoidaAppointment = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { status, adminNote } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid appointment ID format."));
  }
  if (status && !["confirmed", "cancelled"].includes(status)) {
    res.status(400);
    return next(new Error("Invalid status value."));
  }

  try {
    const update = {};
    if (status) update.status = status;
    if (adminNote !== undefined) update.adminNote = adminNote;

    const appointment = await NoidaAppointment.findByIdAndUpdate(id, update, { new: true });
    if (!appointment) {
      res.status(404);
      return next(new Error("Appointment not found."));
    }
    return res.status(200).json({ status: true, message: "Appointment updated.", data: appointment });
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
          `A Noida center appointment has been assigned to you: ${appointment.name}, ${appointment.phone}, ${appointment.date} ${appointment.slot}`,
          leadNotificationEmail({
            name: appointment.name, phone: appointment.phone, email: appointment.email,
            concern: `${modeLabel} · ${formatLabel} — ${appointment.date} at ${appointment.slot}${appointment.concern ? ` — "${appointment.concern}"` : ""}`,
            source: "Assigned to you — Noida Center Booking",
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

// ── Slot management (admin) ─────────────────────────────────────────────
// Admin opens up specific date+slot combinations, tagged "new" or
// "followup"; clients on the matching tab can only pick from what's been
// opened here.

export const getFollowupSlots = expressAsyncHandler(async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.date) filter.date = req.query.date;
    if (req.query.type) filter.type = normalizeType(req.query.type);

    const slots = await NoidaFollowupSlot.find(filter).sort({ date: 1, slot: 1 }).lean();
    const booked = await NoidaAppointment.find({ status: "confirmed" }).select("date slot").lean();
    const bookedSet = new Set(booked.map((b) => `${b.date}|${b.slot}`));

    const data = slots.map((s) => ({ ...s, booked: bookedSet.has(`${s.date}|${s.slot}`) }));
    return res.status(200).json({ status: true, data });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const addFollowupSlots = expressAsyncHandler(async (req, res, next) => {
  const { date, slots } = req.body;
  const type = normalizeType(req.body.type);
  if (!isValidDateStr(date) || !Array.isArray(slots) || slots.length === 0) {
    res.status(400);
    return next(new Error("A date and at least one slot are required."));
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
