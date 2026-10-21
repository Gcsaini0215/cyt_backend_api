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
        startFrom: app.availableFrom, appliedAt: app.createdAt, paid: app.paymentStatus === "paid",
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
  res.json({ status: true, data: await profileOf(t), token: signTraineeToken(acc, app), message: "Profile saved" });
});

/* ═════════════ Upgrade internship hours ═════════════ */

const upgradeOptions = (current) => Object.entries(INTERN_FEES)
  .filter(([h]) => hoursNum(h) > hoursNum(current))
  .map(([h, fee]) => ({ hours: h, duration: DURATION_OF[h], fee, pay: fee - (INTERN_FEES[current] || 0) }));

/* GET /api/trainee-portal/upgrade */
export const upgradeInfo = expressAsyncHandler(async (req, res) => {
  const app = await applicationOf(req.trainee);
  if (!app) return res.json({ status: true, data: { application: false } });
  res.json({
    status: true,
    data: {
      application: true, paid: app.paymentStatus === "paid", hours: app.hours, duration: app.duration,
      fee: INTERN_FEES[app.hours] || app.programFee || 0, options: INTERN_FEES[app.hours] ? upgradeOptions(app.hours) : [],
      upgrades: app.upgrades || [],
    },
  });
});

/* POST /api/trainee-portal/upgrade/order { hours } — the amount is the fee difference, decided here */
export const upgradeOrder = expressAsyncHandler(async (req, res) => {
  const app = await applicationOf(req.trainee);
  if (!app) return res.status(400).json({ status: false, message: "Apply for the internship first." });
  const to = String(req.body?.hours || "");
  const opt = INTERN_FEES[app.hours] ? upgradeOptions(app.hours).find((o) => o.hours === to) : null;
  if (!opt || opt.pay <= 0) return res.status(400).json({ status: false, message: "Please choose a bigger plan than your current one." });
  const order = await getRazorpay().orders.create({
    amount: opt.pay * 100, currency: "INR", receipt: `intern_up_${Date.now()}`,
    notes: { purpose: "internship-upgrade", traineeId: String(app._id), from: app.hours, to },
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
  const pay = (INTERN_FEES[n.to] || 0) - (INTERN_FEES[n.from] || 0);
  if (n.purpose !== "internship-upgrade" || n.traineeId !== String(app._id) || n.from !== app.hours || pay <= 0 || order.amount !== pay * 100) {
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
  res.json({ status: true, data: app, message: `Upgraded to ${n.to}` });
});

/* ═════════════ Admin ═════════════ */

const adminName = (req) => String(req.user?.name || req.user?.email || "Admin");

/* GET /api/admin/trainee-portal/people — everyone who can use the portal, with today's attendance */
export const adminPeople = expressAsyncHandler(async (req, res) => {
  const [accs, apps] = await Promise.all([
    TraineeAccount.find({ approval: "approved" }, { firstName: 1, lastName: 1, email: 1, phone: 1, photo: 1 }).lean(),
    Trainee.find({ email: { $ne: "" }, status: { $ne: "rejected" } }, { name: 1, email: 1, phone: 1, hours: 1, status: 1 }).sort({ createdAt: -1 }).lean(),
  ]);
  const by = new Map();
  for (const a of apps) {
    const e = String(a.email).toLowerCase();
    if (!by.has(e)) by.set(e, { email: e, name: a.name, phone: a.phone, hours: a.hours, status: a.status });
  }
  for (const a of accs) {
    const e = a.email;
    const name = [a.firstName, a.lastName].filter(Boolean).join(" ");
    by.set(e, { ...(by.get(e) || { email: e, hours: "", status: "account" }), name: name || by.get(e)?.name, phone: a.phone || by.get(e)?.phone, photo: a.photo || "" });
  }
  await closeStale({});
  const today = await TraineeAttendance.find({ date: istDate() }).lean();
  const att = new Map(today.map((r) => [r.email, rowOut(r)]));
  const data = [...by.values()].map((p) => ({ ...p, today: att.get(p.email) || null })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
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
  res.json({ status: true, data: task, message: "Task updated" });
});

/* DELETE /api/admin/trainee-portal/tasks/:id */
export const adminDeleteTask = expressAsyncHandler(async (req, res) => {
  await TraineeTask.deleteOne({ _id: req.params.id });
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
  res.json({ status: true, data: cert, message: "Certificate sent — the trainee has been emailed" });
});

/* DELETE /api/admin/trainee-portal/certificates/:id */
export const adminDeleteCertificate = expressAsyncHandler(async (req, res) => {
  const cert = await TraineeCertificate.findByIdAndDelete(req.params.id);
  if (cert?.file) removeUpload(cert.file);
  res.json({ status: true, message: "Certificate removed" });
});
