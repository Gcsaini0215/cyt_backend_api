import AppointmentRequest from "../models/AppointmentRequest.js";

export const createAppointmentRequest = async (req, res) => {
  try {
    const { name, phone, concern, preferredTime, message } = req.body;
    if (!name || !phone) return res.status(400).json({ success: false, message: "Name and phone are required." });
    const doc = await AppointmentRequest.create({ name, phone, concern, preferredTime, message });
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
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
