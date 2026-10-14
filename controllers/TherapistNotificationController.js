import expressAsyncHandler from "express-async-handler";
import Jwt from "jsonwebtoken";
import mongoose from "mongoose";
import TherapistNotification from "../models/TherapistNotification.js";
import { addTherapistClient, toClient, emitRead } from "../services/therapistNotify.js";

// GET /therapist-notifications?limit= — newest first, plus the unread count
export const listNotifications = expressAsyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
  const [rows, unread] = await Promise.all([
    TherapistNotification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(limit).lean(),
    TherapistNotification.countDocuments({ user: req.user._id, read_at: null }),
  ]);
  res.json({ status: true, data: { items: rows.map(toClient), unread } });
});

// POST /therapist-notifications/read { ids?: [] } — no ids = mark everything read
export const readNotifications = expressAsyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => mongoose.Types.ObjectId.isValid(x)) : null;
  const q = { user: req.user._id, read_at: null };
  if (ids) q._id = { $in: ids };
  await TherapistNotification.updateMany(q, { $set: { read_at: new Date() } });
  emitRead(req.user._id, ids);
  const unread = await TherapistNotification.countDocuments({ user: req.user._id, read_at: null });
  res.json({ status: true, data: { unread } });
});

// GET /therapist-notifications/stream?token= — live notifications (SSE; browsers can't set headers on it)
export const notificationStream = (req, res) => {
  let decoded;
  try { decoded = Jwt.verify(String(req.query.token || ""), process.env.JWT_SECRET, { algorithms: ["HS256"] }); }
  catch { return res.status(401).json({ status: false, message: "Not authorized" }); }
  if (decoded.role !== 1 || !decoded.userId) return res.status(403).json({ status: false, message: "Therapists only" });
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // nginx: pass events through immediately
  });
  res.flushHeaders?.();
  res.write("retry: 3000\n\n");
  res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  const remove = addTherapistClient(res, decoded.userId);
  req.on("close", remove);
};
