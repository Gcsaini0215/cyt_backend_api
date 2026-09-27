import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import NoidaCoupon from "../models/NoidaCoupon.js";
import NoidaAppointment from "../models/NoidaAppointment.js";
import { computeBookingAmount } from "./NoidaAppointmentController.js";
import { resolveCoupon, normalizeCouponCode, offerWindowText, calcDiscount } from "../helper/noidaCoupon.js";
import NoidaCouponClaim from "../models/NoidaCouponClaim.js";
import Lead from "../models/Lead.js";
import crypto from "crypto";
import { sendMail } from "../helper/mailer.js";
import { noidaOfferCodeMail } from "../services/mailTemplates.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Public + reception: "does this code work on what I'm about to buy?"
export const validateCoupon = expressAsyncHandler(async (req, res, next) => {
  const { code, phone, sessionMode, format, packageId, customSessions, date, slot } = req.body;
  try {
    const { baseAmount, platformFee } = await computeBookingAmount({ sessionMode, format, packageId, customSessions });
    const { coupon, discountAmount, appliedCode } = await resolveCoupon({ code, phone, baseAmount, isPackage: sessionMode === "package", date, slot });
    return res.status(200).json({
      status: true,
      data: {
        code: appliedCode,
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
  if (has("days")) {
    const days = Array.isArray(body.days) ? [...new Set(body.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
    out.days = days.sort((a, b) => a - b);
  }
  for (const k of ["timeFrom", "timeTo"]) {
    if (has(k)) {
      const v = String(body[k] || "");
      if (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) bad("Times must look like 14:00.");
      out[k] = v;
    }
  }
  const tf = out.timeFrom ?? body.timeFrom, tt = out.timeTo ?? body.timeTo;
  if (tf && tt && tt <= tf) bad("The end time must be after the start time.");
  if (has("isPublic")) out.isPublic = !!body.isPublic;
  if (has("claimOnly")) out.claimOnly = !!body.claimOnly;
  if (has("publicTitle")) out.publicTitle = String(body.publicTitle || "").replace(/<[^>]*>/g, "").trim().slice(0, 80);
  if (has("active")) out.active = !!body.active;
  if (has("note")) out.note = String(body.note || "").trim().slice(0, 200);
  return out;
}

export const getCoupons = expressAsyncHandler(async (req, res, next) => {
  try {
    const [coupons, usage, claims] = await Promise.all([
      NoidaCoupon.find({}).sort({ createdAt: -1 }).lean(),
      NoidaAppointment.aggregate([
        { $match: { couponCode: { $ne: "" }, status: "confirmed" } },
        { $group: { _id: "$couponCode", used: { $sum: 1 }, saved: { $sum: "$discountAmount" } } },
      ]),
      NoidaCouponClaim.find({}, "coupon code").lean(),
    ]);
    // personal claimed codes count towards their parent offer
    const parentOf = new Map(claims.map((c) => [c.code, String(c.coupon)]));
    const idByCode = new Map(coupons.map((c) => [c.code, String(c._id)]));
    const stats = new Map();
    usage.forEach((u) => {
      const id = parentOf.get(u._id) || idByCode.get(u._id);
      if (!id) return;
      const s = stats.get(id) || { used: 0, saved: 0, claimedUsed: 0 };
      s.used += u.used; s.saved += u.saved;
      if (parentOf.has(u._id)) s.claimedUsed += u.used;
      stats.set(id, s);
    });
    const claimCount = new Map();
    claims.forEach((c) => claimCount.set(String(c.coupon), (claimCount.get(String(c.coupon)) || 0) + 1));
    return res.status(200).json({
      status: true,
      data: coupons.map((c) => {
        const s = stats.get(String(c._id)) || {};
        return { ...c, used: s.used || 0, totalSaved: s.saved || 0, claims: claimCount.get(String(c._id)) || 0, claimsBooked: s.claimedUsed || 0, windowText: offerWindowText(c) };
      }),
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

/* ── Public offers on the booking page ─────────────────────────────────── */

function istToday() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const offerLabel = (c) => (c.discountType === "percent" ? `${c.discountValue}% off` : `₹${c.discountValue} off`);
const liveOfferFilter = () => {
  const today = istToday();
  return {
    active: true,
    isPublic: true,
    $and: [
      { $or: [{ validFrom: "" }, { validFrom: { $lte: today } }] },
      { $or: [{ validUntil: "" }, { validUntil: { $gte: today } }] },
    ],
  };
};
const publicOffer = (c) => ({
  id: c._id,
  title: c.publicTitle || `${offerLabel(c)} on ${c.appliesTo === "package" ? "packages" : c.appliesTo === "session" ? "sessions" : "bookings"}`,
  discount: offerLabel(c),
  appliesTo: c.appliesTo,
  days: c.days || [],
  timeFrom: c.timeFrom || "",
  timeTo: c.timeTo || "",
  window: offerWindowText(c),
  minAmount: c.minAmount || 0,
  maxDiscount: c.maxDiscount || 0,
  validUntil: c.validUntil || "",
});

// GET /noida-appointments/offers — public, no codes
export const getPublicOffers = expressAsyncHandler(async (req, res) => {
  const list = await NoidaCoupon.find(liveOfferFilter()).sort({ createdAt: -1 }).limit(5).lean();
  res.json({ status: true, data: list.map(publicOffer) });
});

const makeCode = (base) => `${normalizeCouponCode(base).slice(0, 10)}-${crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 5)}`;

// POST /noida-appointments/offers/:id/claim — { name, phone, email, consent }
export const claimOffer = expressAsyncHandler(async (req, res) => {
  const name = String(req.body?.name || "").replace(/<[^>]*>/g, "").trim().slice(0, 60);
  const phone = String(req.body?.phone || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 120);
  if (name.length < 2) return res.status(400).json({ status: false, message: "Please enter your name." });
  if (!/^\d{10}$/.test(phone)) return res.status(400).json({ status: false, message: "Please enter a valid 10-digit phone number." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ status: false, message: "Please enter a valid email address." });
  if (!req.body?.consent) return res.status(400).json({ status: false, message: "Please agree to receive the code and offers." });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ status: false, message: "This offer has ended." });

  const coupon = await NoidaCoupon.findOne({ _id: req.params.id, ...liveOfferFilter() });
  if (!coupon) return res.status(404).json({ status: false, message: "This offer has ended." });

  // one personal code per phone per offer — a repeat claim just gets the same code again
  let claim = await NoidaCouponClaim.findOne({ coupon: coupon._id, phone });
  const isNew = !claim;
  if (!claim) {
    for (let i = 0; i < 5 && !claim; i++) {
      try {
        claim = await NoidaCouponClaim.create({ coupon: coupon._id, code: makeCode(coupon.code), name, phone, email, ip: req.ip || "" });
      } catch (e) { if (e?.code !== 11000) throw e; }
    }
    if (!claim) return res.status(500).json({ status: false, message: "Could not create your code. Please try again." });
  }

  const offer = publicOffer(coupon);
  const sent = await sendMail(
    email,
    `Your ${offer.discount} code for Choose Your Therapist Noida`,
    `Your code: ${claim.code} — ${offer.title}. Book at https://www.chooseyourtherapist.in/noida-appointment`,
    noidaOfferCodeMail({ name, code: claim.code, offer }),
  ).catch(() => false);
  if (sent && !claim.emailed) { claim.emailed = true; await claim.save(); }

  if (isNew) {
    Lead.create({
      name, phone, email,
      concern: `Claimed offer: ${offer.title}`,
      source: "Noida Offer",
      location: "Noida",
      message: `Code ${claim.code} · ${offer.discount}${offer.window ? ` · ${offer.window}` : ""}`,
      data: { offerId: String(coupon._id), code: claim.code },
    }).catch(() => {});
  }

  res.json({ status: true, data: { code: claim.code, emailed: !!sent, offer } });
});

// GET /noida-coupons/:id/claims — admin: who claimed an offer and whether they booked
export const getOfferClaims = expressAsyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid coupon ID." });
  const claims = await NoidaCouponClaim.find({ coupon: req.params.id }).sort({ createdAt: -1 }).limit(500).lean();
  const booked = new Set(await NoidaAppointment.distinct("couponCode", { couponCode: { $in: claims.map((c) => c.code) }, status: "confirmed" }));
  res.json({ status: true, data: claims.map((c) => ({ ...c, booked: booked.has(c.code) })) });
});
