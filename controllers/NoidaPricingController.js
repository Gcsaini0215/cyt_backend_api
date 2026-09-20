import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import NoidaPricing from "../models/NoidaPricing.js";
import NoidaPackage from "../models/NoidaPackage.js";
import Admin from "../models/Admin.js";
import Therapists from "../models/Therapists.js";
import { getOfferedTherapists, getTherapistOptions, LIVE_THERAPIST_FILTER } from "../helper/noidaTherapist.js";

const MAX_PACKAGES = 10;

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
        customPackage: pricing.customPackage?.enabled && pricing.customPackage.perSessionPrice > 0
          ? {
              enabled: true,
              perSessionPrice: pricing.customPackage.perSessionPrice,
              minSessions: pricing.customPackage.minSessions,
              maxSessions: pricing.customPackage.maxSessions,
            }
          : { enabled: false },
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
    await pricing.populate("defaultAssignee", "name email");
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
    if (req.body.customPackage !== undefined) {
      const c = req.body.customPackage || {};
      const perSessionPrice = Number(c.perSessionPrice);
      const minSessions = Math.floor(Number(c.minSessions));
      const maxSessions = Math.floor(Number(c.maxSessions));
      if (![perSessionPrice, minSessions, maxSessions].every(Number.isFinite) || perSessionPrice < 0) {
        res.status(400);
        return next(new Error("Custom package needs a price per session and a minimum and maximum number of sessions."));
      }
      if (minSessions < 1 || maxSessions < minSessions || maxSessions > 60) {
        res.status(400);
        return next(new Error("Sessions must be between 1 and 60, and the maximum can't be below the minimum."));
      }
      if (c.enabled && perSessionPrice <= 0) {
        res.status(400);
        return next(new Error("Set a price per session before turning the custom package on."));
      }
      update.customPackage = { enabled: !!c.enabled, perSessionPrice, minSessions, maxSessions };
    }
    if (req.body.defaultAssignee !== undefined) {
      const adminId = req.body.defaultAssignee;
      if (adminId) {
        if (!mongoose.Types.ObjectId.isValid(adminId)) {
          res.status(400);
          return next(new Error("Invalid team member ID."));
        }
        const exists = await Admin.exists({ _id: adminId });
        if (!exists) {
          res.status(404);
          return next(new Error("Team member not found."));
        }
      }
      update.defaultAssignee = adminId || null;
    }
    const pricing = await getOrCreatePricing();
    Object.assign(pricing, update);
    await pricing.save();
    await pricing.populate("defaultAssignee", "name email");
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


// Public: the therapists a client can ask for at CYT Noida.
export const getPublicNoidaTherapists = expressAsyncHandler(async (req, res, next) => {
  try {
    return res.status(200).json({ status: true, data: await getOfferedTherapists() });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Admin: who could be offered (live therapists) and who currently is.
export const getNoidaTherapistOptions = expressAsyncHandler(async (req, res, next) => {
  try {
    return res.status(200).json({ status: true, data: await getTherapistOptions() });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

const MAX_OFFERED_THERAPISTS = 12;

export const updateNoidaTherapists = expressAsyncHandler(async (req, res, next) => {
  try {
    const raw = Array.isArray(req.body.therapistIds) ? req.body.therapistIds : null;
    if (!raw) {
      res.status(400);
      return next(new Error("therapistIds must be a list."));
    }
    const ids = [...new Set(raw.map(String))];
    if (ids.length > MAX_OFFERED_THERAPISTS) {
      res.status(400);
      return next(new Error(`You can offer up to ${MAX_OFFERED_THERAPISTS} therapists.`));
    }
    if (!ids.every((id) => mongoose.Types.ObjectId.isValid(id))) {
      res.status(400);
      return next(new Error("One of the therapists is invalid."));
    }
    const pricing = await getOrCreatePricing();
    const already = new Set((pricing.therapists || []).map(String));
    // Someone already on the list may have gone off-air — they can stay or be removed,
    // but a new addition has to be live right now.
    const additions = ids.filter((id) => !already.has(id));
    if (additions.length) {
      const liveCount = await Therapists.countDocuments({ _id: { $in: additions }, ...LIVE_THERAPIST_FILTER });
      if (liveCount !== additions.length) {
        res.status(400);
        return next(new Error("Only therapists who are live on the website can be offered."));
      }
    }
    pricing.therapists = ids;
    await pricing.save();
    return res.status(200).json({ status: true, message: "Therapists saved.", data: await getTherapistOptions() });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});
