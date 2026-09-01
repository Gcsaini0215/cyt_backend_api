import expressAsyncHandler from "express-async-handler";
import ReceptionClient from "../models/ReceptionClient.js";
import ReceptionSetting from "../models/ReceptionSetting.js";

const PRICE_KEY = "plan_prices";
const clean = ({ _id, __v, ...rest }) => rest;

/* One-time sample data so every device sees the same starting set.
   Deleted normally from the UI once real clients are added. */
function seedDocs() {
  const now = Date.now();
  const DAY = 86400000;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const mk = (name, phone, age, gender, concern, therapist, plan, label, total, price, used, pay) => {
    const attendance = [];
    for (let i = 0; i < used; i++) {
      attendance.push({
        id: `seed-${phone.slice(-4)}-a${i}`, date: iso(now - (used - i) * 7 * DAY),
        sessionNo: i + 1, therapist, mood: 4 + Math.min(i, 4), status: "attended",
      });
    }
    return {
      id: `seed-${plan}-${phone.slice(-4)}`, createdAt: now, name, phone, age, gender, email: "",
      concern, therapist,
      package: { plan, label, total, price, used, validTill: iso(now + (total > 8 ? 90 : 55) * DAY) },
      payments: pay ? [{ id: `seed-${phone.slice(-4)}-p`, date: iso(now - 14 * DAY), mode: "UPI", amount: pay }] : [],
      attendance, followUps: [], notes: [], status: "idle",
    };
  };
  return [
    mk("Meera Joshi",   "+91 98200 41000", 32, "Female", "Generalised anxiety", "Dr. Anjali Rao",  "p8",     "8 sessions",     8,  6000, 5, 6400),
    mk("Aditya Kapoor", "+91 99870 22000", 27, "Male",   "Work stress",         "Dr. Anjali Rao",  "p4",     "4 sessions",     4,  3200, 1, 1600),
    mk("Sana Sheikh",   "+91 90350 88000", 41, "Female", "Grief support",       "Dr. Kabir Sen",   "single", "Single session", 1,  900,  0, 0),
    mk("Rohan Pillai",  "+91 98115 60000", 19, "Male",   "Exam anxiety",        "Dr. Kabir Sen",   "p12",    "12 sessions",    12, 8400, 9, 8400),
    mk("Farah Khan",    "+91 96540 33000", 35, "Female", "Couples counselling", "Dr. Anjali Rao",  "p8",     "8 sessions",     8,  6000, 8, 6000),
    mk("Priya Menon",   "+91 98330 77000", 29, "Female", "Sleep difficulty",    "Dr. Meghna Iyer", "p4",     "4 sessions",     4,  3200, 4, 3200),
  ];
}

export const getReceptionClients = expressAsyncHandler(async (req, res) => {
  if ((await ReceptionClient.countDocuments()) === 0) {
    try { await ReceptionClient.insertMany(seedDocs(), { ordered: false }); } catch { /* race-safe */ }
  }
  const clients = await ReceptionClient.find().sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: clients.map(clean) });
});

export const createReceptionClient = expressAsyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.id) { res.status(400); throw new Error("id is required"); }
  const existing = await ReceptionClient.findOne({ id: body.id }).lean();
  if (existing) return res.json({ success: true, data: clean(existing) });
  const doc = await ReceptionClient.create(body);
  res.json({ success: true, data: clean(doc.toObject()) });
});

export const upsertReceptionClient = expressAsyncHandler(async (req, res) => {
  const body = { ...(req.body || {}), id: req.params.id };
  const doc = await ReceptionClient.findOneAndReplace(
    { id: req.params.id },
    body,
    { new: true, upsert: true, lean: true }
  );
  res.json({ success: true, data: clean(doc) });
});

export const deleteReceptionClient = expressAsyncHandler(async (req, res) => {
  await ReceptionClient.findOneAndDelete({ id: req.params.id });
  res.json({ success: true });
});

export const getPlanPrices = expressAsyncHandler(async (req, res) => {
  const doc = await ReceptionSetting.findOne({ key: PRICE_KEY }).lean();
  res.json({ success: true, data: (doc && doc.value) || {} });
});

export const savePlanPrices = expressAsyncHandler(async (req, res) => {
  const prices = (req.body && req.body.prices) || req.body || {};
  const doc = await ReceptionSetting.findOneAndUpdate(
    { key: PRICE_KEY },
    { key: PRICE_KEY, value: prices },
    { new: true, upsert: true, lean: true }
  );
  res.json({ success: true, data: (doc && doc.value) || {} });
});
