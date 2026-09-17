import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import NoidaAppointment from "../models/NoidaAppointment.js";
import { sendMail } from "../helper/mailer.js";
import { leadNotificationEmail, noidaAppointmentConfirmationEmail } from "../services/mailTemplates.js";

// Center hours: Mon–Sat, 10:00 AM – 7:00 PM, 45-min slots. Closed Sunday.
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

// All slot labels for a given date, ignoring bookings — "" (empty array) if the center is closed that day.
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

export const getAvailableSlots = expressAsyncHandler(async (req, res, next) => {
  const { date } = req.query;
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

  let slots = allSlotsForDate(date);

  // Same-day: drop slots starting within the notice window.
  if (date === today) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes() + MIN_NOTICE_MINUTES;
    slots = slots.filter((label) => {
      const startLabel = label.split(" - ")[0];
      const [time, ampm] = startLabel.split(" ");
      let [h, m] = time.split(":").map(Number);
      if (ampm === "PM" && h !== 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      return h * 60 + m >= nowMinutes;
    });
  }

  if (slots.length > 0) {
    const booked = await NoidaAppointment.find({ date, status: "confirmed" }).select("slot").lean();
    const bookedSet = new Set(booked.map((b) => b.slot));
    slots = slots.filter((s) => !bookedSet.has(s));
  }

  return res.status(200).json({ status: true, data: slots });
});

export const createNoidaAppointment = expressAsyncHandler(async (req, res, next) => {
  const { name, phone, email, concern, date, slot } = req.body;

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
  if (!allSlotsForDate(date).includes(slot)) {
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
      phone: phone.trim(),
      email: email?.trim() || "",
      concern: concern?.trim() || "",
      date,
      slot,
    });

    try {
      await sendMail(
        "chooseyourtherapist@gmail.com",
        `Noida Center Booking: ${name} — ${date} ${slot}`,
        `New Noida center appointment: ${name}, ${phone}, ${date} ${slot}`,
        leadNotificationEmail({ name, phone, email, concern: `Noida center visit — ${date} at ${slot}`, source: "Noida Center Booking" })
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
