import expressAsyncHandler from "express-async-handler";
import Razorpay from "razorpay";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import Jwt from "jsonwebtoken";
import Trainee from "../models/Trainee.js";
import TraineeAccount from "../models/TraineeAccount.js";
import TraineeAttendance from "../models/TraineeAttendance.js";
import TraineeTask from "../models/TraineeTask.js";
import TraineeCertificate from "../models/TraineeCertificate.js";
import TraineeMaterial from "../models/TraineeMaterial.js";
import { sendMail } from "../helper/mailer.js";
import { INTERN_FEES, signTraineeToken } from "./traineeController.js";
import TraineeNotification from "../models/TraineeNotification.js";
import { addTraineeStream, notifyTrainees, traineeChanged, toTraineeRow, emitTraineeRead } from "../services/traineeNotify.js";

/* Trainee portal: attendance (check in / out), tasks from the CYT team, notes (worksheets / slides),
   certificates, profile, and buying more internship hours. Trainees are keyed by email — the same
   for portal accounts and internship applications. Admin routes sit at the bottom. */

const TEAM = "hello@chooseyourtherapist.in";
const PORTAL = "https://www.chooseyourtherapist.in/trainee";
const IST_MS = 330 * 60000;
const istDate = (d = new Date()) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const dayEnd = (date) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 23, 59, 59) - IST_MS); };
const MAX_DAY_MS = 8 * 3600000; // a forgotten check-out closes after 8 hours (or at midnight)
const DURATION_OF = { "30 hrs": "1 Month", "40 hrs": "1 Month", "60 hrs": "1 Month", "80 hrs": "2 Months", "100 hrs": "2 Months", "120 hrs": "2 Months", "240 hrs": "3 Months" };
const hoursNum = (h) => parseInt(h, 10) || 0;
const clip = (v, n = 500) => String(v ?? "").trim().slice(0, n);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uploadsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "uploads");
const removeUpload = (rel) => { if (rel) fs.unlink(path.join(uploadsRoot, rel), () => {}); };
const getRazorpay = () => new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
const mail = (to, subject, text, html) => sendMail(to, subject, text, html).catch(() => {});

/* ── auth: a trainee-portal token (kind "trainee") ── */
export const traineeAuth = expressAsyncHandler(async (req, res, next) => {
  const h = req.headers.authorization || "";
  let d = null;
  try { d = h.startsWith("Bearer ") ? Jwt.verify(h.slice(7), process.env.JWT_SECRET, { algorithms: ["HS256"] }) : null; } catch { d = null; }
  if (!d || d.kind !== "trainee" || !d.email) return res.status(401).json({ status: false, message: "Please sign in" });
  const email = String(d.email).toLowerCase();
  const acc = await TraineeAccount.findOne({ email }, { approval: 1 }).lean();
  if (acc && acc.approval === "rejected") return res.status(403).json({ status: false, message: "Your account is not active." });
  req.trainee = { email, name: d.name || "Trainee", traineeId: d.traineeId || null, accountId: d.accountId || null };
  next();
});

/* ═════════════ Notifications (bell + live stream) ═════════════ */

/* GET /api/trainee-portal/notifications */
export const myNotifications = expressAsyncHandler(async (req, res) => {
  const { email } = req.trainee;
  const [rows, unread] = await Promise.all([
    TraineeNotification.find({ email }).sort({ createdAt: -1 }).limit(40).lean(),
    TraineeNotification.countDocuments({ email, read_at: null }),
  ]);
  res.json({ status: true, data: { items: rows.map(toTraineeRow), unread } });
});

/* POST /api/trainee-portal/notifications/read { ids? } — no ids = mark everything read */
export const readMyNotifications = expressAsyncHandler(async (req, res) => {
  const { email } = req.trainee;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => /^[a-f0-9]{24}$/i.test(String(x))) : null;
  const q = { email, read_at: null };
  if (ids) q._id = { $in: ids };
  await TraineeNotification.updateMany(q, { $set: { read_at: new Date() } });
  emitTraineeRead(email, ids);
  res.json({ status: true, data: { unread: await TraineeNotification.countDocuments({ email, read_at: null }) } });
});

/* GET /api/trainee-portal/stream?token= — live notifications + "changed" events (SSE) */
export const traineeStream = (req, res) => {
  let d;
  try { d = Jwt.verify(String(req.query.token || ""), process.env.JWT_SECRET, { algorithms: ["HS256"] }); } catch { d = null; }
  if (!d || d.kind !== "trainee" || !d.email) return res.status(401).json({ status: false, message: "Please sign in" });
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders?.();
  res.write("retry: 3000\n\n");
  res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  const remove = addTraineeStream(res, String(d.email).toLowerCase());
  req.on("close", remove);
};

// every trainee who can use the portal (for notes shared with everyone)
async function allTraineeEmails() {
  const [accs, apps] = await Promise.all([
    TraineeAccount.find({ approval: "approved" }, { email: 1 }).lean(),
    Trainee.find({ email: { $ne: "" }, status: { $ne: "rejected" } }, { email: 1 }).lean(),
  ]);
  return [...new Set([...accs, ...apps].map((x) => String(x.email).toLowerCase()))];
}

const applicationOf = async (t) => (t.traineeId ? Trainee.findById(t.traineeId) : null)
  || Trainee.findOne({ email: new RegExp(`^${t.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).sort({ createdAt: -1 });

/* ═════════════ Attendance ═════════════ */

// close check-ins left open on an earlier day
async function closeStale(filter) {
  const today = istDate();
  const open = await TraineeAttendance.find({ ...filter, checkIn: { $ne: null }, checkOut: null, date: { $lt: today } });
  await Promise.all(open.map((r) => {
    r.checkOut = new Date(Math.min(r.checkIn.getTime() + MAX_DAY_MS, dayEnd(r.date).getTime()));
    r.autoOut = true;
    return r.save();
  }));
}
const minutesOf = (r) => (r?.checkIn ? Math.max(0, Math.round(((r.checkOut ? new Date(r.checkOut) : new Date()) - new Date(r.checkIn)) / 60000)) : 0);
const rowOut = (r) => ({ _id: r._id, date: r.date, checkIn: r.checkIn, checkOut: r.checkOut, note: r.note, autoOut: r.autoOut, minutes: minutesOf(r) });

/* GET /api/trainee-portal/attendance — today + the last 60 days */
export const myAttendance = expressAsyncHandler(async (req, res) => {
  const { email } = req.trainee;
  await closeStale({ email });
  const today = istDate();
  const from = istDate(new Date(Date.now() - 59 * 86400000));
  const rows = await TraineeAttendance.find({ email, date: { $gte: from } }).sort({ date: -1 }).lean();
  const month = today.slice(0, 7);
  const monthRows = rows.filter((r) => r.date.startsWith(month));
  res.json({
    status: true,
    data: {
      today: rows.find((r) => r.date === today) ? rowOut(rows.find((r) => r.date === today)) : null,
      days: rows.map(rowOut),
      month: { present: monthRows.length, minutes: monthRows.reduce((s, r) => s + minutesOf(r), 0) },
      total: { present: await TraineeAttendance.countDocuments({ email }) },
    },
  });
});

/* POST /api/trainee-portal/attendance/check-in */
export const traineeCheckIn = expressAsyncHandler(async (req, res) => {
  const { email, name } = req.trainee;
  await closeStale({ email });
  const date = istDate();
  const row = await TraineeAttendance.findOne({ email, date });
  if (row?.checkOut) return res.status(400).json({ status: false, message: "You've already checked out today. See you tomorrow!" });
  if (row?.checkIn) return res.json({ status: true, data: rowOut(row), message: "You're already checked in" });
  const made = await TraineeAttendance.findOneAndUpdate(
    { email, date },
    { $setOnInsert: { email, name, date, checkIn: new Date() } },
    { upsert: true, new: true },
  );
  traineeChanged(email, "attendance");
  res.json({ status: true, data: rowOut(made), message: "Checked in — have a good session!" });
});

/* POST /api/trainee-portal/attendance/check-out { note } */
export const traineeCheckOut = expressAsyncHandler(async (req, res) => {
  const { email } = req.trainee;
  const row = await TraineeAttendance.findOne({ email, date: istDate() });
  if (!row?.checkIn) return res.status(400).json({ status: false, message: "You haven't checked in today." });
  if (row.checkOut) return res.json({ status: true, data: rowOut(row), message: "Already checked out" });
  row.checkOut = new Date();
  row.note = clip(req.body?.note, 1000);
  await row.save();
  traineeChanged(email, "attendance");
  res.json({ status: true, data: rowOut(row), message: "Checked out — well done today!" });
});

/* ═════════════ Tasks ═════════════ */

const taskOrder = (a, b) => {
  const done = (t) => (t.status === "done" ? 1 : 0);
  if (done(a) !== done(b)) return done(a) - done(b);
  const due = (t) => (t.due ? new Date(t.due).getTime() : Infinity);
  if (!done(a) && due(a) !== due(b)) return due(a) - due(b);
  return new Date(b.createdAt) - new Date(a.createdAt);
};

/* GET /api/trainee-portal/tasks */
export const myTasks = expressAsyncHandler(async (req, res) => {
  const list = await TraineeTask.find({ email: req.trainee.email }).sort({ createdAt: -1 }).limit(300).lean();
  res.json({ status: true, data: list.sort(taskOrder) });
});

/* PATCH /api/trainee-portal/tasks/:id { status, traineeNote, link } */
export const updateMyTask = expressAsyncHandler(async (req, res) => {
  const task = await TraineeTask.findOne({ _id: req.params.id, email: req.trainee.email });
  if (!task) return res.status(404).json({ status: false, message: "Task not found" });
  const { status, traineeNote, link } = req.body || {};
  const was = task.status;
  if (status !== undefined) {
    if (!["todo", "doing", "done"].includes(status)) return res.status(400).json({ status: false, message: "Unknown status" });
    task.status = status;
    task.doneAt = status === "done" ? (task.doneAt || new Date()) : null;
  }
  if (traineeNote !== undefined) task.traineeNote = clip(traineeNote, 2000);
  if (link !== undefined) {
    const l = clip(link, 500);
    if (l && !/^https?:\/\//i.test(l)) return res.status(400).json({ status: false, message: "The link should start with https://" });
    task.link = l;
  }
  await task.save();
  if (task.status === "done" && was !== "done") {
    mail(TEAM, `Task done by ${task.name || task.email} — ${task.title}`,
      `${task.name} (${task.email}) marked "${task.title}" as done.${task.traineeNote ? `\nNote: ${task.traineeNote}` : ""}${task.link ? `\nLink: ${task.link}` : ""}`,
      `<p><b>${esc(task.name)}</b> (${esc(task.email)}) marked <b>${esc(task.title)}</b> as done.</p>${task.traineeNote ? `<p>Note: ${esc(task.traineeNote)}</p>` : ""}${task.link ? `<p>Link: <a href="${esc(task.link)}">${esc(task.link)}</a></p>` : ""}`);
  }
  traineeChanged(task.email, "tasks");
  res.json({ status: true, data: task, message: task.status === "done" ? "Marked as done — the team has been told" : "Saved" });
});

/* ═════════════ Notes & certificates ═════════════ */

/* GET /api/trainee-portal/notes */
export const myNotes = expressAsyncHandler(async (req, res) => {
  const list = await TraineeMaterial.find({ $or: [{ forAll: true }, { emails: req.trainee.email }] }, { emails: 0 })
    .sort({ createdAt: -1 }).limit(300).lean();
  res.json({ status: true, data: list });
});

/* GET /api/trainee-portal/overview — everything the dashboard home needs in one call */
export const myOverview = expressAsyncHandler(async (req, res) => {
  const { email } = req.trainee;
  await closeStale({ email });
  const today = istDate();
  const weekFrom = istDate(new Date(Date.now() - 6 * 86400000));
  const [app, allAtt, tasks, notes, certs] = await Promise.all([
    applicationOf(req.trainee),
    TraineeAttendance.find({ email }, { date: 1, checkIn: 1, checkOut: 1 }).lean(),
    TraineeTask.find({ email }).sort({ createdAt: -1 }).limit(300).lean(),
    TraineeMaterial.find({ $or: [{ forAll: true }, { emails: email }] }, { emails: 0 }).sort({ createdAt: -1 }).limit(3).lean(),
    TraineeCertificate.find({ email }).sort({ createdAt: -1 }).limit(1).lean(),
  ]);
  const month = today.slice(0, 7);
  const totalMinutes = allAtt.reduce((s, r) => s + minutesOf(r), 0);
  const week = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = istDate(new Date(Date.now() - i * 86400000));
    const r = allAtt.find((x) => x.date === d);
    week.push({ date: d, minutes: r ? minutesOf(r) : 0 });
  }
  const open = tasks.filter((t) => t.status !== "done").sort(taskOrder);
  const overdue = open.filter((t) => t.due && istDate(new Date(t.due)) < today).length;
  res.json({
    status: true,
    data: {
      program: app ? {
        hours: app.hours, duration: app.duration, mode: app.mode, tracks: app.internType || [], status: app.status,
        startFrom: app.availableFrom, appliedAt: app.createdAt, paid: app.paymentStatus === "paid", free: app.paymentStatus === "free",
        canUpgrade: !!INTERN_FEES[app.hours] && upgradeOptions(app.hours).length > 0,
      } : null,
      attendance: {
        totalMinutes, totalDays: allAtt.length,
        monthDays: allAtt.filter((r) => r.date.startsWith(month)).length,
        monthMinutes: allAtt.filter((r) => r.date.startsWith(month)).reduce((s, r) => s + minutesOf(r), 0),
        week, weekDays: allAtt.filter((r) => r.date >= weekFrom).length,
      },
      tasks: { open: open.length, overdue, done: tasks.length - open.length, next: open.slice(0, 3) },
      notes,
      certificate: certs[0] || null,
    },
  });
});

/* GET /api/trainee-portal/certificates */
export const myCertificates = expressAsyncHandler(async (req, res) => {
  const list = await TraineeCertificate.find({ email: req.trainee.email }).sort({ createdAt: -1 }).lean();
  res.json({ status: true, data: list });
});

/* ═════════════ Profile ═════════════ */

const PROFILE_FIELDS = ["firstName", "lastName", "phone", "gender", "dob", "city", "college", "course", "year", "bio", "linkedin"];
const splitName = (n) => { const p = String(n || "Trainee").trim().split(/\s+/); return { firstName: p[0], lastName: p.slice(1).join(" ") }; };

async function profileOf(t) {
  const acc = await TraineeAccount.findOne({ email: t.email }).lean();
  const app = await applicationOf(t);
  const base = acc || { ...splitName(app?.name || t.name), email: t.email, phone: app?.phone || "" };
  return {
    firstName: base.firstName || "", lastName: base.lastName || "", email: t.email, phone: base.phone || app?.phone || "",
    gender: base.gender || app?.gender || "", dob: base.dob || app?.dob || "", city: base.city || app?.city || "",
    college: base.college || app?.college || "", course: base.course || app?.degree || "", year: base.year || app?.year || "",
    bio: base.bio || "", linkedin: base.linkedin || "", photo: base.photo || (app?.passportPhoto ? `documents/${app.passportPhoto}` : ""),
  };
}

/* GET /api/trainee-portal/profile */
export const myProfile = expressAsyncHandler(async (req, res) => {
  res.json({ status: true, data: await profileOf(req.trainee) });
});

/* PUT /api/trainee-portal/profile (multipart: fields + optional photo) */
export const saveMyProfile = expressAsyncHandler(async (req, res) => {
  const t = req.trainee;
  const body = req.body || {};
  const set = {};
  for (const k of PROFILE_FIELDS) if (body[k] !== undefined) set[k] = clip(body[k], k === "bio" ? 600 : 120);
  if (set.firstName !== undefined && set.firstName.length < 2) return res.status(400).json({ status: false, message: "Please enter your first name" });
  if (set.phone && !/^[0-9+\-\s]{7,16}$/.test(set.phone)) return res.status(400).json({ status: false, message: "Please enter a valid mobile number" });
  if (set.linkedin && !/^https?:\/\//i.test(set.linkedin)) return res.status(400).json({ status: false, message: "The LinkedIn link should start with https://" });
  let acc = await TraineeAccount.findOne({ email: t.email });
  if (!acc) {
    // signed in with an internship application only — make the account that holds the profile
    const app = await applicationOf(t);
    acc = new TraineeAccount({ ...splitName(app?.name || t.name), email: t.email, phone: app?.phone || "", verified: true, approval: "approved", reviewedBy: "application" });
  }
  const oldPhoto = acc.photo;
  Object.assign(acc, set);
  if (req.file) acc.photo = `images/${req.file.filename}`;
  else if (body.removePhoto === "1") acc.photo = "";
  await acc.save();
  if (oldPhoto && oldPhoto !== acc.photo && oldPhoto.startsWith("images/")) removeUpload(oldPhoto);
  const app = await applicationOf(t);
  if (app) {
    // keep the application's contact details in step with the profile
    const full = [acc.firstName, acc.lastName].filter(Boolean).join(" ");
    Object.assign(app, { name: full || app.name, phone: acc.phone || app.phone, city: acc.city || app.city, college: acc.college || app.college });
    await app.save();
  }
  traineeChanged(t.email, "profile");
  res.json({ status: true, data: await profileOf(t), token: signTraineeToken(acc, app), message: "Profile saved" });
});

/* ═════════════ Upgrade internship hours ═════════════ */

// Upgrade rule (kept simple): for OFFER_DAYS after getting the current plan, an upgrade costs the difference
// (but at least MIN_PER_HOUR for every extra hour, and never more than the new plan's full price).
// After that window it costs the new plan's full price.
const OFFER_DAYS = 7;
const MIN_PER_HOUR = 50;
// when the current plan was bought: the last upgrade, else the application
const planSince = (app) => {
  const ups = (app?.upgrades || []).filter((u) => u.to === app.hours && u.at);
  return ups.length ? new Date(ups[ups.length - 1].at) : new Date(app?.createdAt || Date.now());
};
const offerEnds = (app) => new Date(planSince(app).getTime() + OFFER_DAYS * 86400000);
const upgradeOptions = (current, app = null) => {
  const inOffer = !!app && Date.now() < offerEnds(app).getTime();
  return Object.entries(INTERN_FEES)
    .filter(([h]) => hoursNum(h) > hoursNum(current))
    .map(([h, fee]) => {
      const extra = hoursNum(h) - hoursNum(current);
      const offer = Math.min(fee, Math.max(fee - (INTERN_FEES[current] || 0), extra * MIN_PER_HOUR));
      return { hours: h, duration: DURATION_OF[h], fee, extra, pay: inOffer ? offer : fee, offer: inOffer };
    });
};

/* GET /api/trainee-portal/upgrade */
export const upgradeInfo = expressAsyncHandler(async (req, res) => {
  const app = await applicationOf(req.trainee);
  if (!app) return res.json({ status: true, data: { application: false } });
  res.json({
    status: true,
    data: {
      application: true, paid: app.paymentStatus === "paid", free: app.paymentStatus === "free", hours: app.hours, duration: app.duration,
      fee: INTERN_FEES[app.hours] || app.programFee || 0, options: INTERN_FEES[app.hours] ? upgradeOptions(app.hours, app) : [],
      upgrades: app.upgrades || [],
      offer: { days: OFFER_DAYS, minPerHour: MIN_PER_HOUR, since: planSince(app), endsAt: offerEnds(app), active: Date.now() < offerEnds(app).getTime() },
    },
  });
});

/* POST /api/trainee-portal/upgrade/order { hours } — the amount is the fee difference, decided here */
export const upgradeOrder = expressAsyncHandler(async (req, res) => {
  const app = await applicationOf(req.trainee);
  if (!app) return res.status(400).json({ status: false, message: "Apply for the internship first." });
  const to = String(req.body?.hours || "");
  const opt = INTERN_FEES[app.hours] ? upgradeOptions(app.hours, app).find((o) => o.hours === to) : null;
  if (!opt || opt.pay <= 0) return res.status(400).json({ status: false, message: "Please choose a bigger plan than your current one." });
  const order = await getRazorpay().orders.create({
    amount: opt.pay * 100, currency: "INR", receipt: `intern_up_${Date.now()}`,
    notes: { purpose: "internship-upgrade", traineeId: String(app._id), from: app.hours, to, pay: String(opt.pay), offer: opt.offer ? "1" : "0" },
  });
  res.json({ status: true, data: { orderId: order.id, amount: opt.pay, keyId: process.env.RAZORPAY_KEY_ID, to: opt } });
});

/* POST /api/trainee-portal/upgrade/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature } */
export const upgradeVerify = expressAsyncHandler(async (req, res) => {
  const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body || {};
  if (!oid || !pid || !sig) return res.status(400).json({ status: false, message: "Incomplete payment details." });
  const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${oid}|${pid}`).digest("hex");
  if (expected !== sig) return res.status(400).json({ status: false, message: "Payment could not be verified." });
  const app = await applicationOf(req.trainee);
  if (!app) return res.status(400).json({ status: false, message: "Application not found — please contact support with your payment ID." });
  if ((app.upgrades || []).some((u) => u.paymentId === pid)) return res.json({ status: true, data: app, message: "Upgrade already applied" });
  const order = await getRazorpay().orders.fetch(oid);
  const n = order.notes || {};
  const pay = Number(n.pay) || INTERN_FEES[n.to] || 0;
  if (n.purpose !== "internship-upgrade" || n.traineeId !== String(app._id) || n.from !== app.hours || !INTERN_FEES[n.to] || pay <= 0 || pay > INTERN_FEES[n.to] || order.amount !== pay * 100) {
    return res.status(400).json({ status: false, message: "The payment doesn't match this upgrade. Please contact support with your payment ID." });
  }
  app.upgrades = [...(app.upgrades || []), { from: n.from, to: n.to, amount: pay, paymentId: pid, orderId: oid, at: new Date() }];
  app.hours = n.to;
  app.duration = DURATION_OF[n.to] || app.duration;
  app.programFee = INTERN_FEES[n.to];
  await app.save();
  mail(TEAM, `Internship upgraded — ${app.name}: ${n.from} → ${n.to}`,
    `${app.name} (${app.email}) upgraded from ${n.from} to ${n.to} and paid ₹${pay} (payment ${pid}).`,
    `<p><b>${esc(app.name)}</b> (${esc(app.email)}) upgraded from <b>${esc(n.from)}</b> to <b>${esc(n.to)}</b> and paid <b>₹${pay}</b>.</p><p>Payment ID: ${esc(pid)}</p>`);
  if (app.email) {
    mail(app.email, `Your internship is upgraded to ${n.to}`,
      `Hi ${app.name}, your internship is now ${n.to} (${app.duration}). We received ₹${pay}. Payment ID: ${pid}.`,
      `<p>Hi ${esc(app.name)},</p><p>Your internship is now <b>${esc(n.to)}</b> (${esc(app.duration)}). We received <b>₹${pay}</b>.</p><p>Payment ID: ${esc(pid)}</p><p><a href="${PORTAL}">Open your trainee portal →</a></p>`);
  }
  notifyTrainees(req.trainee.email, { type: "plan", title: `Upgraded to ${n.to}`, body: `Payment of ₹${pay} received. Your internship is now ${n.to}.`, link: "/trainee/upgrade" });
  res.json({ status: true, data: app, message: `Upgraded to ${n.to}` });
});

/* ═════════════ Admin ═════════════ */

const adminName = (req) => String(req.user?.name || req.user?.email || "Admin");

/* GET /api/admin/trainee-portal/people — everyone who can use the portal, with today's attendance */
export const adminPeople = expressAsyncHandler(async (req, res) => {
  const [accs, apps] = await Promise.all([
    TraineeAccount.find({ approval: "approved" }, { firstName: 1, lastName: 1, email: 1, phone: 1, photo: 1, college: 1 }).lean(),
    Trainee.find({ email: { $ne: "" }, status: { $ne: "rejected" } }, { name: 1, email: 1, phone: 1, hours: 1, duration: 1, mode: 1, internType: 1, status: 1, paymentStatus: 1, college: 1, availableFrom: 1 }).sort({ createdAt: -1 }).lean(),
  ]);
  const by = new Map();
  for (const a of apps) {
    const e = String(a.email).toLowerCase();
    if (!by.has(e)) {
      by.set(e, {
        email: e, name: a.name, phone: a.phone, hours: a.hours, duration: a.duration, mode: a.mode, tracks: a.internType || [],
        status: a.status, payment: a.paymentStatus || "", college: a.college || "", startFrom: a.availableFrom || "",
        active: a.status === "active", // only interns marked Active on the Internships page use the portal lists
      });
    }
  }
  for (const a of accs) {
    const e = a.email;
    const name = [a.firstName, a.lastName].filter(Boolean).join(" ");
    const cur = by.get(e) || { email: e, hours: "", status: "account", active: false, tracks: [] };
    by.set(e, { ...cur, name: name || cur.name, phone: a.phone || cur.phone, photo: a.photo || "", college: cur.college || a.college || "" });
  }
  await closeStale({});
  const emails = [...by.keys()];
  const [today, totals, open] = await Promise.all([
    TraineeAttendance.find({ date: istDate() }).lean(),
    TraineeAttendance.find({ email: { $in: emails } }, { email: 1, checkIn: 1, checkOut: 1 }).lean(),
    TraineeTask.aggregate([{ $match: { email: { $in: emails }, status: { $ne: "done" } } }, { $group: { _id: "$email", n: { $sum: 1 } } }]),
  ]);
  const att = new Map(today.map((r) => [r.email, rowOut(r)]));
  const mins = new Map();
  const days = new Map();
  for (const r of totals) { mins.set(r.email, (mins.get(r.email) || 0) + minutesOf(r)); days.set(r.email, (days.get(r.email) || 0) + 1); }
  const openTasks = new Map(open.map((x) => [x._id, x.n]));
  const data = [...by.values()].map((p) => ({
    ...p, today: att.get(p.email) || null, totalMinutes: mins.get(p.email) || 0, days: days.get(p.email) || 0, openTasks: openTasks.get(p.email) || 0,
  })).sort((x, y) => String(x.name).localeCompare(String(y.name)));
  res.json({ status: true, data });
});

/* GET /api/admin/trainee-portal/attendance?from=&to=&email= (default: last 7 days) */
export const adminAttendance = expressAsyncHandler(async (req, res) => {
  await closeStale({});
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const to = re.test(req.query.to || "") ? req.query.to : istDate();
  const from = re.test(req.query.from || "") ? req.query.from : istDate(new Date(Date.now() - 6 * 86400000));
  const q = { date: { $gte: from, $lte: to } };
  if (req.query.email) q.email = String(req.query.email).toLowerCase();
  const rows = await TraineeAttendance.find(q).sort({ date: -1, checkIn: -1 }).limit(3000).lean();
  res.json({ status: true, data: rows.map((r) => ({ ...rowOut(r), email: r.email, name: r.name })), from, to });
});

/* PATCH /api/admin/trainee-portal/attendance/:id { checkIn, checkOut } — correct the times */
export const adminFixAttendance = expressAsyncHandler(async (req, res) => {
  const row = await TraineeAttendance.findById(req.params.id);
  if (!row) return res.status(404).json({ status: false, message: "Not found" });
  const read = (v) => (v === null || v === "" ? null : new Date(v));
  if (req.body?.checkIn !== undefined) row.checkIn = read(req.body.checkIn);
  if (req.body?.checkOut !== undefined) { row.checkOut = read(req.body.checkOut); row.autoOut = false; }
  if ((row.checkIn && Number.isNaN(row.checkIn.getTime())) || (row.checkOut && Number.isNaN(row.checkOut.getTime()))) return res.status(400).json({ status: false, message: "Invalid time" });
  if (row.checkIn && row.checkOut && row.checkOut < row.checkIn) return res.status(400).json({ status: false, message: "Check-out must be after check-in" });
  await row.save();
  notifyTrainees(row.email, { type: "attendance", title: "Your attendance was updated", body: `The team corrected your times for ${row.date}.`, link: "/trainee/attendance" });
  res.json({ status: true, data: { ...rowOut(row), email: row.email, name: row.name }, message: "Updated" });
});

/* GET /api/admin/trainee-portal/tasks?email= */
export const adminTasks = expressAsyncHandler(async (req, res) => {
  const q = req.query.email ? { email: String(req.query.email).toLowerCase() } : {};
  const list = await TraineeTask.find(q).sort({ createdAt: -1 }).limit(1000).lean();
  res.json({ status: true, data: list });
});

/* POST /api/admin/trainee-portal/tasks { people: [{email, name}], title, details, due, priority } */
export const adminCreateTask = expressAsyncHandler(async (req, res) => {
  const { people, title, details, due, priority } = req.body || {};
  const list = (Array.isArray(people) ? people : []).filter((p) => p?.email).slice(0, 300);
  if (!list.length) return res.status(400).json({ status: false, message: "Choose at least one trainee" });
  if (!clip(title)) return res.status(400).json({ status: false, message: "Please add a task title" });
  const dueAt = due ? new Date(due) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) return res.status(400).json({ status: false, message: "Invalid due date" });
  const by = adminName(req);
  const rows = await TraineeTask.insertMany(list.map((p) => ({
    email: String(p.email).toLowerCase(), name: clip(p.name, 120), title: clip(title, 200), details: clip(details, 4000),
    due: dueAt, priority: ["low", "normal", "high"].includes(priority) ? priority : "normal", createdBy: by,
  })));
  for (const r of rows) {
    mail(r.email, `New task from CYT: ${r.title}`,
      `Hi ${r.name || "there"}, the CYT team has sent you a new task: ${r.title}.${r.due ? ` Due: ${r.due.toDateString()}.` : ""} Open your trainee portal: ${PORTAL}/tasks`,
      `<p>Hi ${esc(r.name || "there")},</p><p>The CYT team has sent you a new task: <b>${esc(r.title)}</b>${r.due ? ` — due <b>${esc(r.due.toDateString())}</b>` : ""}.</p>${r.details ? `<p style="white-space:pre-line">${esc(r.details)}</p>` : ""}<p><a href="${PORTAL}/tasks">Open your tasks →</a></p>`);
  }
  notifyTrainees(rows.map((r) => r.email), { type: "task", title: `New task: ${rows[0].title}`, body: rows[0].due ? `Due ${rows[0].due.toDateString()}` : (rows[0].details || "").slice(0, 140), link: "/trainee/tasks" });
  res.json({ status: true, data: rows, message: `Task sent to ${rows.length} trainee${rows.length === 1 ? "" : "s"}` });
});

/* PATCH /api/admin/trainee-portal/tasks/:id */
export const adminUpdateTask = expressAsyncHandler(async (req, res) => {
  const task = await TraineeTask.findById(req.params.id);
  if (!task) return res.status(404).json({ status: false, message: "Task not found" });
  const b = req.body || {};
  if (b.title !== undefined) { if (!clip(b.title)) return res.status(400).json({ status: false, message: "Title can't be empty" }); task.title = clip(b.title, 200); }
  if (b.details !== undefined) task.details = clip(b.details, 4000);
  if (b.due !== undefined) task.due = b.due ? new Date(b.due) : null;
  if (b.priority !== undefined && ["low", "normal", "high"].includes(b.priority)) task.priority = b.priority;
  if (b.status !== undefined && ["todo", "doing", "done"].includes(b.status)) { task.status = b.status; task.doneAt = b.status === "done" ? (task.doneAt || new Date()) : null; }
  await task.save();
  notifyTrainees(task.email, { type: "task-update", title: `Task updated: ${task.title}`, body: b.status ? `Status: ${{ todo: "To do", doing: "In progress", done: "Done" }[task.status]}` : "The team edited this task.", link: "/trainee/tasks" });
  res.json({ status: true, data: task, message: "Task updated" });
});

/* DELETE /api/admin/trainee-portal/tasks/:id */
export const adminDeleteTask = expressAsyncHandler(async (req, res) => {
  const gone = await TraineeTask.findByIdAndDelete(req.params.id);
  if (gone) traineeChanged(gone.email, "tasks");
  res.json({ status: true, message: "Task deleted" });
});

/* GET /api/admin/trainee-portal/notes */
export const adminNotes = expressAsyncHandler(async (req, res) => {
  res.json({ status: true, data: await TraineeMaterial.find({}).sort({ createdAt: -1 }).limit(500).lean() });
});

/* POST /api/admin/trainee-portal/notes (multipart: file?, title, details, kind, link, forAll, emails JSON) */
export const adminCreateNote = expressAsyncHandler(async (req, res) => {
  const b = req.body || {};
  const fail = (m) => { if (req.file) removeUpload(`resources/${req.file.filename}`); return res.status(400).json({ status: false, message: m }); };
  if (!clip(b.title)) return fail("Please add a title");
  const link = clip(b.link, 500);
  if (link && !/^https?:\/\//i.test(link)) return fail("The link should start with https://");
  if (!req.file && !link) return fail("Attach a file or add a link");
  const forAll = b.forAll !== "0" && b.forAll !== false;
  let emails = [];
  try { emails = JSON.parse(b.emails || "[]"); } catch { emails = []; }
  emails = (Array.isArray(emails) ? emails : []).map((e) => String(e).toLowerCase().trim()).filter(Boolean).slice(0, 500);
  if (!forAll && !emails.length) return fail("Choose who should get it");
  const note = await TraineeMaterial.create({
    title: clip(b.title, 200), details: clip(b.details, 2000), kind: ["worksheet", "ppt", "notes", "other"].includes(b.kind) ? b.kind : "notes",
    file: req.file ? `resources/${req.file.filename}` : "", fileName: req.file ? clip(req.file.originalname, 160) : "",
    link, forAll, emails: forAll ? [] : emails, sentBy: adminName(req),
  });
  notifyTrainees(forAll ? await allTraineeEmails() : emails, {
    type: "note", title: `New ${{ worksheet: "worksheet", ppt: "slides", notes: "notes", other: "file" }[note.kind]}: ${note.title}`,
    body: note.details.slice(0, 140), link: "/trainee/notes",
  });
  if (!forAll) {
    for (const e of emails) {
      mail(e, `New notes from CYT: ${note.title}`, `The CYT team has shared "${note.title}" with you. Open it in your trainee portal: ${PORTAL}/notes`,
        `<p>The CYT team has shared <b>${esc(note.title)}</b> with you.</p><p><a href="${PORTAL}/notes">Open your notes →</a></p>`);
    }
  }
  res.json({ status: true, data: note, message: forAll ? "Shared with all trainees" : `Shared with ${emails.length} trainee${emails.length === 1 ? "" : "s"}` });
});

/* DELETE /api/admin/trainee-portal/notes/:id */
export const adminDeleteNote = expressAsyncHandler(async (req, res) => {
  const note = await TraineeMaterial.findByIdAndDelete(req.params.id);
  if (note?.file) removeUpload(note.file);
  if (note) traineeChanged("*", "note");
  res.json({ status: true, message: "Removed" });
});

/* GET /api/admin/trainee-portal/certificates */
export const adminCertificates = expressAsyncHandler(async (req, res) => {
  res.json({ status: true, data: await TraineeCertificate.find({}).sort({ createdAt: -1 }).limit(1000).lean() });
});

/* POST /api/admin/trainee-portal/certificates (multipart: file (PDF), email, name, title, note) */
export const adminSendCertificate = expressAsyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!req.file) return res.status(400).json({ status: false, message: "Attach the certificate PDF" });
  const email = String(b.email || "").toLowerCase().trim();
  if (!email) { removeUpload(`resources/${req.file.filename}`); return res.status(400).json({ status: false, message: "Choose a trainee" }); }
  const cert = await TraineeCertificate.create({
    email, name: clip(b.name, 120), title: clip(b.title, 200) || "Internship Certificate", note: clip(b.note, 1000),
    file: `resources/${req.file.filename}`, sentBy: adminName(req),
  });
  mail(email, `Your ${cert.title} is ready`,
    `Hi ${cert.name || "there"}, congratulations! Your ${cert.title} from Choose Your Therapist is ready. Download it from your trainee portal: ${PORTAL}/certificate`,
    `<p>Hi ${esc(cert.name || "there")},</p><p>Congratulations! Your <b>${esc(cert.title)}</b> from Choose Your Therapist is ready.</p>${cert.note ? `<p>${esc(cert.note)}</p>` : ""}<p><a href="${PORTAL}/certificate">Download it from your trainee portal →</a></p>`);
  notifyTrainees(email, { type: "certificate", title: `Your ${cert.title} is ready`, body: "Download it from the Certificate page.", link: "/trainee/certificate" });
  res.json({ status: true, data: cert, message: "Certificate sent — the trainee has been emailed" });
});

/* DELETE /api/admin/trainee-portal/certificates/:id */
export const adminDeleteCertificate = expressAsyncHandler(async (req, res) => {
  const cert = await TraineeCertificate.findByIdAndDelete(req.params.id);
  if (cert?.file) removeUpload(cert.file);
  if (cert) traineeChanged(cert.email, "certificate");
  res.json({ status: true, message: "Certificate removed" });
});

/* ═════ Free plans / upgrades given by the CYT team ═════ */

const TRACKS = ["Clinical Psychology", "Counselling Psychology", "Industrial & Organizational Psychology", "Research & Data", "Content / Social Media", "Administrative / Operations", "Social Media & Outreach"];
const slugify = (name) => String(name || "trainee").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "trainee";

/* POST /api/admin/trainee-portal/grant
   { email, hours, kind: "free" | "paid", amount?, ref?, tracks?, mode?, note?, name?, phone? }
   Gives a trainee internship hours — free of charge, or recorded as already paid (offline / earlier).
   Upgrades an existing application; creates the internship for someone who only made a portal account;
   and with name (+ phone) adds a trainee who never signed up (their account is created, approved). */
export const adminGrantPlan = expressAsyncHandler(async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || "").toLowerCase().trim();
  const hours = String(b.hours || "");
  const paid = b.kind === "paid";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ status: false, message: "Enter a valid email" });
  if (!INTERN_FEES[hours]) return res.status(400).json({ status: false, message: "Choose a valid plan" });
  const note = clip(b.note, 300);
  const ref = clip(b.ref, 120);
  const by = adminName(req);
  const stamp = `${paid ? "admin-paid" : "admin-free"}-${Date.now()}`;
  const label = `by ${by}${paid ? ` · paid${ref ? ` (${ref})` : ""}` : ""}${note ? ` — ${note}` : ""}`;
  const app = await applicationOf({ email, traineeId: null });
  let message;
  let amount = 0;
  let confirmed = false;
  if (app && paid && hours === app.hours) {
    // "already paid" for the plan they chose — confirm the payment and give portal access (no upgrade)
    amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount < 0) amount = INTERN_FEES[hours] || 0;
    app.paymentStatus = "paid";
    if (app.paymentMethod !== "razorpay") app.paymentMethod = "offline-by-admin";
    app.programFee = Math.round(amount);
    if (ref) app.transactionId = ref;
    if (app.status === "pending" || app.status === "rejected") app.status = "active";
    app.upgrades = [...(app.upgrades || []), { from: hours, to: hours, amount: Math.round(amount), paymentId: ref ? `${stamp}:${ref}` : stamp, orderId: label, at: new Date() }];
    await app.save();
    // the portal account (if they made one) is approved too
    const name = app.name || "Trainee";
    if (!(await TraineeAccount.exists({ email }))) {
      await TraineeAccount.create({ ...splitName(name), email, phone: app.phone || "", verified: true, approval: "approved", reviewedAt: new Date(), reviewedBy: by });
    }
    confirmed = true;
    message = `Confirmed ${name}'s ${hours} plan as paid ₹${Math.round(amount)} — they can sign in now`;
  } else if (app) {
    if (hoursNum(hours) <= hoursNum(app.hours)) return res.status(400).json({ status: false, message: `They already have ${app.hours}. Choose a bigger plan${paid ? `, or ${app.hours} to confirm it as paid` : ""}.` });
    const from = app.hours;
    if (paid) {
      amount = Number(b.amount);
      if (!Number.isFinite(amount) || amount < 0) amount = INTERN_FEES[hours] || 0;
    }
    app.upgrades = [...(app.upgrades || []), { from, to: hours, amount: Math.round(amount), paymentId: ref && paid ? `${stamp}:${ref}` : stamp, orderId: label, at: new Date() }];
    app.hours = hours;
    app.duration = DURATION_OF[hours] || app.duration;
    if (paid) app.programFee = INTERN_FEES[hours];
    if (app.status === "pending" || app.status === "rejected") app.status = "active";
    await app.save();
    message = `Upgraded ${app.name} from ${from || "—"} to ${hours}${paid ? ` — recorded as paid ₹${Math.round(amount)}` : " — free"}`;
  } else {
    let acc = await TraineeAccount.findOne({ email });
    if (!acc) {
      const nm = clip(b.name, 120);
      if (nm.length < 2) return res.status(404).json({ status: false, message: "No trainee with this email — add their name to create them" });
      const phone = clip(b.phone, 16);
      if (phone && !/^[0-9+\-\s]{7,16}$/.test(phone)) return res.status(400).json({ status: false, message: "Enter a valid mobile number" });
      acc = await TraineeAccount.create({ ...splitName(nm), email, phone, verified: true, approval: "approved", reviewedAt: new Date(), reviewedBy: by });
    }
    const name = [acc.firstName, acc.lastName].filter(Boolean).join(" ") || "Trainee";
    const tracks = (Array.isArray(b.tracks) ? b.tracks : []).filter((t) => TRACKS.includes(t));
    if (!tracks.length) return res.status(400).json({ status: false, message: "Choose at least one track" });
    if (paid) {
      amount = Number(b.amount);
      if (!Number.isFinite(amount) || amount < 0) amount = INTERN_FEES[hours];
    }
    let slug = slugify(name);
    if (await Trainee.exists({ slug })) slug = `${slug}-${Date.now().toString().slice(-4)}`;
    await Trainee.create({
      slug, name, email, phone: acc.phone || "", city: acc.city || "", gender: acc.gender || "", dob: acc.dob || "",
      college: acc.college || "", degree: acc.course || "", year: acc.year || "",
      internType: tracks, mode: ["Online", "Offline"].includes(b.mode) ? b.mode : "Online",
      duration: DURATION_OF[hours], hours,
      programFee: paid ? Math.round(amount) : 0,
      paymentMethod: paid ? "offline-by-admin" : "free-by-admin",
      paymentStatus: paid ? "paid" : "free",
      transactionId: ref || `${paid ? "paid" : "free"} — ${label}`, status: "active",
      availableFrom: istDate(),
      upgrades: [{ from: "", to: hours, amount: Math.round(amount), paymentId: ref && paid ? `${stamp}:${ref}` : stamp, orderId: label, at: new Date() }],
    });
    message = paid ? `Added ${name} — ${hours}, recorded as paid ₹${Math.round(amount)}` : `Gave ${name} a free ${hours} internship`;
  }
  notifyTrainees(email, confirmed
    ? { type: "plan", title: `Your ${hours} plan is confirmed`, body: note || "Payment received — your internship is active.", link: "/trainee" }
    : paid
    ? { type: "plan", title: `Your internship plan: ${hours}`, body: note || `${hours} (${DURATION_OF[hours]}) is now active on your portal.`, link: "/trainee" }
    : { type: "plan", title: `You've got ${hours} free`, body: note || `The CYT team gave you ${hours} (${DURATION_OF[hours]}) of internship free of charge.`, link: "/trainee" });
  // giving a plan also lets a waiting account sign in
  await TraineeAccount.updateOne({ email, approval: "pending" }, { $set: { approval: "approved", reviewedAt: new Date(), reviewedBy: by } });
  const portal = "https://www.chooseyourtherapist.in/supervision-login";
  mail(email, confirmed ? `Your internship is confirmed — ${hours}` : paid ? `Your internship plan is active: ${hours}` : `Your internship plan: ${hours}`,
    paid
      ? `Your Choose Your Therapist internship plan ${hours} (${DURATION_OF[hours]}) is now active.${note ? ` ${note}` : ""} Sign in to your trainee portal with this email: ${portal}`
      : `Good news! The CYT team has given you ${hours} (${DURATION_OF[hours]}) of internship free of charge.${note ? ` ${note}` : ""} Sign in to your trainee portal with this email: ${portal}`,
    paid
      ? `<p>Your Choose Your Therapist internship plan <b>${esc(hours)}</b> (${esc(DURATION_OF[hours])}) is now active.</p>${note ? `<p>${esc(note)}</p>` : ""}<p>Sign in to your trainee portal with this email address:</p><p><a href="${portal}">Open the trainee portal →</a></p>`
      : `<p>Good news!</p><p>The CYT team has given you <b>${esc(hours)}</b> (${esc(DURATION_OF[hours])}) of internship <b>free of charge</b>.</p>${note ? `<p>${esc(note)}</p>` : ""}<p>Sign in to your trainee portal with this email address:</p><p><a href="${portal}">Open the trainee portal →</a></p>`);
  res.json({ status: true, message });
});

/* GET /api/admin/trainee-portal/grants — plans / upgrades added by the team (free or already paid) */
export const adminGrants = expressAsyncHandler(async (req, res) => {
  const apps = await Trainee.find({ "upgrades.paymentId": /^(free-|admin-)/ }, { name: 1, email: 1, hours: 1, upgrades: 1, paymentStatus: 1 }).sort({ updatedAt: -1 }).limit(500).lean();
  const rows = [];
  for (const a of apps) {
    for (const u of a.upgrades || []) {
      if (!/^(free-|admin-)/.test(u.paymentId || "")) continue;
      rows.push({ appId: String(a._id), paymentId: u.paymentId, name: a.name, email: a.email, from: u.from, to: u.to, amount: u.amount, kind: /^admin-paid/.test(u.paymentId) ? "paid" : "free", confirmed: !!u.from && u.from === u.to, by: u.orderId, at: u.at });
    }
  }
  rows.sort((x, y) => new Date(y.at) - new Date(x.at));
  res.json({ status: true, data: rows, tracks: TRACKS, fees: INTERN_FEES });
});

/* POST /api/admin/trainee-portal/grants/remove { appId, paymentId } — undo a plan the team added:
   a new internship made by the team is deleted; an upgrade goes back to the previous hours (latest one
   only); a confirmed payment goes back to "not verified". */
export const adminRemoveGrant = expressAsyncHandler(async (req, res) => {
  const { appId, paymentId } = req.body || {};
  if (!/^[a-f0-9]{24}$/i.test(String(appId || "")) || !paymentId) return res.status(400).json({ status: false, message: "Nothing to remove" });
  const app = await Trainee.findById(appId);
  const list = app?.upgrades || [];
  const idx = list.findIndex((u) => u.paymentId === paymentId);
  if (!app || idx < 0 || !/^(free-|admin-)/.test(paymentId)) return res.status(404).json({ status: false, message: "That entry is already gone" });
  const u = list[idx];
  const email = String(app.email || "").toLowerCase();
  let message;
  if (!u.from) {
    // a whole internship the team created — only when it was made here (never a real applicant's form)
    if (!["free-by-admin", "offline-by-admin"].includes(app.paymentMethod) || list.length > 1) {
      return res.status(400).json({ status: false, message: "Remove their later upgrades first" });
    }
    await Trainee.deleteOne({ _id: app._id });
    message = `Removed ${app.name}'s ${u.to} plan`;
  } else {
    if (idx !== list.length - 1) return res.status(400).json({ status: false, message: "Remove the newer change for this trainee first" });
    if (u.from === u.to) {
      app.paymentStatus = "unverified";
      if (app.paymentMethod === "offline-by-admin") app.paymentMethod = "upi-manual";
      message = `Undid the payment confirmation for ${app.name}`;
    } else {
      app.hours = u.from;
      app.duration = DURATION_OF[u.from] || app.duration;
      if (/^admin-paid/.test(paymentId)) app.programFee = INTERN_FEES[u.from] || app.programFee;
      message = `${app.name} is back on ${u.from}`;
    }
    app.upgrades = list.filter((_, i) => i !== idx);
    await app.save();
  }
  traineeChanged(email, "plan");
  res.json({ status: true, message });
});
