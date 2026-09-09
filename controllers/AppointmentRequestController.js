import AppointmentRequest from "../models/AppointmentRequest.js";
import { sendMail } from "../helper/mailer.js";
import { appointmentStatusMail } from "../services/mailTemplates.js";

export const createAppointmentRequest = async (req, res) => {
  try {
    const { name, phone, email, concern, preferredTime, message, therapistId, therapistName } = req.body;
    if (!name || !phone) return res.status(400).json({ success: false, message: "Name and phone are required." });
    const doc = await AppointmentRequest.create({ name, phone, email: email || "", concern, preferredTime, message, therapistId: therapistId || "", therapistName: therapistName || "" });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getAppointmentRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const docs = await AppointmentRequest.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: docs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteAppointmentRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await AppointmentRequest.findByIdAndDelete(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    res.json({ success: true, message: "Deleted." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateAppointmentRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, confirmedTime, adminNote } = req.body;
    const doc = await AppointmentRequest.findByIdAndUpdate(
      id,
      { status, confirmedTime, adminNote },
      { new: true, lean: true }
    );
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });

    if (doc.email && (status === "confirmed" || status === "rescheduled")) {
      const firstName = doc.name.split(" ")[0];
      const isConfirmed = status === "confirmed";
      const subject = isConfirmed
        ? `Your appointment is confirmed — ${confirmedTime || "details below"}`
        : `Your appointment has been rescheduled — ${confirmedTime || "details below"}`;

      const html = appointmentStatusMail({
        firstName,
        isConfirmed,
        confirmedTime,
        concern: doc.concern,
        phone: doc.phone,
        adminNote,
      });

      const text = `Hi ${firstName},\n\n${isConfirmed ? "Your appointment is confirmed" : "Your appointment has been rescheduled"}.\n\n${confirmedTime ? `Time: ${confirmedTime}\n` : ""}${doc.concern ? `Concern: ${doc.concern}\n` : ""}${adminNote ? `\nNote: ${adminNote}\n` : ""}\nFor any changes, WhatsApp us at +91-8077757951.\n\nWarm regards,\nChoose Your Therapist Team`;

      sendMail(doc.email, subject, text, html).catch(() => {});
    }

    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
