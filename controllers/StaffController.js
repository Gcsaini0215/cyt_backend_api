// Staff system: attendance (check in / out), tasks, notices and performance for team members
// (admins with a Role), plus the manager side (super admin, or a role with the "staff" permission).
//
// Everything is in IST. Every change calls emitStaff() so open dashboards update live over SSE.
// Rupee figures are Super Admin only, like the rest of the admin API (see hideRevenueMiddleware.js):
// staff see counts, never money.

import expressAsyncHandler from "express-async-handler";
import Jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Admin from "../models/Admin.js";
import Role from "../models/Role.js";
import StaffAttendance from "../models/StaffAttendance.js";
import StaffTask from "../models/StaffTask.js";
import StaffNotice from "../models/StaffNotice.js";
import StaffSetting from "../models/StaffSetting.js";
import StaffLeave from "../models/StaffLeave.js";
import StaffWfh from "../models/StaffWfh.js";
import NoidaAppointment from "../models/NoidaAppointment.js";
import LeadActivity from "../models/LeadActivity.js";
import { addStaffClient, emitStaff } from "../services/staffEvents.js";
import { sendMail } from "../helper/mailer.js";
import { staffTaskMail, staffNoticeMail, staffLeaveRequestMail, staffLeaveDecisionMail, staffWfhRequestMail, staffWfhDecisionMail } from "../services/mailTemplates.js";

/* ── IST helpers ───────────────────────────────────────────────────────── */
const IST_MS = 330 * 60000;
const istDate = (d = new Date()) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const istMinutes = (d = new Date()) => Math.floor(((d.getTime() + IST_MS) / 60000) % 1440);
const hhmmToMin = (s) => { const [h, m] = String(s || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
// IST calendar date + "HH:MM" → UTC Date
const istToDate = (date, hhmm) => { const [y, mo, d] = date.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, d) - IST_MS + hhmmToMin(hhmm) * 60000); };
const dayStart = (date) => istToDate(date, "00:00");
const addDays = (date, n) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const monthOf = (date) => date.slice(0, 7);
const monthStartDate = (month) => `${month}-01`;
const nextMonthStart = (month) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); };
const weekStart = (date) => { const [y, m, d] = date.split("-").map(Number); const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return addDays(date, -((dow + 6) % 7)); }; // Monday
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const isId = (v) => mongoose.isValidObjectId(v);
const isSunday = (date) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0; };
// every date from..to inclusive (capped), optionally without Sundays
const datesBetween = (from, to, skipSundays = false) => {
  const out = [];
  for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) if (!skipSundays || !isSunday(d)) out.push(d);
  return out;
};

/* ── where people work ─────────────────────────────────────────────────── */
const cleanIp = (ip) => String(ip || "").replace(/^::ffff:/, "");
// metres between two lat/lng points
function distanceM(a, b) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
const officeConfigured = (s) => (s.office?.lat != null && s.office?.lng != null) || (s.officeIps || []).length > 0;
const weekday = (date) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
function modeOf(s, adminId) {
  const m = (s.modes || []).find((x) => String(x.admin) === String(adminId));
  return { mode: m?.mode || "office", wfhDays: m?.wfhDays || [] };
}
// may this person work from anywhere on `date`? (WFH mode, a hybrid WFH weekday, or an approved WFH request)
async function wfhAllowed(s, adminId, date) {
  const { mode, wfhDays } = modeOf(s, adminId);
  if (mode === "wfh") return { ok: true, why: "wfh" };
  if (mode === "hybrid" && wfhDays.includes(weekday(date))) return { ok: true, why: "hybrid" };
  if (await StaffWfh.exists({ admin: adminId, date, status: "approved" })) return { ok: true, why: "request" };
  return { ok: false, why: "" };
}
// is this request coming from the office? by office network, or by location within the radius
function atOffice(s, ip, loc) {
  const byIp = (s.officeIps || []).includes(cleanIp(ip));
  let distance = null;
  if (loc && s.office?.lat != null && s.office?.lng != null) distance = distanceM(loc, s.office);
  // allow for the phone's own uncertainty, up to 100 m
  const byLoc = distance != null && distance - Math.min(loc.acc || 0, 100) <= (s.office.radius || 200);
  return { inOffice: byIp || byLoc, byIp, distance };
}
function readLoc(body) {
  const lat = Number(body?.lat), lng = Number(body?.lng), acc = Number(body?.acc);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, acc: Number.isFinite(acc) ? Math.round(acc) : null };
}
const wfhOut = (w) => ({
  id: w._id, date: w.date, reason: w.reason, status: w.status, decisionNote: w.decisionNote, decidedAt: w.decidedAt, createdAt: w.createdAt,
  decidedBy: w.decidedBy?.name || "",
  admin: w.admin?._id ? { id: w.admin._id, name: w.admin.name, role: w.admin.roleId?.name || "" } : w.admin,
});

// Forgot to check out? Two hours after the shift ends the day is closed at the shift end time and flagged.
export async function autoCheckOut() {
  const s = await getSettings();
  const open = await StaffAttendance.find({ checkIn: { $ne: null }, checkOut: null });
  const touched = [];
  for (const row of open) {
    const end = istToDate(row.date, s.endTime);
    if (Date.now() < end.getTime() + 2 * 3600000) continue;
    row.checkOut = row.checkIn > end ? row.checkIn : end;
    row.autoOut = true;
    row.earlyMinutes = 0;
    await row.save();
    touched.push(row.admin);
  }
  if (touched.length) emitStaff("attendance", touched);
}
setInterval(() => { if (mongoose.connection.readyState === 1) autoCheckOut().catch((e) => console.error("auto check-out:", e?.message)); }, 10 * 60000).unref();

/* ── email (fire and forget: a slow or failed mail never blocks the action) ── */
function mailEach(people, subject, build) {
  const list = people.filter((p) => p?.email);
  if (!list.length) return;
  (async () => {
    for (const p of list) {
      try { await sendMail(p.email, subject, "", build(p), "CYT Team"); }
      catch (e) { console.error("staff mail failed:", p.email, e?.message); }
    }
  })();
}
// who approves leave: Super Admins + roles with the "staff" permission
async function managers() {
  const roles = await Role.find({ permissions: "staff" }).select("_id").lean();
  return Admin.find({ $or: [{ roleId: null }, { roleId: { $in: roles.map((r) => r._id) } }] }).select("name email").lean();
}
// approved leave covering a date range: { adminId: Set(dates) }
async function approvedLeaveDays(adminIds, from, to) {
  const rows = await StaffLeave.find({ admin: { $in: adminIds }, status: "approved", from: { $lte: to }, to: { $gte: from } }).lean();
  const out = {};
  rows.forEach((l) => {
    const set = out[String(l.admin)] || (out[String(l.admin)] = new Set());
    datesBetween(l.from < from ? from : l.from, l.to > to ? to : l.to).forEach((d) => set.add(d));
  });
  return out;
}
const leaveOut = (l) => ({
  id: l._id, from: l.from, to: l.to, halfDay: l.halfDay, type: l.type, reason: l.reason, days: l.days, status: l.status,
  decisionNote: l.decisionNote, decidedAt: l.decidedAt, createdAt: l.createdAt,
  decidedBy: l.decidedBy?.name || "",
  admin: l.admin?._id ? { id: l.admin._id, name: l.admin.name, role: l.admin.roleId?.name || "" } : l.admin,
});

async function getSettings() {
  let s = await StaffSetting.findOne({ key: "main" });
  if (!s) s = await StaffSetting.create({ key: "main" });
  return s;
}

function lateFor(checkIn, date, settings) {
  const mins = Math.round((checkIn.getTime() - istToDate(date, settings.startTime).getTime()) / 60000);
  return mins > (settings.graceMinutes || 0) ? mins : 0;
}

function workedMinutes(a, today) {
  if (!a?.checkIn) return 0;
  const end = a.checkOut || (a.date === today ? new Date() : null);
  return end ? Math.max(0, Math.round((end - a.checkIn) / 60000)) : 0;
}

/* ── auth ──────────────────────────────────────────────────────────────── */
// Any admin. Reads the token from the Authorization header, or ?token= for the EventSource stream
// (browsers can't set headers on it). Sets req.staff = { admin, isSuper, canManage, roleId }.
export const staffAuth = expressAsyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : (typeof req.query.token === "string" ? req.query.token : "");
  if (!token) { res.status(401); throw new Error("Not authorized, No token found"); }
  let decoded;
  try { decoded = Jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] }); }
  catch { res.status(401); throw new Error("Not authorized"); }
  if (decoded.role !== 2) { res.status(403); throw new Error("Admin access required"); }
  const admin = await Admin.findById(decoded.userId).select("name email designation profile roleId createdAt");
  if (!admin) { res.status(403); throw new Error("Admin not found"); }
  let canManage = !admin.roleId;
  if (admin.roleId) {
    const role = await Role.findById(admin.roleId).select("permissions");
    canManage = !!role?.permissions?.includes("staff");
  }
  req.staff = { admin, isSuper: !admin.roleId, canManage, roleId: admin.roleId };
  next();
});

export const staffManager = (req, res, next) => {
  if (!req.staff?.canManage) { res.status(403); return next(new Error("Access denied: missing permission 'staff'")); }
  next();
};

/* ── live stream ───────────────────────────────────────────────────────── */
// GET /api/staff/stream?token=
export const staffStream = (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // nginx: pass events through immediately
  });
  res.flushHeaders?.();
  res.write("retry: 3000\n\n");
  res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  const remove = addStaffClient(res, req.staff.admin._id, req.staff.canManage);
  req.on("close", remove);
};

/* ── performance ───────────────────────────────────────────────────────── */
// counts per admin between two UTC instants: { [adminId]: { bookings, paid, collections, leads } }
async function perfFor(adminIds, from, to) {
  const ids = adminIds.map((i) => new mongoose.Types.ObjectId(String(i)));
  const [appts, leads] = await Promise.all([
    NoidaAppointment.aggregate([
      { $match: { bookedByAdmin: { $in: ids }, status: "confirmed", createdAt: { $gte: from, $lt: to } } },
      { $group: {
        _id: "$bookedByAdmin",
        bookings: { $sum: 1 },
        paid: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, 1, 0] } },
        collections: { $sum: { $cond: [{ $eq: ["$paymentStatus", "paid"] }, "$amount", 0] } },
      } },
    ]),
    LeadActivity.aggregate([
      { $match: { admin: { $in: ids }, createdAt: { $gte: from, $lt: to } } },
      { $group: { _id: "$admin", leads: { $sum: 1 } } },
    ]),
  ]);
  const out = {};
  ids.forEach((i) => { out[String(i)] = { bookings: 0, paid: 0, collections: 0, leads: 0 }; });
  appts.forEach((a) => Object.assign(out[String(a._id)], { bookings: a.bookings, paid: a.paid, collections: a.collections }));
  leads.forEach((l) => { out[String(l._id)].leads = l.leads; });
  return out;
}

const noMoney = (p) => ({ bookings: p.bookings, paid: p.paid, leads: p.leads });

/* ── helpers for tasks / notices ───────────────────────────────────────── */
const PRIORITY_RANK = { high: 0, normal: 1, low: 2 };
function sortTasks(list, today) {
  return list.sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    if (a.status === "done") return (b.doneAt || 0) - (a.doneAt || 0);
    const ao = a.due && a.due < today ? 0 : 1, bo = b.due && b.due < today ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const ad = a.due || "9999", bd = b.due || "9999";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  });
}
const taskOut = (t) => ({
  id: t._id, title: t.title, note: t.note, due: t.due, priority: t.priority, status: t.status,
  doneAt: t.doneAt, doneNote: t.doneNote, createdAt: t.createdAt,
  assignee: t.assignee?._id ? { id: t.assignee._id, name: t.assignee.name } : t.assignee,
  createdBy: t.createdBy?._id ? { id: t.createdBy._id, name: t.createdBy.name } : t.createdBy,
});
const noticeVisibleTo = (roleId, isSuper) => (isSuper ? {} : { $or: [{ roles: { $size: 0 } }, { roles: roleId }] });

/* ── employee: my day ──────────────────────────────────────────────────── */
// GET /api/staff/me
export const getMyDay = expressAsyncHandler(async (req, res) => {
  const { admin, isSuper, canManage, roleId } = req.staff;
  const today = istDate();
  const month = monthOf(today);
  const settings = await getSettings();
  const nowUtc = new Date();

  const [monthRows, tasks, notices, perfToday, perfWeek, perfMonth, myLeaves, leaveDays, myWfh, wfhToday] = await Promise.all([
    StaffAttendance.find({ admin: admin._id, date: { $gte: monthStartDate(month), $lte: today } }).sort({ date: 1 }).lean(),
    StaffTask.find({ assignee: admin._id, $or: [{ status: "open" }, { doneAt: { $gte: new Date(Date.now() - 36 * 3600000) } }] })
      .populate("createdBy", "name").lean(),
    StaffNotice.find(noticeVisibleTo(roleId, isSuper)).sort({ createdAt: -1 }).limit(20).populate("createdBy", "name").lean(),
    perfFor([admin._id], dayStart(today), nowUtc),
    perfFor([admin._id], dayStart(weekStart(today)), nowUtc),
    perfFor([admin._id], dayStart(monthStartDate(month)), nowUtc),
    StaffLeave.find({ admin: admin._id, to: { $gte: addDays(today, -60) } }).sort({ from: -1 }).limit(20).populate("decidedBy", "name").lean(),
    approvedLeaveDays([admin._id], monthStartDate(month), addDays(nextMonthStart(month), -1)),
    StaffWfh.find({ admin: admin._id, date: { $gte: addDays(today, -30) } }).sort({ date: -1 }).limit(15).populate("decidedBy", "name").lean(),
    wfhAllowed(settings, admin._id, today),
  ]);
  const todayRow = monthRows.find((r) => r.date === today) || null;
  const work = modeOf(settings, admin._id);
  const target = settings.targets.find((t) => String(t.admin) === String(admin._id) && t.month === month) || null;
  const pick = (p) => (isSuper ? p[String(admin._id)] : noMoney(p[String(admin._id)]));

  res.json({
    status: true,
    data: {
      me: { id: admin._id, name: admin.name, designation: admin.designation || "", isSuper, canManage, joined: admin.createdAt ? istDate(admin.createdAt) : "" },
      settings: { startTime: settings.startTime, endTime: settings.endTime, graceMinutes: settings.graceMinutes },
      serverNow: nowUtc.toISOString(),
      today: todayRow && {
        date: todayRow.date, checkIn: todayRow.checkIn, checkOut: todayRow.checkOut, lateMinutes: todayRow.lateMinutes,
        inPlace: todayRow.inPlace, outPlace: todayRow.outPlace, earlyMinutes: todayRow.earlyMinutes, autoOut: todayRow.autoOut,
      },
      work: {
        mode: work.mode, wfhDays: work.wfhDays, wfhToday: wfhToday.ok, wfhWhy: wfhToday.why,
        officeCheck: settings.enforceOffice && officeConfigured(settings), // must check in from the office unless WFH today
      },
      wfh: myWfh.map(wfhOut),
      month: {
        month,
        present: monthRows.filter((r) => r.checkIn).length,
        late: monthRows.filter((r) => r.lateMinutes > 0).length,
        minutes: monthRows.reduce((s, r) => s + workedMinutes(r, today), 0),
        days: monthRows.map((r) => ({ date: r.date, checkIn: r.checkIn, checkOut: r.checkOut, lateMinutes: r.lateMinutes })),
        leaveDays: [...(leaveDays[String(admin._id)] || [])],
      },
      leaves: myLeaves.map(leaveOut),
      onLeaveToday: myLeaves.some((l) => l.status === "approved" && l.from <= today && l.to >= today),
      tasks: sortTasks(tasks, today).map(taskOut),
      notices: notices.map((n) => ({
        id: n._id, title: n.title, body: n.body, important: n.important, createdAt: n.createdAt,
        by: n.createdBy?.name || "", read: n.readBy.some((r) => String(r.admin) === String(admin._id)),
      })),
      perf: { today: pick(perfToday), week: pick(perfWeek), month: pick(perfMonth) },
      target: target && (isSuper ? { bookings: target.bookings, collections: target.collections, leads: target.leads } : { bookings: target.bookings, leads: target.leads }),
    },
  });
});

// POST /api/staff/check-in
// body: { lat, lng, acc } from the browser's location (optional unless the office check is on)
export const checkIn = expressAsyncHandler(async (req, res) => {
  const { admin } = req.staff;
  const today = istDate();
  const settings = await getSettings();
  const existing = await StaffAttendance.findOne({ admin: admin._id, date: today });
  if (existing?.checkIn) return res.json({ status: true, data: existing, message: "Already checked in" });
  const loc = readLoc(req.body);
  const wfh = await wfhAllowed(settings, admin._id, today);
  const where = atOffice(settings, req.ip, loc);
  const configured = officeConfigured(settings);
  if (settings.enforceOffice && configured && !wfh.ok && !where.inOffice) {
    const hasOfficeLoc = settings.office?.lat != null;
    return res.status(403).json({
      status: false,
      code: !loc && hasOfficeLoc ? "LOCATION_NEEDED" : "NOT_AT_OFFICE",
      distance: where.distance,
      message: !loc && hasOfficeLoc
        ? "Allow location access so we can confirm you're at the office."
        : `You're not at the office${where.distance != null ? ` (about ${where.distance >= 1000 ? `${(where.distance / 1000).toFixed(1)} km` : `${where.distance} m`} away)` : ""}. Check in from the office, or request work from home for today.`,
    });
  }
  const now = new Date();
  const place = where.inOffice ? "office" : wfh.ok ? "wfh" : configured ? "outside" : "unknown";
  const row = await StaffAttendance.findOneAndUpdate(
    { admin: admin._id, date: today },
    { $set: {
      checkIn: now, checkOut: null, lateMinutes: lateFor(now, today, settings),
      inPlace: place, inLoc: loc, inIp: cleanIp(req.ip), inDistance: where.distance, autoOut: false, earlyMinutes: 0,
    } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  emitStaff("attendance", [admin._id]);
  res.json({ status: true, data: row });
});

// POST /api/staff/check-out
export const checkOut = expressAsyncHandler(async (req, res) => {
  const { admin } = req.staff;
  const row = await StaffAttendance.findOne({ admin: admin._id, date: istDate() });
  if (!row?.checkIn) { res.status(400); throw new Error("You haven't checked in today."); }
  if (!row.checkOut) {
    const settings = await getSettings();
    const loc = readLoc(req.body);
    const where = atOffice(settings, req.ip, loc);
    const wfh = await wfhAllowed(settings, admin._id, row.date);
    row.checkOut = new Date();
    row.outLoc = loc;
    row.outPlace = where.inOffice ? "office" : wfh.ok ? "wfh" : officeConfigured(settings) ? "outside" : "unknown";
    // leaving more than 5 minutes before the shift ends counts as early
    const early = Math.round((istToDate(row.date, settings.endTime) - row.checkOut) / 60000);
    row.earlyMinutes = early > 5 ? early : 0;
    await row.save();
  }
  emitStaff("attendance", [admin._id]);
  res.json({ status: true, data: row });
});

// PATCH /api/staff/tasks/:id/status  { status: "open" | "done", doneNote? } — the assignee (or a manager)
export const setTaskStatus = expressAsyncHandler(async (req, res) => {
  const { admin, canManage } = req.staff;
  if (!isId(req.params.id)) { res.status(404); throw new Error("Task not found."); }
  const task = await StaffTask.findById(req.params.id);
  if (!task) { res.status(404); throw new Error("Task not found."); }
  if (!canManage && String(task.assignee) !== String(admin._id)) { res.status(403); throw new Error("This isn't your task."); }
  const done = req.body?.status === "done";
  task.status = done ? "done" : "open";
  task.doneAt = done ? new Date() : null;
  if (typeof req.body?.doneNote === "string") task.doneNote = req.body.doneNote.slice(0, 1000);
  await task.save();
  emitStaff("tasks", [task.assignee]);
  res.json({ status: true, data: taskOut(task) });
});

// POST /api/staff/notices/:id/read
export const readNotice = expressAsyncHandler(async (req, res) => {
  const { admin } = req.staff;
  if (!isId(req.params.id)) { res.status(404); throw new Error("Notice not found."); }
  await StaffNotice.updateOne(
    { _id: req.params.id, "readBy.admin": { $ne: admin._id } },
    { $push: { readBy: { admin: admin._id, at: new Date() } } },
  );
  emitStaff("notices", [admin._id]);
  res.json({ status: true });
});

/* ── manager ───────────────────────────────────────────────────────────── */
async function staffRoster() {
  return Admin.find({ roleId: { $ne: null } }).select("name email designation profile roleId createdAt").populate("roleId", "name color").sort({ name: 1 }).lean();
}

// GET /api/staff/team — today's live board: every team member's attendance, tasks and month performance
export const getTeam = expressAsyncHandler(async (req, res) => {
  const { isSuper } = req.staff;
  const today = istDate();
  const month = monthOf(today);
  const [roster, settings] = await Promise.all([staffRoster(), getSettings()]);
  const ids = roster.map((a) => a._id);
  const [att, tasks, perfToday, perfMonth, leaveToday, pendingLeaves, pendingWfh, wfhToday] = await Promise.all([
    StaffAttendance.find({ admin: { $in: ids }, date: today }).lean(),
    StaffTask.find({ assignee: { $in: ids }, $or: [{ status: "open" }, { doneAt: { $gte: dayStart(today) } }] }).select("assignee status due doneAt").lean(),
    perfFor(ids, dayStart(today), new Date()),
    perfFor(ids, dayStart(monthStartDate(month)), new Date()),
    approvedLeaveDays(ids, today, today),
    StaffLeave.countDocuments({ status: "pending" }),
    StaffWfh.countDocuments({ status: "pending" }),
    StaffWfh.find({ admin: { $in: ids }, date: today, status: "approved" }).select("admin").lean(),
  ]);
  const wfhReq = new Set(wfhToday.map((w) => String(w.admin)));
  const attBy = new Map(att.map((a) => [String(a.admin), a]));
  const nowMin = istMinutes();
  const lateCutoff = hhmmToMin(settings.startTime) + (settings.graceMinutes || 0);
  const staff = roster.map((a) => {
    const id = String(a._id);
    const row = attBy.get(id);
    const mine = tasks.filter((t) => String(t.assignee) === id);
    const target = settings.targets.find((t) => String(t.admin) === id && t.month === month) || null;
    const state = row?.checkOut ? "out" : row?.checkIn ? "in" : leaveToday[id] ? "leave" : nowMin > lateCutoff ? "absent" : "notyet";
    return {
      id, name: a.name, email: a.email, designation: a.designation || "", profile: a.profile,
      role: a.roleId ? { name: a.roleId.name, color: a.roleId.color } : null,
      state,
      checkIn: row?.checkIn || null, checkOut: row?.checkOut || null, lateMinutes: row?.lateMinutes || 0,
      minutes: workedMinutes(row, today),
      inPlace: row?.inPlace || "", outPlace: row?.outPlace || "", earlyMinutes: row?.earlyMinutes || 0, autoOut: !!row?.autoOut,
      inLoc: row?.inLoc?.lat != null ? row.inLoc : null, inDistance: row?.inDistance ?? null,
      mode: modeOf(settings, id).mode,
      wfhToday: (() => { const m = modeOf(settings, id); return m.mode === "wfh" || (m.mode === "hybrid" && m.wfhDays.includes(weekday(today))) || wfhReq.has(id); })(),
      tasks: {
        open: mine.filter((t) => t.status === "open").length,
        overdue: mine.filter((t) => t.status === "open" && t.due && t.due < today).length,
        doneToday: mine.filter((t) => t.status === "done").length,
      },
      today: isSuper ? perfToday[id] : noMoney(perfToday[id]),
      month: isSuper ? perfMonth[id] : noMoney(perfMonth[id]),
      target: target && (isSuper ? { bookings: target.bookings, collections: target.collections, leads: target.leads } : { bookings: target.bookings, leads: target.leads }),
    };
  });
  res.json({
    status: true,
    data: {
      date: today, serverNow: new Date().toISOString(), isSuper,
      settings: { startTime: settings.startTime, endTime: settings.endTime, graceMinutes: settings.graceMinutes },
      summary: {
        total: staff.length,
        in: staff.filter((s) => s.state === "in").length,
        out: staff.filter((s) => s.state === "out").length,
        late: staff.filter((s) => s.lateMinutes > 0).length,
        absent: staff.filter((s) => s.state === "absent").length,
        leave: staff.filter((s) => s.state === "leave").length,
        early: staff.filter((s) => s.earlyMinutes > 0).length,
        outside: staff.filter((s) => s.inPlace === "outside").length,
        pendingLeaves,
        pendingWfh,
      },
      staff,
    },
  });
});

// GET /api/staff/attendance?month=YYYY-MM — month grid for every team member
export const getAttendance = expressAsyncHandler(async (req, res) => {
  const today = istDate();
  const month = MONTH_RE.test(req.query.month || "") ? req.query.month : monthOf(today);
  const first = monthStartDate(month);
  const last = addDays(nextMonthStart(month), -1);
  const until = last < today ? last : today;
  const roster = await staffRoster();
  const [rows, leaves] = await Promise.all([
    StaffAttendance.find({ admin: { $in: roster.map((a) => a._id) }, date: { $gte: first, $lte: last } }).lean(),
    approvedLeaveDays(roster.map((a) => a._id), first, last),
  ]);
  const days = [];
  for (let d = first; d <= until; d = addDays(d, 1)) days.push(d);
  const staff = roster.map((a) => {
    const mine = rows.filter((r) => String(r.admin) === String(a._id));
    const records = {};
    mine.forEach((r) => { records[r.date] = { checkIn: r.checkIn, checkOut: r.checkOut, lateMinutes: r.lateMinutes, note: r.note, edited: !!r.editedBy, place: r.inPlace || "", early: r.earlyMinutes || 0, autoOut: !!r.autoOut }; });
    return {
      id: a._id, name: a.name, role: a.roleId?.name || "", joined: a.createdAt ? istDate(a.createdAt) : "",
      leaveDays: [...(leaves[String(a._id)] || [])],
      present: mine.filter((r) => r.checkIn).length,
      late: mine.filter((r) => r.lateMinutes > 0).length,
      minutes: mine.reduce((s, r) => s + workedMinutes(r, today), 0),
      records,
    };
  });
  res.json({ status: true, data: { month, days, staff } });
});

// PATCH /api/staff/attendance  { admin, date, checkIn: "HH:MM"|"", checkOut: "HH:MM"|"", note }
// Manager correction. Both times empty = remove the day (absent).
export const editAttendance = expressAsyncHandler(async (req, res) => {
  const { admin: adminId, date, checkIn: inT = "", checkOut: outT = "", note = "" } = req.body || {};
  if (!isId(adminId) || !DATE_RE.test(date || "")) { res.status(400); throw new Error("Pick a staff member and a date."); }
  if ((inT && !TIME_RE.test(inT)) || (outT && !TIME_RE.test(outT))) { res.status(400); throw new Error("Times must be HH:MM."); }
  if (outT && !inT) { res.status(400); throw new Error("Add a check-in time first."); }
  if (inT && outT && hhmmToMin(outT) <= hhmmToMin(inT)) { res.status(400); throw new Error("Check-out must be after check-in."); }
  if (!inT && !outT) {
    await StaffAttendance.deleteOne({ admin: adminId, date });
  } else {
    const settings = await getSettings();
    const ci = istToDate(date, inT);
    await StaffAttendance.findOneAndUpdate(
      { admin: adminId, date },
      { $set: { checkIn: ci, checkOut: outT ? istToDate(date, outT) : null, lateMinutes: lateFor(ci, date, settings), note: String(note).slice(0, 300), editedBy: req.staff.admin._id } },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }
  emitStaff("attendance", [adminId]);
  res.json({ status: true });
});

// GET /api/staff/tasks?admin=&status=open|done|all
export const listTasks = expressAsyncHandler(async (req, res) => {
  const q = {};
  if (isId(req.query.admin)) q.assignee = req.query.admin;
  const status = req.query.status || "open";
  if (status === "open" || status === "done") q.status = status;
  const tasks = await StaffTask.find(q).populate("assignee", "name").populate("createdBy", "name").sort({ createdAt: -1 }).limit(300).lean();
  res.json({ status: true, data: sortTasks(tasks, istDate()).map(taskOut) });
});

// POST /api/staff/tasks  { title, note, assignees: [id] | assignee, due, priority }
export const createTask = expressAsyncHandler(async (req, res) => {
  const { title, note = "", due = "", priority = "normal" } = req.body || {};
  const assignees = (Array.isArray(req.body?.assignees) ? req.body.assignees : [req.body?.assignee]).filter(isId);
  if (!String(title || "").trim()) { res.status(400); throw new Error("Write what the task is."); }
  if (!assignees.length) { res.status(400); throw new Error("Pick who the task is for."); }
  if (due && !DATE_RE.test(due)) { res.status(400); throw new Error("Bad due date."); }
  const valid = await Admin.find({ _id: { $in: assignees } }).select("_id");
  if (!valid.length) { res.status(400); throw new Error("Staff member not found."); }
  const docs = await StaffTask.insertMany(valid.map((a) => ({
    title: String(title).trim().slice(0, 200), note: String(note).slice(0, 2000), due,
    priority: ["low", "normal", "high"].includes(priority) ? priority : "normal",
    assignee: a._id, createdBy: req.staff.admin._id,
  })));
  emitStaff("tasks", valid.map((a) => a._id));
  const people = await Admin.find({ _id: { $in: valid.map((a) => a._id) } }).select("name email").lean();
  const t = docs[0];
  mailEach(people, `New task: ${t.title}`, (p) => staffTaskMail({ name: p.name, title: t.title, note: t.note, due: t.due, priority: t.priority, by: req.staff.admin.name }));
  res.json({ status: true, data: docs.map(taskOut) });
});

// PATCH /api/staff/tasks/:id  { title, note, due, priority, assignee }
export const updateTask = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) { res.status(404); throw new Error("Task not found."); }
  const task = await StaffTask.findById(req.params.id);
  if (!task) { res.status(404); throw new Error("Task not found."); }
  const before = task.assignee;
  const b = req.body || {};
  if (typeof b.title === "string" && b.title.trim()) task.title = b.title.trim().slice(0, 200);
  if (typeof b.note === "string") task.note = b.note.slice(0, 2000);
  if (typeof b.due === "string" && (b.due === "" || DATE_RE.test(b.due))) task.due = b.due;
  if (["low", "normal", "high"].includes(b.priority)) task.priority = b.priority;
  if (isId(b.assignee) && (await Admin.exists({ _id: b.assignee }))) task.assignee = b.assignee;
  await task.save();
  emitStaff("tasks", [before, task.assignee]);
  res.json({ status: true, data: taskOut(task) });
});

// DELETE /api/staff/tasks/:id
export const deleteTask = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) { res.status(404); throw new Error("Task not found."); }
  const task = await StaffTask.findByIdAndDelete(req.params.id);
  if (task) emitStaff("tasks", [task.assignee]);
  res.json({ status: true });
});

// GET /api/staff/notices — with who has read each one
export const listNotices = expressAsyncHandler(async (req, res) => {
  const [notices, roster] = await Promise.all([
    StaffNotice.find({}).sort({ createdAt: -1 }).limit(100).populate("createdBy", "name").populate("roles", "name").lean(),
    staffRoster(),
  ]);
  const names = new Map(roster.map((a) => [String(a._id), a.name]));
  res.json({
    status: true,
    data: notices.map((n) => {
      const audience = roster.filter((a) => !n.roles.length || n.roles.some((r) => String(r._id) === String(a.roleId?._id)));
      const readIds = new Set(n.readBy.map((r) => String(r.admin)));
      return {
        id: n._id, title: n.title, body: n.body, important: n.important, createdAt: n.createdAt, by: n.createdBy?.name || "",
        roles: n.roles.map((r) => ({ id: r._id, name: r.name })),
        audience: audience.length,
        read: n.readBy.filter((r) => names.has(String(r.admin))).map((r) => ({ name: names.get(String(r.admin)), at: r.at })),
        unread: audience.filter((a) => !readIds.has(String(a._id))).map((a) => a.name),
      };
    }),
  });
});

// POST /api/staff/notices  { title, body, roles: [roleId], important }
export const createNotice = expressAsyncHandler(async (req, res) => {
  const { title, body = "", roles = [], important = false } = req.body || {};
  if (!String(title || "").trim()) { res.status(400); throw new Error("Give the notice a title."); }
  const n = await StaffNotice.create({
    title: String(title).trim().slice(0, 160), body: String(body).slice(0, 4000),
    roles: (Array.isArray(roles) ? roles : []).filter(isId), important: !!important, createdBy: req.staff.admin._id,
  });
  emitStaff("notices");
  const audience = await Admin.find(n.roles.length ? { roleId: { $in: n.roles } } : { roleId: { $ne: null } }).select("name email").lean();
  mailEach(audience, `${n.important ? "Important: " : ""}${n.title}`, (p) => staffNoticeMail({ name: p.name, title: n.title, body: n.body, important: n.important, by: req.staff.admin.name }));
  res.json({ status: true, data: { id: n._id } });
});

// DELETE /api/staff/notices/:id
export const deleteNotice = expressAsyncHandler(async (req, res) => {
  if (isId(req.params.id)) await StaffNotice.deleteOne({ _id: req.params.id });
  emitStaff("notices");
  res.json({ status: true });
});

// GET /api/staff/settings — office hours, the roster and this month's targets
export const getStaffSettings = expressAsyncHandler(async (req, res) => {
  const month = MONTH_RE.test(req.query.month || "") ? req.query.month : monthOf(istDate());
  const [s, roster, roles] = await Promise.all([getSettings(), staffRoster(), Role.find({}).select("name color").sort({ name: 1 }).lean()]);
  res.json({
    status: true,
    data: {
      startTime: s.startTime, endTime: s.endTime, graceMinutes: s.graceMinutes, month,
      office: { lat: s.office?.lat ?? null, lng: s.office?.lng ?? null, radius: s.office?.radius || 200 },
      officeIps: s.officeIps || [], enforceOffice: !!s.enforceOffice, yourIp: cleanIp(req.ip),
      roles: roles.map((r) => ({ id: r._id, name: r.name, color: r.color })),
      staff: roster.map((a) => {
        const t = s.targets.find((x) => String(x.admin) === String(a._id) && x.month === month);
        const m = modeOf(s, a._id);
        return { id: a._id, name: a.name, role: a.roleId?.name || "", mode: m.mode, wfhDays: m.wfhDays, target: t ? { bookings: t.bookings, collections: req.staff.isSuper ? t.collections : undefined, leads: t.leads } : null };
      }),
    },
  });
});

// PUT /api/staff/settings  { startTime, endTime, graceMinutes, office, officeIps, enforceOffice, modes }
const isIp = (ip) => (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip.split(".").every((n) => Number(n) <= 255) : /^[0-9a-f:]{2,39}$/i.test(ip) && ip.includes(":"));
export const updateStaffSettings = expressAsyncHandler(async (req, res) => {
  const { startTime, endTime, graceMinutes, office, officeIps, enforceOffice, modes } = req.body || {};
  const s = await getSettings();
  if (startTime !== undefined) { if (!TIME_RE.test(startTime)) { res.status(400); throw new Error("Start time must be HH:MM."); } s.startTime = startTime; }
  if (endTime !== undefined) { if (!TIME_RE.test(endTime)) { res.status(400); throw new Error("End time must be HH:MM."); } s.endTime = endTime; }
  if (graceMinutes !== undefined) s.graceMinutes = Math.max(0, Math.min(180, Number(graceMinutes) || 0));
  if (office !== undefined) {
    const loc = office && readLoc(office);
    s.office = { lat: loc ? loc.lat : null, lng: loc ? loc.lng : null, radius: Math.max(50, Math.min(2000, Number(office?.radius) || 200)) };
  }
  if (Array.isArray(officeIps)) {
    const clean = [...new Set(officeIps.map(cleanIp).map((x) => x.trim()).filter(Boolean))];
    if (clean.some((ip) => !isIp(ip))) { res.status(400); throw new Error("One of the network addresses isn't valid."); }
    s.officeIps = clean.slice(0, 20);
  }
  if (enforceOffice !== undefined) s.enforceOffice = !!enforceOffice;
  if (Array.isArray(modes)) {
    modes.forEach((m) => {
      if (!isId(m?.admin) || !["office", "wfh", "hybrid"].includes(m.mode)) return;
      const wfhDays = (Array.isArray(m.wfhDays) ? m.wfhDays : []).map(Number).filter((d) => d >= 0 && d <= 6);
      const cur = s.modes.find((x) => String(x.admin) === String(m.admin));
      if (cur) { cur.mode = m.mode; cur.wfhDays = wfhDays; } else s.modes.push({ admin: m.admin, mode: m.mode, wfhDays });
    });
  }
  if (s.enforceOffice && !officeConfigured(s)) { res.status(400); throw new Error("Set the office location or office network first."); }
  await s.save();
  emitStaff("settings");
  res.json({ status: true });
});

// PUT /api/staff/targets  { admin, month, bookings, collections, leads }
export const setTarget = expressAsyncHandler(async (req, res) => {
  const { admin, month } = req.body || {};
  if (!isId(admin) || !MONTH_RE.test(month || "")) { res.status(400); throw new Error("Pick a staff member and month."); }
  const n = (v) => Math.max(0, Math.round(Number(v) || 0));
  const s = await getSettings();
  const existing = s.targets.find((t) => String(t.admin) === String(admin) && t.month === month);
  const next = { bookings: n(req.body.bookings), leads: n(req.body.leads) };
  // only a Super Admin sets money targets; a manager's save keeps the existing one
  next.collections = req.staff.isSuper ? n(req.body.collections) : existing?.collections || 0;
  if (existing) Object.assign(existing, next);
  else s.targets.push({ admin, month, ...next });
  await s.save();
  emitStaff("settings", [admin]);
  res.json({ status: true });
});

/* ── leave ─────────────────────────────────────────────────────────────── */
const LEAVE_TYPES = ["casual", "sick", "emergency", "other"];

// POST /api/staff/leaves  { from, to, halfDay, type, reason } — a team member applies
export const applyLeave = expressAsyncHandler(async (req, res) => {
  const { admin } = req.staff;
  const { from, to = from, halfDay = false, type = "casual", reason = "" } = req.body || {};
  const today = istDate();
  if (!DATE_RE.test(from || "") || !DATE_RE.test(to || "")) { res.status(400); throw new Error("Pick the leave dates."); }
  if (to < from) { res.status(400); throw new Error("The end date can't be before the start date."); }
  if (from < addDays(today, -30)) { res.status(400); throw new Error("Leave can be applied up to 30 days back."); }
  if (datesBetween(from, to).length > 60) { res.status(400); throw new Error("Apply for at most 60 days at a time."); }
  const workDays = datesBetween(from, to, true).length;
  if (!workDays) { res.status(400); throw new Error("Those dates are all Sundays."); }
  if (!String(reason).trim()) { res.status(400); throw new Error("Please write a short reason."); }
  const clash = await StaffLeave.exists({ admin: admin._id, status: { $in: ["pending", "approved"] }, from: { $lte: to }, to: { $gte: from } });
  if (clash) { res.status(400); throw new Error("You already have leave on some of these dates."); }
  const leave = await StaffLeave.create({
    admin: admin._id, from, to, halfDay: !!halfDay && from === to,
    type: LEAVE_TYPES.includes(type) ? type : "other", reason: String(reason).trim().slice(0, 1000), days: workDays,
  });
  emitStaff("leaves", [admin._id]);
  const approvers = (await managers()).filter((m) => String(m._id) !== String(admin._id));
  mailEach(approvers, `Leave request: ${admin.name}`, (m) => staffLeaveRequestMail({ managerName: m.name, staffName: admin.name, leave }));
  res.json({ status: true, data: leaveOut(leave) });
});

// DELETE /api/staff/leaves/:id — cancel your own request (pending, or approved and not started yet)
export const cancelLeave = expressAsyncHandler(async (req, res) => {
  const { admin } = req.staff;
  if (!isId(req.params.id)) { res.status(404); throw new Error("Leave not found."); }
  const leave = await StaffLeave.findOne({ _id: req.params.id, admin: admin._id });
  if (!leave) { res.status(404); throw new Error("Leave not found."); }
  const canCancel = leave.status === "pending" || (leave.status === "approved" && leave.from > istDate());
  if (!canCancel) { res.status(400); throw new Error("This leave can't be cancelled any more."); }
  leave.status = "cancelled";
  await leave.save();
  emitStaff("leaves", [admin._id]);
  res.json({ status: true });
});

// GET /api/staff/leaves?status=pending|all — manager
export const listLeaves = expressAsyncHandler(async (req, res) => {
  const q = req.query.status === "pending" ? { status: "pending" } : {};
  const list = await StaffLeave.find(q).sort({ createdAt: -1 }).limit(200)
    .populate({ path: "admin", select: "name roleId", populate: { path: "roleId", select: "name" } })
    .populate("decidedBy", "name").lean();
  const order = { pending: 0, approved: 1, rejected: 2, cancelled: 3 };
  list.sort((a, b) => order[a.status] - order[b.status] || (a.status === "pending" ? (a.from < b.from ? -1 : 1) : (a.from < b.from ? 1 : -1)));
  res.json({ status: true, data: list.map(leaveOut) });
});

// PATCH /api/staff/leaves/:id  { status: "approved" | "rejected", note } — manager
export const decideLeave = expressAsyncHandler(async (req, res) => {
  const { status, note = "" } = req.body || {};
  if (!["approved", "rejected"].includes(status)) { res.status(400); throw new Error("Approve or reject."); }
  if (!isId(req.params.id)) { res.status(404); throw new Error("Leave not found."); }
  const leave = await StaffLeave.findById(req.params.id);
  if (!leave || leave.status === "cancelled") { res.status(404); throw new Error("This request was cancelled."); }
  if (String(leave.admin) === String(req.staff.admin._id)) { res.status(403); throw new Error("Someone else has to decide your own leave."); }
  leave.status = status;
  leave.decidedBy = req.staff.admin._id;
  leave.decidedAt = new Date();
  leave.decisionNote = String(note).trim().slice(0, 500);
  await leave.save();
  emitStaff("leaves", [leave.admin]);
  const person = await Admin.findById(leave.admin).select("name email").lean();
  mailEach([person], status === "approved" ? "Your leave is approved" : "Your leave request wasn't approved",
    (p) => staffLeaveDecisionMail({ name: p.name, leave, approved: status === "approved", by: req.staff.admin.name, decisionNote: leave.decisionNote }));
  res.json({ status: true });
});

/* ── work from home requests ───────────────────────────────────────────── */
// POST /api/staff/wfh  { date, reason } — a team member asks to work from home one day
export const applyWfh = expressAsyncHandler(async (req, res) => {
  const { admin } = req.staff;
  const { date, reason = "" } = req.body || {};
  const today = istDate();
  if (!DATE_RE.test(date || "")) { res.status(400); throw new Error("Pick the day."); }
  if (date < today) { res.status(400); throw new Error("Pick today or a later day."); }
  if (date > addDays(today, 30)) { res.status(400); throw new Error("You can ask up to 30 days ahead."); }
  if (!String(reason).trim()) { res.status(400); throw new Error("Please write a short reason."); }
  if (await StaffWfh.exists({ admin: admin._id, date, status: { $in: ["pending", "approved"] } })) { res.status(400); throw new Error("You've already asked for this day."); }
  if (await StaffLeave.exists({ admin: admin._id, status: "approved", from: { $lte: date }, to: { $gte: date } })) { res.status(400); throw new Error("You're on leave that day."); }
  const w = await StaffWfh.create({ admin: admin._id, date, reason: String(reason).trim().slice(0, 1000) });
  emitStaff("wfh", [admin._id]);
  const approvers = (await managers()).filter((m) => String(m._id) !== String(admin._id));
  mailEach(approvers, `Work from home request: ${admin.name}`, (m) => staffWfhRequestMail({ managerName: m.name, staffName: admin.name, date, reason: w.reason }));
  res.json({ status: true, data: wfhOut(w) });
});

// DELETE /api/staff/wfh/:id — cancel your own request (pending, or approved for a later day)
export const cancelWfh = expressAsyncHandler(async (req, res) => {
  const { admin } = req.staff;
  if (!isId(req.params.id)) { res.status(404); throw new Error("Request not found."); }
  const w = await StaffWfh.findOne({ _id: req.params.id, admin: admin._id });
  if (!w) { res.status(404); throw new Error("Request not found."); }
  if (!(w.status === "pending" || (w.status === "approved" && w.date > istDate()))) { res.status(400); throw new Error("This request can't be cancelled any more."); }
  w.status = "cancelled";
  await w.save();
  emitStaff("wfh", [admin._id]);
  res.json({ status: true });
});

// GET /api/staff/wfh?status=pending|all — manager
export const listWfh = expressAsyncHandler(async (req, res) => {
  const q = req.query.status === "pending" ? { status: "pending" } : {};
  const list = await StaffWfh.find(q).sort({ date: -1 }).limit(200)
    .populate({ path: "admin", select: "name roleId", populate: { path: "roleId", select: "name" } })
    .populate("decidedBy", "name").lean();
  const order = { pending: 0, approved: 1, rejected: 2, cancelled: 3 };
  list.sort((a, b) => order[a.status] - order[b.status] || (a.status === "pending" ? (a.date < b.date ? -1 : 1) : (a.date < b.date ? 1 : -1)));
  res.json({ status: true, data: list.map(wfhOut) });
});

// PATCH /api/staff/wfh/:id  { status: "approved" | "rejected", note } — manager
export const decideWfh = expressAsyncHandler(async (req, res) => {
  const { status, note = "" } = req.body || {};
  if (!["approved", "rejected"].includes(status)) { res.status(400); throw new Error("Approve or reject."); }
  if (!isId(req.params.id)) { res.status(404); throw new Error("Request not found."); }
  const w = await StaffWfh.findById(req.params.id);
  if (!w || w.status === "cancelled") { res.status(404); throw new Error("This request was cancelled."); }
  if (String(w.admin) === String(req.staff.admin._id)) { res.status(403); throw new Error("Someone else has to decide your own request."); }
  w.status = status;
  w.decidedBy = req.staff.admin._id;
  w.decidedAt = new Date();
  w.decisionNote = String(note).trim().slice(0, 500);
  await w.save();
  emitStaff("wfh", [w.admin]);
  const person = await Admin.findById(w.admin).select("name email").lean();
  mailEach([person], status === "approved" ? "Work from home approved" : "Work from home not approved",
    (p) => staffWfhDecisionMail({ name: p.name, date: w.date, approved: status === "approved", by: req.staff.admin.name, decisionNote: w.decisionNote }));
  res.json({ status: true });
});
