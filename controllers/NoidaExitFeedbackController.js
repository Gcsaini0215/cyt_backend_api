import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Joi from "joi";
import NoidaExitFeedback, { EXIT_REASONS } from "../models/NoidaExitFeedback.js";

const createSchema = Joi.object({
  reason: Joi.string().valid(...EXIT_REASONS).required(),
  otherText: Joi.string().trim().max(300).allow(""),
  phone: Joi.string().pattern(/^[0-9]{10}$/).allow(""),
  wantsCallback: Joi.boolean(),
  stage: Joi.string().valid("browsing", "form", "payment"),
  bookingType: Joi.string().valid("new", "followup", "reschedule"),
  trigger: Joi.string().valid("back_button", "browser_back", "exit_intent"),
  device: Joi.string().valid("mobile", "tablet", "desktop"),
  slotDate: Joi.string().max(20).allow(""),
  slotTime: Joi.string().max(40).allow(""),
}).options({ stripUnknown: true });

/* POST /api/noida-appointments/exit-feedback — public, from the booking page's exit popup */
export const createExitFeedback = expressAsyncHandler(async (req, res) => {
  const { error, value } = createSchema.validate(req.body || {});
  if (error) return res.status(400).json({ status: false, message: error.details[0].message });

  const phone = value.phone || "";
  await NoidaExitFeedback.create({
    ...value,
    otherText: value.reason === "other" ? (value.otherText || "") : "",
    phone,
    wantsCallback: !!phone && value.wantsCallback !== false, // a number is only given to ask for a callback
  });
  res.json({ status: true });
});

/* GET /api/noida-exit-feedback?status=&callback=1&page=&limit= — admin list + reason counts */
export const getExitFeedback = expressAsyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const filter = {};
  if (["new", "contacted", "closed"].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.callback === "1") filter.wantsCallback = true;
  if (EXIT_REASONS.includes(req.query.reason)) filter.reason = req.query.reason;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [items, total, byReason, pendingCallbacks] = await Promise.all([
    NoidaExitFeedback.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("handledBy", "name").lean(),
    NoidaExitFeedback.countDocuments(filter),
    NoidaExitFeedback.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$reason", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    NoidaExitFeedback.countDocuments({ wantsCallback: true, status: "new" }),
  ]);

  res.json({
    status: true,
    data: {
      items,
      total,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
      last30Days: byReason.map((r) => ({ reason: r._id, count: r.count })),
      pendingCallbacks,
    },
  });
});

/* PATCH /api/noida-exit-feedback/:id — admin: { status?, note? } */
export const updateExitFeedback = expressAsyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid id" });
  const { status, note } = req.body || {};
  const update = {};
  if (status !== undefined) {
    if (!["new", "contacted", "closed"].includes(status)) return res.status(400).json({ status: false, message: "Invalid status" });
    update.status = status;
    update.handledBy = status === "new" ? null : req.user?._id || null;
    update.handledAt = status === "new" ? null : new Date();
  }
  if (note !== undefined) update.note = String(note).slice(0, 500);

  const doc = await NoidaExitFeedback.findByIdAndUpdate(req.params.id, update, { new: true }).populate("handledBy", "name");
  if (!doc) return res.status(404).json({ status: false, message: "Not found" });
  res.json({ status: true, data: doc });
});

/* DELETE /api/noida-exit-feedback/:id — admin */
export const deleteExitFeedback = expressAsyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid id" });
  await NoidaExitFeedback.findByIdAndDelete(req.params.id);
  res.json({ status: true });
});
