import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import NoidaClientCredit from "../models/NoidaClientCredit.js";
import ReceptionClient from "../models/ReceptionClient.js";
import { ensureClientCode, ensureBackfilled, clientCodesFor, phoneTailRegex, samePhone } from "../helper/noidaClient.js";

// Shared helper — the one active credit record for a phone with sessions left, or null.
// Used by both the public booking flow (to skip payment) and the public lookup (to tell
// the client they have sessions left). Checks Noida's own credit records first (bought
// online, or set up by admin) — if none, falls back to a walk-in "Reception" client's
// package (a separate, in-clinic booking system) that still has sessions remaining, so a
// client who paid for an offline package can also use it for a Noida follow-up booking.
// Either source comes back in the same shape; `source` tells finalizeNoidaBooking which
// collection to atomically deduct the session from.
export async function getActiveCredit(phone) {
  const credits = await NoidaClientCredit.find({ phone, active: true }).sort({ createdAt: 1 }).lean();
  const noidaCredit = credits.find((c) => c.sessionsUsed < c.totalSessions);
  if (noidaCredit) return { ...noidaCredit, source: "noida-credit" };

  // Newest first — a client re-registered after finishing an earlier package should be
  // matched on their current one, not a stale, fully-used record from an older visit.
  const receptionClients = await ReceptionClient.find({ phone: { $regex: phoneTailRegex(phone) } })
    .sort({ createdAt: -1 }).select("id name phone package createdAt").lean();
  const receptionMatch = receptionClients.find((c) => {
    if (!samePhone(c.phone, phone)) return false;
    const pkg = c.package;
    return pkg && Number(pkg.total) > 0 && Number(pkg.used || 0) < Number(pkg.total);
  });
  if (receptionMatch) {
    return {
      _id: receptionMatch.id,
      phone: receptionMatch.phone,
      name: receptionMatch.name,
      packageName: receptionMatch.package.label || receptionMatch.package.plan || "Package",
      totalSessions: Number(receptionMatch.package.total),
      sessionsUsed: Number(receptionMatch.package.used || 0),
      source: "reception",
    };
  }

  return null;
}

export const getClientCredits = expressAsyncHandler(async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.phone) filter.phone = req.query.phone.trim();
    await ensureBackfilled();
    const credits = await NoidaClientCredit.find(filter).sort({ createdAt: -1 }).lean();
    const codes = await clientCodesFor(credits.map((c) => c.phone));
    return res.status(200).json({ status: true, data: credits.map((c) => ({ ...c, clientCode: codes.get(String(c.phone).trim()) || "" })) });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const createClientCredit = expressAsyncHandler(async (req, res, next) => {
  const { phone, name, packageName, totalSessions, sessionsUsed, notes } = req.body;
  if (!phone?.trim() || !/^\d{10}$/.test(phone.trim())) {
    res.status(400);
    return next(new Error("A valid 10-digit phone number is required."));
  }
  if (!name?.trim() || !totalSessions) {
    res.status(400);
    return next(new Error("Name and total sessions are required."));
  }
  try {
    const credit = await NoidaClientCredit.create({
      phone: phone.trim(),
      name: name.trim(),
      packageName: packageName?.trim() || "",
      totalSessions: Number(totalSessions),
      sessionsUsed: Number(sessionsUsed) || 0,
      notes: notes?.trim() || "",
      source: "admin-manual",
    });
    const clientCode = await ensureClientCode({ phone: credit.phone, name: credit.name });
    return res.status(201).json({ status: true, message: "Client credit created.", data: { ...credit.toObject(), clientCode } });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const updateClientCredit = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid credit ID."));
  }
  try {
    const update = {};
    if (req.body.name !== undefined) update.name = req.body.name.trim();
    if (req.body.packageName !== undefined) update.packageName = req.body.packageName.trim();
    if (req.body.totalSessions !== undefined) update.totalSessions = Number(req.body.totalSessions);
    if (req.body.sessionsUsed !== undefined) update.sessionsUsed = Number(req.body.sessionsUsed);
    if (req.body.active !== undefined) update.active = !!req.body.active;
    if (req.body.notes !== undefined) update.notes = req.body.notes.trim();

    const credit = await NoidaClientCredit.findByIdAndUpdate(id, update, { new: true });
    if (!credit) {
      res.status(404);
      return next(new Error("Credit record not found."));
    }
    return res.status(200).json({ status: true, message: "Credit updated.", data: credit });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const deleteClientCredit = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid credit ID."));
  }
  try {
    const credit = await NoidaClientCredit.findByIdAndDelete(id);
    if (!credit) {
      res.status(404);
      return next(new Error("Credit record not found."));
    }
    return res.status(200).json({ status: true, message: "Credit record deleted." });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});
