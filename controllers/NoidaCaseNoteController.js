import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import NoidaCaseNote from "../models/NoidaCaseNote.js";
import NoidaAppointment from "../models/NoidaAppointment.js";

// Handwritten case notes for a Noida booking (reception kiosk, iPad + pen).
// GET returns the saved pages (empty first page if nothing yet); PUT replaces them.

const MAX_PAGES = 30;
const MAX_BYTES = 6 * 1024 * 1024; // ink for a few dozen pages fits easily

function cleanPages(pages) {
  if (!Array.isArray(pages) || !pages.length) return null;
  if (pages.length > MAX_PAGES) return null;
  const out = [];
  for (const pg of pages) {
    const strokes = Array.isArray(pg?.strokes) ? pg.strokes : [];
    const clean = [];
    for (const s of strokes) {
      if (!s || !Array.isArray(s.p) || s.p.length < 3 || s.p.length % 3 !== 0) continue;
      if (!s.p.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
      clean.push({
        c: typeof s.c === "string" && /^#[0-9a-f]{6}$/i.test(s.c) ? s.c : "#111827",
        w: Math.min(40, Math.max(0.5, Number(s.w) || 2)),
        ...(s.e ? { e: true } : {}),
        p: s.p.map((n) => Math.round(n * 10) / 10),
      });
    }
    out.push({ strokes: clean });
  }
  return out;
}

export const getCaseNote = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); return next(new Error("Invalid booking")); }
  const note = await NoidaCaseNote.findOne({ appointment: id }).lean();
  return res.json({
    status: true,
    data: note
      ? { pages: note.pages?.length ? note.pages : [{ strokes: [] }], updatedAt: note.updatedAt, updatedByName: note.updatedByName }
      : { pages: [{ strokes: [] }], updatedAt: null, updatedByName: "" },
  });
});

export const saveCaseNote = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); return next(new Error("Invalid booking")); }
  if (Buffer.byteLength(JSON.stringify(req.body?.pages || [])) > MAX_BYTES) {
    res.status(413); return next(new Error("These notes are too large to save — start a new booking's notes."));
  }
  const pages = cleanPages(req.body?.pages);
  if (!pages) { res.status(400); return next(new Error("Nothing to save")); }
  const appt = await NoidaAppointment.findById(id).select("phone clientCode name").lean();
  if (!appt) { res.status(404); return next(new Error("Booking not found")); }
  const note = await NoidaCaseNote.findOneAndUpdate(
    { appointment: id },
    { $set: { pages, phone: appt.phone || "", clientCode: appt.clientCode || "", name: appt.name || "", updatedByName: req.user?.name || "" } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  return res.json({ status: true, data: { updatedAt: note.updatedAt } });
});

// The same client's notes from their other sessions (matched by phone), newest session first —
// the reception iPad shows them read-only next to today's notes. Empty notes are left out.
export const getCaseHistory = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); return next(new Error("Invalid booking")); }
  const appt = await NoidaAppointment.findById(id).select("phone").lean();
  if (!appt) { res.status(404); return next(new Error("Booking not found")); }
  const phone = String(appt.phone || "").trim();
  if (!phone) return res.json({ status: true, data: [] });
  const notes = await NoidaCaseNote.find({ phone, appointment: { $ne: id } })
    .populate("appointment", "date slot therapistName type sessionMode format status")
    .sort({ updatedAt: -1 }).limit(40).lean();
  const data = notes
    .filter((n) => Array.isArray(n.pages) && n.pages.some((pg) => Array.isArray(pg?.strokes) && pg.strokes.length))
    .map((n) => ({
      id: String(n._id),
      appointment: n.appointment?._id ? String(n.appointment._id) : String(n.appointment),
      date: n.appointment?.date || "",
      slot: n.appointment?.slot || "",
      therapistName: n.appointment?.therapistName || "",
      type: n.appointment?.type || "",
      pages: n.pages,
      updatedAt: n.updatedAt,
      updatedByName: n.updatedByName || "",
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return res.json({ status: true, data });
});
