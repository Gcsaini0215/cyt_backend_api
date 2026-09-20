import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import NoidaCoupon from "../models/NoidaCoupon.js";
import NoidaAppointment from "../models/NoidaAppointment.js";
import { computeBookingAmount } from "./NoidaAppointmentController.js";
import { resolveCoupon, normalizeCouponCode } from "../helper/noidaCoupon.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Public + reception: "does this code work on what I'm about to buy?"
export const validateCoupon = expressAsyncHandler(async (req, res, next) => {
  const { code, phone, sessionMode, format, packageId, customSessions } = req.body;
  try {
    const { baseAmount, platformFee } = await computeBookingAmount({ sessionMode, format, packageId, customSessions });
    const { coupon, discountAmount } = await resolveCoupon({ code, phone, baseAmount, isPackage: sessionMode === "package" });
    return res.status(200).json({
      status: true,
      data: {
        code: coupon.code,
        discountAmount,
        baseAmount,
        platformFee,
        total: baseAmount - discountAmount + platformFee,
        description: coupon.discountType === "percent" ? `${coupon.discountValue}% off` : `₹${coupon.discountValue} off`,
      },
    });
  } catch (err) {
    res.status(err.status || 400);
    return next(new Error(err.message || "Could not check that coupon."));
  }
});

function readBody(body, { partial }) {
  const out = {};
  const bad = (m) => { const e = new Error(m); e.status = 400; throw e; };
  const has = (k) => body[k] !== undefined;

  if (!partial || has("discountType")) {
    if (!["percent", "flat"].includes(body.discountType)) bad("Choose percent or flat rupees.");
    out.discountType = body.discountType;
  }
  if (!partial || has("discountValue")) {
    const v = Number(body.discountValue);
    if (!Number.isFinite(v) || v < 1) bad("The discount must be at least 1.");
    out.discountValue = Math.floor(v);
  }
  const type = out.discountType || body.discountType;
  if (out.discountValue !== undefined && type === "percent" && out.discountValue > 100) bad("A percentage discount can't be more than 100%.");

  if (!partial || has("appliesTo")) {
    if (!["all", "session", "package"].includes(body.appliesTo)) bad("Choose what the coupon applies to.");
    out.appliesTo = body.appliesTo;
  }
  for (const k of ["maxDiscount", "minAmount", "usageLimit", "perPhoneLimit"]) {
    if (has(k)) {
      const v = Number(body[k]);
      if (!Number.isFinite(v) || v < 0) bad(`${k} must be zero or more.`);
      out[k] = Math.floor(v);
    }
  }
  for (const k of ["validFrom", "validUntil"]) {
    if (has(k)) {
      const v = String(body[k] || "");
      if (v && !DATE_RE.test(v)) bad("Dates must look like 2026-10-31.");
      out[k] = v;
    }
  }
  if (out.validFrom && out.validUntil && out.validUntil < out.validFrom) bad("The end date is before the start date.");
  if (has("active")) out.active = !!body.active;
  if (has("note")) out.note = String(body.note || "").trim().slice(0, 200);
  return out;
}

export const getCoupons = expressAsyncHandler(async (req, res, next) => {
  try {
    const [coupons, usage] = await Promise.all([
      NoidaCoupon.find({}).sort({ createdAt: -1 }).lean(),
      NoidaAppointment.aggregate([
        { $match: { couponCode: { $ne: "" }, status: "confirmed" } },
        { $group: { _id: "$couponCode", used: { $sum: 1 }, saved: { $sum: "$discountAmount" } } },
      ]),
    ]);
    const byCode = new Map(usage.map((u) => [u._id, u]));
    return res.status(200).json({
      status: true,
      data: coupons.map((c) => ({ ...c, used: byCode.get(c.code)?.used || 0, totalSaved: byCode.get(c.code)?.saved || 0 })),
    });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const createCoupon = expressAsyncHandler(async (req, res, next) => {
  try {
    const code = normalizeCouponCode(req.body.code);
    if (code.length < 3) {
      res.status(400);
      return next(new Error("The code needs at least 3 letters or numbers."));
    }
    const data = readBody(req.body, { partial: false });
    if (await NoidaCoupon.exists({ code })) {
      res.status(400);
      return next(new Error("A coupon with that code already exists."));
    }
    const coupon = await NoidaCoupon.create({ ...data, code });
    return res.status(201).json({ status: true, message: "Coupon created.", data: coupon });
  } catch (err) {
    res.status(err.status || 500);
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const updateCoupon = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid coupon ID."));
  }
  try {
    const data = readBody(req.body, { partial: true });
    const coupon = await NoidaCoupon.findByIdAndUpdate(id, data, { new: true, runValidators: true });
    if (!coupon) {
      res.status(404);
      return next(new Error("Coupon not found."));
    }
    return res.status(200).json({ status: true, message: "Coupon updated.", data: coupon });
  } catch (err) {
    res.status(err.status || 500);
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const deleteCoupon = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid coupon ID."));
  }
  try {
    const coupon = await NoidaCoupon.findById(id);
    if (!coupon) {
      res.status(404);
      return next(new Error("Coupon not found."));
    }
    if (await NoidaAppointment.exists({ couponCode: coupon.code })) {
      res.status(400);
      return next(new Error("This coupon has already been used on bookings — switch it off instead of deleting it."));
    }
    await coupon.deleteOne();
    return res.status(200).json({ status: true, message: "Coupon deleted." });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});
