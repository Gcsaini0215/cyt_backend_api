import expressAsyncHandler from "express-async-handler";
import ReceptionClient from "../models/ReceptionClient.js";
import ReceptionSetting from "../models/ReceptionSetting.js";
import NoidaAppointment from "../models/NoidaAppointment.js";
import { logEntry, claimReceptionSession } from "../helper/receptionPackage.js";

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
  delete body._reason;
  body.rev = 1;
  body.sessionLog = body.package
    ? [logEntry("assign", Number(body.package.used) || 0, { by: req.user?.name || "", label: body.package.label || "", total: Number(body.package.total) || 0 })]
    : [];
  const doc = await ReceptionClient.create(body);
  res.json({ success: true, data: clean(doc.toObject()) });
});

/* Save a whole client from the admin UI — guarded by `rev` so a stale copy (a
   tab that hasn't pulled for a few seconds, or two people editing at once) is
   rejected with 409 + the current record instead of silently overwriting it
   (that is how online-booking deductions used to vanish). The server owns
   `sessionLog`: package changes made here are logged automatically
   (new package -> "assign", a changed used/total -> "manual" with the reason). */
export const upsertReceptionClient = expressAsyncHandler(async (req, res) => {
  const id = req.params.id;
  const by = req.user?.name || "";
  const body = { ...(req.body || {}), id };
  const reason = String(body._reason || "").slice(0, 240);
  delete body._reason;

  const existing = await ReceptionClient.findOne({ id }).lean();
  if (!existing) {
    body.rev = 1;
    body.sessionLog = body.package
      ? [logEntry("assign", Number(body.package.used) || 0, { by, label: body.package.label || "", total: Number(body.package.total) || 0, reason })]
      : [];
    const doc = await ReceptionClient.findOneAndReplace({ id }, body, { new: true, upsert: true, lean: true });
    return res.json({ success: true, data: clean(doc) });
  }

  const curRev = Number.isFinite(existing.rev) ? existing.rev : null;
  const baseRev = Number.isFinite(body.rev) ? body.rev : null;
  if (curRev !== null && baseRev !== curRev) {
    return res.status(409).json({ success: false, conflict: true, message: "This client was changed elsewhere — reloaded the latest copy.", data: clean(existing) });
  }

  const log = [...(existing.sessionLog || [])];
  const oldP = existing.package || null;
  const newP = body.package || null;
  const samePkg = oldP && newP && (oldP.pid || "") === (newP.pid || "");
  if (newP && !samePkg) {
    log.push(logEntry("assign", Number(newP.used) || 0, { by, label: newP.label || "", total: Number(newP.total) || 0, reason }));
  } else if (samePkg) {
    const du = (Number(newP.used) || 0) - (Number(oldP.used) || 0);
    const dt = (Number(newP.total) || 0) - (Number(oldP.total) || 0);
    if (du || dt) {
      log.push(logEntry(/^recount/i.test(reason) ? "recount" : "manual", du, {
        by, reason,
        from: Number(oldP.used) || 0, to: Number(newP.used) || 0,
        ...(dt ? { totalFrom: Number(oldP.total) || 0, totalTo: Number(newP.total) || 0 } : {}),
      }));
    }
  }
  if (newP) newP.used = Number(newP.used) || 0;
  body.sessionLog = log;
  body.rev = (curRev || 0) + 1;

  const filter = curRev === null
    ? { id, $or: [{ rev: { $exists: false } }, { rev: null }] }
    : { id, rev: curRev };
  const doc = await ReceptionClient.findOneAndReplace(filter, body, { new: true, lean: true });
  if (!doc) {
    const latest = await ReceptionClient.findOne({ id }).lean();
    return res.status(409).json({ success: false, conflict: true, message: "This client was changed elsewhere — reloaded the latest copy.", data: latest ? clean(latest) : null });
  }
  res.json({ success: true, data: clean(doc) });
});

const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* Therapy Room "End session" — done on the server so the package count is
   atomic. If today's session was already booked (and paid) from this package
   through CYT Noida, it is linked to that booking and NOT deducted again. */
export const endReceptionSession = expressAsyncHandler(async (req, res) => {
  const id = req.params.id;
  const by = req.user?.name || "";
  const note = req.body?.note || {};
  const doc = await ReceptionClient.findOne({ id }).lean();
  if (!doc) { res.status(404); throw new Error("Client not found"); }

  const today = istToday();
  const prebooked = doc.package
    ? await NoidaAppointment.findOneAndUpdate(
        { receptionCreditClientId: id, date: today, status: { $ne: "cancelled" }, receptionAttendanceLinked: { $ne: true } },
        { $set: { receptionAttendanceLinked: true, attendance: "completed", attendanceAt: new Date() } },
        { new: true }
      )
    : null;

  let after = doc;
  let counted = false;
  if (prebooked) {
    await ReceptionClient.updateOne({ id }, { $push: { sessionLog: logEntry("clinic-prebooked", 0, { by, date: today, ref: String(prebooked._id), slot: prebooked.slot }) }, $inc: { rev: 1 } });
  } else if (doc.package) {
    const claimed = await claimReceptionSession(id, { kind: "clinic", by, date: today });
    if (claimed) { after = claimed; counted = true; }
  }

  const used = Number(after.package?.used) || 0;
  const sessionNo = prebooked || counted ? used : used + 1; // beyond the package: still numbered, not deducted
  const durationMin = doc.sessionStartedAt ? Math.round((Date.now() - doc.sessionStartedAt) / 60000) : null;
  const final = await ReceptionClient.findOneAndUpdate(
    { id },
    {
      $set: { status: "done", sessionStartedAt: null, checkedInAt: null, lastDoneAt: Date.now() },
      $inc: { rev: 1 },
      $push: {
        attendance: {
          id: uid(), date: today, sessionNo, therapist: doc.therapist, status: "attended",
          mood: note.mood ? Number(note.mood) : null, durationMin,
          ...(prebooked ? { bookingRef: String(prebooked._id) } : {}),
          ...(!prebooked && !counted && doc.package ? { beyondPackage: true } : {}),
        },
        notes: {
          id: uid(), date: today, sessionNo,
          s: note.s || "", o: note.o || "", a: note.a || "", p: note.p || "",
          homework: note.homework || "", mood: note.mood || "", risk: note.risk || "None",
        },
      },
    },
    { new: true, lean: true }
  );
  res.json({ success: true, data: clean(final), prebooked: !!prebooked, beyondPackage: !prebooked && !counted && !!doc.package });
});

/* Recount — what `used` should be according to the real records: sessions
   attended at the clinic for this package + package bookings made through
   CYT Noida that weren't cancelled and aren't the same visit. Read-only; the
   admin applies it (logged as "recount"). */
export const recountReceptionClient = expressAsyncHandler(async (req, res) => {
  const id = req.params.id;
  const doc = await ReceptionClient.findOne({ id }).lean();
  if (!doc) { res.status(404); throw new Error("Client not found"); }
  const pkg = doc.package || {};

  // Where this package starts: its own start date, else the last time session numbering restarted at 1.
  const att = (doc.attendance || []).filter((a) => a.status === "attended" || !a.status);
  let since = pkg.startedAt || null;
  if (!since) {
    const lastReset = att.map((a, i) => (Number(a.sessionNo) === 1 ? i : -1)).filter((i) => i >= 0).pop();
    since = lastReset !== undefined ? att[lastReset].date : null;
  }
  const clinic = att.filter((a) => !since || (a.date && a.date >= since));
  const clinicDates = new Set(clinic.map((a) => a.date));

  const bookings = await NoidaAppointment.find({ receptionCreditClientId: id, status: { $ne: "cancelled" } })
    .select("date slot status attendance receptionAttendanceLinked createdAt").sort({ date: 1 }).lean();
  const online = bookings.filter((b) => (!since || b.date >= since) && !b.receptionAttendanceLinked && !clinicDates.has(b.date));

  // Sessions already used when this package was entered (custom package for an
  // older client: "already used" — done on paper before this system). The last
  // "assign" in the history is the current package's.
  const lastAssign = [...(doc.sessionLog || [])].reverse().find((e) => e.kind === "assign");
  const atStart = Math.max(0, Number(lastAssign?.delta) || 0);

  const total = Number(pkg.total) || 0;
  const raw = atStart + clinic.length + online.length;
  res.json({
    success: true,
    data: {
      current: Number(pkg.used) || 0,
      total,
      suggested: total ? Math.min(total, raw) : raw,
      since,
      atStart,
      clinic: clinic.map((a) => ({ date: a.date, sessionNo: a.sessionNo, therapist: a.therapist || "" })),
      online: online.map((b) => ({ id: String(b._id), date: b.date, slot: b.slot, attendance: b.attendance || "" })),
    },
  });
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
