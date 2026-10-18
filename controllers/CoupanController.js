import expressAsyncHandler from "express-async-handler";
import Joi from "joi";
import crypto from "crypto";
import mongoose from "mongoose";
import Coupon from "../models/Coupan.js";
import { resolveReferral, applicantEmail, REFERRAL_AMOUNT } from "../helper/referral.js";
import { couponOwner, usedCounts, couponState, discountOf, findUsableCoupon } from "../helper/coupon.js";
import { couponsUnlocked } from "../helper/couponAddon.js";

// making or changing coupons needs the Coupons upgrade (CouponAddonController); 402 so the page can show the offer
const LOCKED = "Unlock Coupons (one-time upgrade) to create and manage coupons.";
const requireUnlocked = async (req, res) => {
  if (await couponsUnlocked(req.user._id)) return true;
  res.status(402).json({ status: false, locked: true, message: LOCKED });
  return false;
};

// Therapists create, edit, pause and delete their own coupons (saved under their user id). Clients see the
// ones marked "show on profile" in an offer pop-up on the profile and apply them on the booking page.
// A use = a PAID booking carrying the coupon (helper/coupon.js), so applying and walking away costs nothing.

const CODE_RE = /^[A-Z0-9]{3,15}$/;

const couponSchema = (isUpdate) => Joi.object({
  code: Joi.string().trim().uppercase().pattern(CODE_RE).required().messages({
    "string.pattern.base": "Coupon code: 3–15 letters or numbers, no spaces",
    "any.required": "Coupon code is required",
    "string.empty": "Coupon code is required",
  }),
  title: Joi.string().trim().max(60).allow("").default(""),
  discount_type: Joi.string().valid("percentage", "flat").required().messages({
    "any.only": "Discount type must be % off or ₹ off",
    "any.required": "Discount type is required",
  }),
  discount_value: Joi.number().positive().required()
    .when("discount_type", { is: "percentage", then: Joi.number().max(90) })
    .messages({
      "number.base": "Discount must be a number",
      "number.positive": "Discount must be more than 0",
      "number.max": "A % discount can be at most 90%",
      "any.required": "Discount is required",
    }),
  coupon_for: Joi.string().valid("Therapist", "Workshop").default("Therapist"),
  max_usage: Joi.number().integer().min(1).max(10000).default(1).messages({
    "number.base": "Number of uses must be a number",
    "number.min": "Number of uses must be at least 1",
  }),
  valid_from: Joi.date().default(() => new Date()),
  // an edit may keep an end date that has already passed (e.g. only to pause or rename it)
  valid_until: (isUpdate ? Joi.date() : Joi.date().greater("now")).required().messages({
    "date.base": "Please pick a valid end date",
    "date.greater": "The end date must be in the future",
    "any.required": "End date is required",
  }),
  show_on_profile: Joi.boolean().default(true),
  is_active: Joi.boolean(),
}).custom((v, h) => (v.valid_from && v.valid_until && new Date(v.valid_until) <= new Date(v.valid_from)
  ? h.message("The end date must be after the start date") : v));

const fail = (res, next, code, message) => { res.status(code); return next(new Error(message)); };

// the coupon must belong to the signed-in therapist
const ownCoupon = async (req) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return null;
  return Coupon.findOne({ _id: req.params.id, therapist: req.user._id });
};

const withUsage = async (list) => {
  const used = await usedCounts(list.map((c) => c._id));
  return list.map((c) => {
    const o = c.toObject ? c.toObject() : c;
    const n = used[String(o._id)] || 0;
    return { ...o, used_count: n, state: couponState(o, n) };
  });
};

// codes are unique across all therapists (unique index on code)
const codeTaken = (code, exceptId) => Coupon.exists({ code, ...(exceptId ? { _id: { $ne: exceptId } } : {}) });

export const CreateCoupan = expressAsyncHandler(async (req, res, next) => {
  if (!(await requireUnlocked(req, res))) return;
  const { error, value } = couponSchema(false).validate(req.body, { stripUnknown: true });
  if (error) return fail(res, next, 400, error.details[0].message);
  if (await codeTaken(value.code)) return fail(res, next, 400, "This code is already taken — try another or tap Generate.");
  const coupon = await Coupon.create({ ...value, is_active: value.is_active ?? true, therapist: req.user._id, used_count: 0 });
  const [data] = await withUsage([coupon]);
  res.status(201).json({ status: true, message: "Coupon created.", data });
});

export const GetCoupans = expressAsyncHandler(async (req, res) => {
  const list = await Coupon.find({ therapist: req.user._id }).sort({ createdAt: -1 }).lean();
  res.status(200).json({ status: true, message: "Coupons fetched successfully.", data: await withUsage(list) });
});

export const GetCoupan = expressAsyncHandler(async (req, res, next) => {
  const coupon = await ownCoupon(req);
  if (!coupon) return fail(res, next, 404, "Coupon not found.");
  const [data] = await withUsage([coupon]);
  res.status(200).json({ status: true, message: "Coupon fetched successfully.", data });
});

export const UpdateCoupan = expressAsyncHandler(async (req, res, next) => {
  if (!(await requireUnlocked(req, res))) return;
  const coupon = await ownCoupon(req);
  if (!coupon) return fail(res, next, 404, "Coupon not found.");
  const { error, value } = couponSchema(true).validate(req.body, { stripUnknown: true });
  if (error) return fail(res, next, 400, error.details[0].message);
  if (value.code !== coupon.code && (await codeTaken(value.code, coupon._id))) {
    return fail(res, next, 400, "This code is already taken — try another or tap Generate.");
  }
  Object.assign(coupon, value);
  await coupon.save();
  const [data] = await withUsage([coupon]);
  res.status(200).json({ status: true, message: "Coupon updated.", data });
});

export const ToggleSatus = expressAsyncHandler(async (req, res, next) => {
  if (!(await requireUnlocked(req, res))) return;
  const coupon = await ownCoupon(req);
  if (!coupon) return fail(res, next, 404, "Coupon not found.");
  coupon.is_active = !coupon.is_active;
  await coupon.save();
  const [data] = await withUsage([coupon]);
  res.status(200).json({ status: true, message: coupon.is_active ? "Coupon is live." : "Coupon paused.", data });
});

export const DeleteCoupon = expressAsyncHandler(async (req, res, next) => {
  const coupon = await ownCoupon(req);
  if (!coupon) return fail(res, next, 404, "Coupon not found.");
  await coupon.deleteOne();
  res.status(200).json({ status: true, message: "Coupon deleted.", data: { _id: coupon._id } });
});

// GET /coupon/suggest — a free code built from the therapist's first name, e.g. ASHA4K7
export const SuggestCoupon = expressAsyncHandler(async (req, res) => {
  const base = (String(req.user?.name || "").replace(/^(dr|mr|ms|mrs)\.?\s+/i, "").split(/\s+/)[0] || "CYT")
    .toUpperCase().replace(/[^A-Z]/g, "").slice(0, 8) || "CYT";
  const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L look-alikes
  for (let i = 0; i < 12; i++) {
    const tail = Array.from(crypto.randomBytes(3), (b) => ALPHA[b % ALPHA.length]).join("");
    const code = `${base}${tail}`;
    if (!(await codeTaken(code))) return res.status(200).json({ status: true, data: { code } });
  }
  res.status(200).json({ status: true, data: { code: `CYT${crypto.randomBytes(4).toString("hex").toUpperCase()}` } });
});

// GET /coupon/public/:therapistId — the offers a client can use right now (profile pop-up, booking page)
export const PublicCoupons = expressAsyncHandler(async (req, res) => {
  const { ids: owners, userId } = await couponOwner(req.params.therapistId);
  if (!owners.length || !(await couponsUnlocked(userId))) return res.status(200).json({ status: true, data: [] });
  const now = new Date();
  const list = await Coupon.find({
    therapist: { $in: owners }, coupon_for: "Therapist", is_active: true, show_on_profile: { $ne: false },
    valid_from: { $lte: now }, valid_until: { $gt: now },
  }).select("code title discount_type discount_value max_usage valid_until valid_from is_active").sort({ createdAt: -1 }).lean(); // newest first — % and ₹ values can't be ranked against each other
  const used = await usedCounts(list.map((c) => c._id));
  const data = list
    .map((c) => ({ c, n: used[String(c._id)] || 0 }))
    .filter(({ c, n }) => couponState(c, n, now) === "active")
    .map(({ c, n }) => {
      const left = (c.max_usage || 1) - n;
      return {
        _id: c._id, code: c.code, title: c.title || "", discount_type: c.discount_type,
        discount_value: c.discount_value, valid_until: c.valid_until, ...(left <= 10 ? { left } : {}),
      };
    });
  res.set("Cache-Control", "no-store").status(200).json({ status: true, data });
});

export const ApplyCoupon = expressAsyncHandler(async (req, res) => {
  // the booking page sends { coupon_code, amount }, older checkouts { code } — accept both
  const { therapist_id } = req.body;
  const apply_for = req.body.apply_for || "Therapist";
  const code = String(req.body.code || req.body.coupon_code || "").trim().toUpperCase();
  const amount = Math.max(0, Number(req.body.amount) || 0);

  if (!therapist_id || !code) {
    return res.status(400).json({ status: false, message: "Therapist ID and Coupon code are required" });
  }

  const found = await findUsableCoupon(therapist_id, code, apply_for);

  // not one of the therapist's coupons → a friend's referral code works on any therapist's session
  if (found.error === "Invalid coupon code" && apply_for === "Therapist") {
    const ref = await resolveReferral({ code, email: await applicantEmail(req) });
    if (ref?.error) return res.status(400).json({ status: false, message: ref.error });
    if (ref) {
      return res.status(200).json({
        status: true,
        message: `Referral applied — ₹${REFERRAL_AMOUNT} off your first session`,
        data: { code, referral: true, discount_type: "flat", discount_value: REFERRAL_AMOUNT, discount: discountOf("flat", REFERRAL_AMOUNT, amount) },
      });
    }
  }
  if (found.error) return res.status(400).json({ status: false, message: found.error });

  const { coupon } = found;
  return res.status(200).json({
    status: true,
    message: "Coupon applied successfully",
    data: {
      _id: coupon._id,
      code: coupon.code,
      title: coupon.title || "",
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      discount: discountOf(coupon.discount_type, coupon.discount_value, amount),
    },
  });
});
