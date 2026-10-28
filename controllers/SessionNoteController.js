import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import SessionNote from "../models/SessionNote.js";
import Booking from "../models/Booking.js";

/* My Space: the client's private notes for a session — only they can read or change them. */
const ok = (id) => mongoose.Types.ObjectId.isValid(id);

// GET /my-session-notes/:bookingId → { text, updatedAt }
export const getMyNote = expressAsyncHandler(async (req, res) => {
  if (!ok(req.params.bookingId)) return res.status(400).json({ status: false, message: "Invalid session." });
  const n = await SessionNote.findOne({ user: req.user._id, booking: req.params.bookingId }).select("text updatedAt").lean();
  res.json({ status: true, data: { text: n?.text || "", updatedAt: n?.updatedAt || null } });
});

// PUT /my-session-notes/:bookingId { text } — only for the client's own booking; empty text deletes it
export const saveMyNote = expressAsyncHandler(async (req, res) => {
  const id = req.params.bookingId;
  if (!ok(id)) return res.status(400).json({ status: false, message: "Invalid session." });
  if (!(await Booking.exists({ _id: id, client: req.user._id }))) return res.status(404).json({ status: false, message: "Session not found." });
  const text = String(req.body?.text ?? "").slice(0, 2000);
  if (!text.trim()) {
    await SessionNote.deleteOne({ user: req.user._id, booking: id });
    return res.json({ status: true, data: { text: "", updatedAt: null } });
  }
  const n = await SessionNote.findOneAndUpdate({ user: req.user._id, booking: id }, { $set: { text } }, { upsert: true, new: true }).lean();
  res.json({ status: true, data: { text: n.text, updatedAt: n.updatedAt } });
});
