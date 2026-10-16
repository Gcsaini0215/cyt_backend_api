import expressAsyncHandler from "express-async-handler";
import Jwt from "jsonwebtoken";
import mongoose from "mongoose";
import ClientNotification from "../models/ClientNotification.js";
import { addClientStream, toClientRow, emitClientRead } from "../services/clientNotify.js";

// GET /client-notifications?limit= — newest first, plus the unread count
export const listClientNotifications = expressAsyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
  const [rows, unread] = await Promise.all([
    ClientNotification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(limit).lean(),
    ClientNotification.countDocuments({ user: req.user._id, read_at: null }),
  ]);
  res.json({ status: true, data: { items: rows.map(toClientRow), unread } });
});

// POST /client-notifications/read { ids?: [] } — no ids = mark everything read
export const readClientNotifications = expressAsyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => mongoose.Types.ObjectId.isValid(x)) : null;
  const q = { user: req.user._id, read_at: null };
  if (ids) q._id = { $in: ids };
  await ClientNotification.updateMany(q, { $set: { read_at: new Date() } });
  emitClientRead(req.user._id, ids);
  const unread = await ClientNotification.countDocuments({ user: req.user._id, read_at: null });
  res.json({ status: true, data: { unread } });
});

// GET /client-notifications/stream?token= — live notifications + "bookings changed" (SSE)
export const clientNotificationStream = (req, res) => {
  let decoded;
  try { decoded = Jwt.verify(String(req.query.token || ""), process.env.JWT_SECRET, { algorithms: ["HS256"] }); }
  catch { return res.status(401).json({ status: false, message: "Not authorized" }); }
  if (decoded.role !== 0 || !decoded.userId) return res.status(403).json({ status: false, message: "Clients only" });
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write("retry: 3000\n\n");
  res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  const remove = addClientStream(res, decoded.userId);
  req.on("close", remove);
};
