import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import NoidaAppointment from "../models/NoidaAppointment.js";
import NoidaFollowupSlot from "../models/NoidaFollowupSlot.js";
import Lead from "../models/Lead.js";
import { sendMail } from "../helper/mailer.js";
import { leadNotificationEmail, noidaAppointmentConfirmationEmail } from "../services/mailTemplates.js";

// Center hours: Mon–Sat, 10:00 AM – 7:00 PM, 45-min slots. Closed Sunday.
// (This fixed grid is only for new-client bookings — follow-ups use whatever
// dates/slots the admin has explicitly opened, see NoidaFollowupSlot.)
const START_HOUR = 10;
const END_HOUR = 19;
const SLOT_MINUTES = 45;
const MIN_NOTICE_MINUTES = 60; // can't book a same-day slot starting sooner than this
const MAX_DAYS_AHEAD = 30;

const pad2 = (n) => String(n).padStart(2, "0");

function fmtTime(minutesOfDay) {
  let h = Math.floor(minutesOfDay / 60);
  const m = minutesOfDay % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${pad2(m)} ${ampm}`;
}

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

// All fixed-grid slot labels for a given date — "" (empty array) if the center is closed that day.
function allSlotsForDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = new Date(y, m - 1, d, 12).getDay(); // noon avoids any DST/TZ boundary issue
  if (weekday === 0) return []; // closed Sunday

  const slots = [];
  for (let t = START_HOUR * 60; t + SLOT_MINUTES <= END_HOUR * 60; t += SLOT_MINUTES) {
    slots.push(`${fmtTime(t)} - ${fmtTime(t + SLOT_MINUTES)}`);
  }
  return slots;
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
  const type = req.query.type === "followup" ? "followup" : "new";
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

  let slots;
  if (type === "followup") {
    const saved = await NoidaFollowupSlot.find({ date }).select("slot").lean();
    slots = saved.map((s) => s.slot);
  } else {
    slots = allSlotsForDate(date);
  }

  slots = dropPastNotice(slots, date, today, now);

  if (slots.length > 0) {
    // Physical slot occupancy is global — a "new" and a "followup" booking can't share a time.
    const booked = await NoidaAppointment.find({ date, status: "confirmed" }).select("slot").lean();
    const bookedSet = new Set(booked.map((b) => b.slot));
    slots = slots.filter((s) => !bookedSet.has(s));
  }

  return res.status(200).json({ status: true, data: slots });
});

// Public: which dates currently have at least one open (unbooked) follow-up
// slot — lets the follow-up tab show only dates worth offering, instead of
// blindly rendering 14 days and querying each one.
export const getFollowupDates = expressAsyncHandler(async (req, res, next) => {
  try {
    const now = istNow();
    const today = istDateStr(now);

    const [allSlots, booked] = await Promise.all([
      NoidaFollowupSlot.find({ date: { $gte: today } }).select("date slot").lean(),
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
    const pastAppointment = await NoidaAppointment.findOne({ phone }).sort({ createdAt: -1 }).select("name").lean();
    if (pastAppointment?.name) {
      return res.status(200).json({ status: true, data: { found: true, name: pastAppointment.name } });
    }

    const pastLead = await Lead.findOne({ phone }).sort({ created_at: -1 }).select("name").lean();
    if (pastLead?.name) {
      return res.status(200).json({ status: true, data: { found: true, name: pastLead.name } });
    }

    return res.status(200).json({ status: true, data: { found: false, name: null } });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const createNoidaAppointment = expressAsyncHandler(async (req, res, next) => {
  const { name, phone, email, concern, date, slot, age } = req.body;
  const type = req.body.type === "followup" ? "followup" : "new";

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

  if (type === "followup") {
    const isOpen = await NoidaFollowupSlot.findOne({ date, slot });
    if (!isOpen) {
      res.status(400);
      return next(new Error("That slot isn't open for follow-ups on the selected date."));
    }
  } else if (!allSlotsForDate(date).includes(slot)) {
    res.status(400);
    return next(new Error("That slot isn't valid for the selected date."));
  }

  try {
    const alreadyBooked = await NoidaAppointment.findOne({ date, slot, status: "confirmed" });
    if (alreadyBooked) {
      res.status(409);
      return next(new Error("Sorry, that slot was just booked by someone else. Please pick another."));
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
    });

    try {
      await sendMail(
        "chooseyourtherapist@gmail.com",
        `Noida Center Booking (${type === "followup" ? "Follow-up" : "New"}): ${name} — ${date} ${slot}`,
        `New Noida center appointment: ${name}, ${phone}, ${date} ${slot}`,
        leadNotificationEmail({ name, phone, email, age, concern: `Noida center ${type === "followup" ? "follow-up" : "visit"} — ${date} at ${slot}`, source: "Noida Center Booking" })
      );
    } catch (mailErr) {
      console.error("Noida appointment admin alert failed (non-fatal):", mailErr.message);
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

// ── Follow-up slot management (admin) ──────────────────────────────────
// Admin opens up specific date+slot combinations for follow-ups; clients
// on the Follow-up tab can only pick from what's been opened here.

export const getFollowupSlots = expressAsyncHandler(async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.date) filter.date = req.query.date;

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
  if (!isValidDateStr(date) || !Array.isArray(slots) || slots.length === 0) {
    res.status(400);
    return next(new Error("A date and at least one slot are required."));
  }

  try {
    const ops = slots.map((slot) => ({
      updateOne: {
        filter: { date, slot },
        update: { $setOnInsert: { date, slot } },
        upsert: true,
      },
    }));
    await NoidaFollowupSlot.bulkWrite(ops);
    const saved = await NoidaFollowupSlot.find({ date, slot: { $in: slots } }).sort({ slot: 1 }).lean();
    return res.status(201).json({ status: true, message: "Slots opened for follow-ups.", data: saved });
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
