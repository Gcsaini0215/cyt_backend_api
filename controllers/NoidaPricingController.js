import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import NoidaPricing from "../models/NoidaPricing.js";
import NoidaPackage from "../models/NoidaPackage.js";

const MAX_PACKAGES = 3;

export async function getOrCreatePricing() {
  let doc = await NoidaPricing.findOne({});
  if (!doc) doc = await NoidaPricing.create({});
  return doc;
}

// Public: the numbers the booking page needs to show/compute cost with.
export const getPublicPricing = expressAsyncHandler(async (req, res, next) => {
  try {
    const pricing = await getOrCreatePricing();
    const packages = await NoidaPackage.find({ active: true }).select("name sessionsCount price").sort({ price: 1 }).lean();
    return res.status(200).json({
      status: true,
      data: {
        individual_inperson: pricing.individual_inperson,
        individual_online: pricing.individual_online,
        individual_homevisit: pricing.individual_homevisit,
        couple_inperson: pricing.couple_inperson,
        couple_online: pricing.couple_online,
        couple_homevisit: pricing.couple_homevisit,
        platformFee: pricing.platformFee,
        packages,
      },
    });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Admin: view + edit the raw pricing doc.
export const getPricing = expressAsyncHandler(async (req, res, next) => {
  try {
    const pricing = await getOrCreatePricing();
    return res.status(200).json({ status: true, data: pricing });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

const PRICE_FIELDS = [
  "individual_inperson", "individual_online", "individual_homevisit",
  "couple_inperson", "couple_online", "couple_homevisit", "platformFee",
];

export const updatePricing = expressAsyncHandler(async (req, res, next) => {
  try {
    const update = {};
    for (const key of PRICE_FIELDS) {
      if (req.body[key] === undefined) continue;
      const n = Number(req.body[key]);
      if (!Number.isFinite(n) || n < 0) {
        res.status(400);
        return next(new Error(`${key} must be a non-negative number.`));
      }
      update[key] = n;
    }
    const pricing = await getOrCreatePricing();
    Object.assign(pricing, update);
    await pricing.save();
    return res.status(200).json({ status: true, message: "Pricing updated.", data: pricing });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const getPackages = expressAsyncHandler(async (req, res, next) => {
  try {
    const packages = await NoidaPackage.find({}).sort({ createdAt: 1 }).lean();
    return res.status(200).json({ status: true, data: packages });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const createPackage = expressAsyncHandler(async (req, res, next) => {
  const { name, sessionsCount, price } = req.body;
  if (!name?.trim() || !sessionsCount || !price) {
    res.status(400);
    return next(new Error("Name, number of sessions, and price are required."));
  }
  try {
    const count = await NoidaPackage.countDocuments({});
    if (count >= MAX_PACKAGES) {
      res.status(400);
      return next(new Error(`Only ${MAX_PACKAGES} packages allowed — edit or delete an existing one first.`));
    }
    const pkg = await NoidaPackage.create({
      name: name.trim(),
      sessionsCount: Number(sessionsCount),
      price: Number(price),
    });
    return res.status(201).json({ status: true, message: "Package created.", data: pkg });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const updatePackage = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid package ID."));
  }
  try {
    const update = {};
    if (req.body.name !== undefined) update.name = req.body.name.trim();
    if (req.body.sessionsCount !== undefined) update.sessionsCount = Number(req.body.sessionsCount);
    if (req.body.price !== undefined) update.price = Number(req.body.price);
    if (req.body.active !== undefined) update.active = !!req.body.active;

    const pkg = await NoidaPackage.findByIdAndUpdate(id, update, { new: true });
    if (!pkg) {
      res.status(404);
      return next(new Error("Package not found."));
    }
    return res.status(200).json({ status: true, message: "Package updated.", data: pkg });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const deletePackage = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid package ID."));
  }
  try {
    const pkg = await NoidaPackage.findByIdAndDelete(id);
    if (!pkg) {
      res.status(404);
      return next(new Error("Package not found."));
    }
    return res.status(200).json({ status: true, message: "Package deleted." });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});
