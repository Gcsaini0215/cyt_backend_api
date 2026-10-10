import crypto from "crypto";
import mongoose from "mongoose";
import expressAsyncHandler from "express-async-handler";
import CollabApplication from "../models/CollabApplication.js";
import CollabRoomSlot from "../models/CollabRoomSlot.js";
import CollabEmailOtp from "../models/CollabEmailOtp.js";
import { sendMail } from "../helper/mailer.js";
import { generate6DigitOTP } from "../helper/generate.js";
import { otpVerificationEmail, collabApplicationReceivedMail, collabStatusMail, collabHoursMail } from "../services/mailTemplates.js";

// Professionals collaborating at CYT Noida: public application form → admin screening →
// clash-free hours in the single collaboration room. Booking basis, 70:30, weekly payout.

export const COLLAB_TERMS = { professionalShare: 70, cytShare: 30, payout: "weekly" };
// bookable hours of the room: slot start hours, 8 AM … 8 PM (last slot ends 9 PM)
export const ROOM_HOURS = Array.from({ length: 13 }, (_, i) => 8 + i);
const STATUSES = ["new", "screening", "approved", "rejected", "on_hold"];
const OPEN_STATUSES = ["new", "screening", "approved", "on_hold"];
const STATUS_LABEL = { new: "New", screening: "Screening", approved: "Approved", on_hold: "On hold", rejected: "Rejected" };
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TEAM_INBOX = "hello@chooseyourtherapist.in";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cleanList = (v, max = 12) => (Array.isArray(v) ? v : String(v || "").split(","))
  .map((s) => String(s).trim()).filter(Boolean).slice(0, max).map((s) => s.slice(0, 60));
const firstName = (n) => String(n || "").trim().split(/\s+/).find((w) => !/^(dr|prof|mr|mrs|ms)\.?$/i.test(w)) || "there";
const hourLabel = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;

function cleanAvailability(list) {
  if (!Array.isArray(list)) return [];
  const byDay = new Map();
  for (const a of list) {
    const day = Number(a?.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    const hours = (Array.isArray(a.hours) ? a.hours : []).map(Number).filter((h) => ROOM_HOURS.includes(h));
    if (!hours.length) continue;
    byDay.set(day, [...new Set([...(byDay.get(day) || []), ...hours])].sort((x, y) => x - y));
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, hours]) => ({ day, hours }));
}

const availabilityText = (av) => av.map((a) => `${DAY_NAMES[a.day]}: ${a.hours.map(hourLabel).join(", ")}`).join(" · ");

// ── email verification (anti-spam): code by email → verify → short-lived token sent with the form ──
const OTP_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const RESEND_GAP_MS = 30 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;
const sha = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");
const cleanEmail = (v) => String(v || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;

// POST /collab-applications/email-otp — { email }
export const sendCollabEmailOtp = expressAsyncHandler(async (req, res, next) => {
  const email = cleanEmail(req.body?.email);
  if (!validEmail(email)) { res.status(400); return next(new Error("Please enter a valid email address.")); }
  if (await CollabApplication.exists({ email, status: { $in: OPEN_STATUSES } })) {
    res.status(409); return next(new Error("An application with this email is already with us. Our team will contact you soon."));
  }

  const now = Date.now();
  const doc = await CollabEmailOtp.findOne({ email });
  if (doc?.lastSentAt && now - doc.lastSentAt.getTime() < RESEND_GAP_MS) {
    const wait = Math.ceil((RESEND_GAP_MS - (now - doc.lastSentAt.getTime())) / 1000);
    res.status(429); return next(new Error(`Please wait ${wait}s before asking for a new code.`));
  }
  const inWindow = doc && now - doc.windowStart.getTime() < 3600 * 1000;
  if (inWindow && doc.sentCount >= MAX_SENDS_PER_HOUR) {
    res.status(429); return next(new Error("Too many codes requested for this email. Please try again in an hour."));
  }

  const code = generate6DigitOTP();
  await CollabEmailOtp.findOneAndUpdate({ email }, {
    $set: {
      codeHash: sha(`${email}:${code}`), codeExpires: new Date(now + OTP_TTL_MS), attempts: 0, lastSentAt: new Date(now),
      sentCount: inWindow ? doc.sentCount + 1 : 1, windowStart: inWindow ? doc.windowStart : new Date(now),
      tokenHash: "", tokenExpires: null, purgeAt: new Date(now + 24 * 3600 * 1000),
    },
  }, { upsert: true });

  const sent = await sendMail(email, "Your verification code — CYT Noida collaboration",
    `Your verification code is ${code}. It expires in 10 minutes.`, otpVerificationEmail(code), "Choose Your Therapist");
  if (!sent) {
    // a failed send shouldn't make them wait or use up a send
    await CollabEmailOtp.updateOne({ email }, { $set: { codeHash: "", codeExpires: null, lastSentAt: doc?.lastSentAt || null }, $inc: { sentCount: -1 } });
    res.status(502); return next(new Error("We couldn't send the email right now. Please check the address or try again.")); }
  res.json({ status: true, message: "Code sent. Please check your inbox (and spam folder)." });
});

// POST /collab-applications/email-otp/verify — { email, otp } → { token }
export const verifyCollabEmailOtp = expressAsyncHandler(async (req, res, next) => {
  const email = cleanEmail(req.body?.email);
  const otp = String(req.body?.otp || "").replace(/\D/g, "");
  const doc = await CollabEmailOtp.findOne({ email });
  if (!doc?.codeHash || !doc.codeExpires || doc.codeExpires.getTime() < Date.now()) {
    res.status(400); return next(new Error("This code has expired. Please ask for a new one."));
  }
  if (doc.attempts >= MAX_ATTEMPTS) {
    res.status(429); return next(new Error("Too many wrong tries. Please ask for a new code."));
  }
  if (otp.length !== 6 || sha(`${email}:${otp}`) !== doc.codeHash) {
    await CollabEmailOtp.updateOne({ _id: doc._id }, { $inc: { attempts: 1 } });
    const left = MAX_ATTEMPTS - doc.attempts - 1;
    res.status(400); return next(new Error(left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong tries. Please ask for a new code."));
  }
  const token = crypto.randomBytes(24).toString("hex");
  await CollabEmailOtp.updateOne({ _id: doc._id }, {
    $set: { codeHash: "", codeExpires: null, tokenHash: sha(token), tokenExpires: new Date(Date.now() + TOKEN_TTL_MS) },
  });
  res.json({ status: true, message: "Email verified.", data: { token } });
});

// GET /collab-applications/meta — public: terms + the hours the form offers
export const getCollabMeta = (req, res) => res.json({ status: true, data: { terms: COLLAB_TERMS, hours: ROOM_HOURS } });

// POST /collab-applications — public form
export const submitCollabApplication = expressAsyncHandler(async (req, res, next) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  const phone = String(b.phone || "").replace(/\D/g, "").slice(-10);
  const email = String(b.email || "").trim().toLowerCase();
  const role = String(b.role || "").trim();
  const availability = cleanAvailability(b.availability);

  if (name.length < 2) { res.status(400); return next(new Error("Please enter your full name.")); }
  if (!/^[6-9]\d{9}$/.test(phone)) { res.status(400); return next(new Error("Please enter a valid 10-digit mobile number.")); }
  if (!validEmail(email)) { res.status(400); return next(new Error("Please enter a valid email address.")); }
  if (!role) { res.status(400); return next(new Error("Please choose your profession.")); }
  if (!availability.length) { res.status(400); return next(new Error("Please pick at least one preferred time slot.")); }
  if (b.agreedTerms !== true) { res.status(400); return next(new Error("Please accept the collaboration terms to apply.")); }
  if (b.readHowItWorks !== true) { res.status(400); return next(new Error("Please read “How it works” and confirm before applying.")); }

  // the email must have been verified with a code in the last hour; the proof is used up by this application
  const proof = await CollabEmailOtp.findOneAndUpdate(
    { email, tokenHash: sha(b.emailToken || "-"), tokenExpires: { $gt: new Date() } },
    { $set: { tokenHash: "", tokenExpires: null } }
  );
  if (!proof) { res.status(400); return next(new Error("Please verify your email with the code we send you.")); }

  const existing = await CollabApplication.findOne({ $or: [{ phone }, { email }], status: { $in: OPEN_STATUSES } }).select("_id status").lean();
  if (existing) {
    res.status(409);
    return next(new Error("You have already applied with this number or email. Our team will contact you soon — for anything urgent, WhatsApp us."));
  }

  const fee = Number(b.sessionFee);
  const exp = Number(b.experienceYears);
  const app = await CollabApplication.create({
    name: name.slice(0, 80), phone, email, role: role.slice(0, 60),
    qualification: String(b.qualification || "").trim().slice(0, 200),
    currentPractice: {
      kind: ["clinic", "hospital", "centre", "online", "other"].includes(b.practiceType) ? b.practiceType : "",
      name: String(b.practiceName || "").trim().slice(0, 120),
      location: String(b.practiceLocation || "").trim().slice(0, 120),
    },
    registrationNo: String(b.registrationNo || "").trim().slice(0, 80),
    experienceYears: Number.isFinite(exp) ? Math.min(Math.max(Math.round(exp), 0), 60) : 0,
    specialisations: cleanList(b.specialisations),
    languages: cleanList(b.languages, 8),
    sessionFee: Number.isFinite(fee) && fee > 0 ? Math.round(fee) : null,
    availability,
    flexibility: ["fixed", "some", "flexible"].includes(b.flexibility) ? b.flexibility : "some",
    about: String(b.about || "").trim().slice(0, 1500),
    profileLink: String(b.profileLink || "").trim().slice(0, 300),
    agreedTerms: true,
    readHowItWorksAt: new Date(),
    emailVerifiedAt: new Date(),
    source: String(b.source || "").slice(0, 120),
  });

  // emails never block or fail the application
  if (email) {
    sendMail(email, "We've received your application — CYT Noida",
      `Hi ${firstName(name)}, thanks for applying to practise at CYT Noida. Our team will call you within 2 working days for a short screening.`,
      collabApplicationReceivedMail({ name: firstName(name), role, preferred: availabilityText(availability) })).catch(() => {});
  }
  sendMail(TEAM_INBOX, `New collaboration application: ${name} (${role})`,
    `${name} · ${role} · ${phone} · ${availabilityText(availability)}`,
    `<p><b>${esc(name)}</b> — ${esc(role)}, ${app.experienceYears} yrs</p>
     <p>📞 ${esc(phone)}${email ? ` · ✉️ ${esc(email)}` : ""}</p>
     <p>Preferred: ${esc(availabilityText(availability))}</p>
     <p>Review it in the admin panel → Collaborations.</p>`).catch(() => {});

  res.status(201).json({ status: true, message: "Application received.", data: { id: app._id } });
});

// GET /collab-applications — admin list (newest first), ?status=
export const getCollabApplications = expressAsyncHandler(async (req, res) => {
  const q = {};
  if (STATUSES.includes(req.query.status)) q.status = req.query.status;
  const [apps, slots] = await Promise.all([
    CollabApplication.find(q).sort({ createdAt: -1 }).limit(500).lean(),
    CollabRoomSlot.find({}).select("day hour application").lean(),
  ]);
  const assigned = new Map();
  for (const s of slots) {
    const k = String(s.application);
    assigned.set(k, [...(assigned.get(k) || []), { day: s.day, hour: s.hour }]);
  }
  res.json({ status: true, data: apps.map((a) => ({ ...a, assignedSlots: assigned.get(String(a._id)) || [] })) });
});

// PATCH /collab-applications/:id — admin: { status?, note? }
export const updateCollabApplication = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); return next(new Error("Invalid application.")); }
  const by = req.user?.name || "Admin";
  const set = {};
  const push = {};
  if (req.body.status !== undefined) {
    if (!STATUSES.includes(req.body.status)) { res.status(400); return next(new Error("Invalid status.")); }
    set.status = req.body.status;
    set.statusChangedAt = new Date();
  }
  const note = String(req.body.note || "").trim().slice(0, 1000);
  if (note) push.notes = { text: note, by, at: new Date() };
  if (!set.status && !note) { res.status(400); return next(new Error("Nothing to update.")); }

  const before = await CollabApplication.findById(id).select("status").lean();
  if (!before) { res.status(404); return next(new Error("Application not found.")); }
  const app = await CollabApplication.findByIdAndUpdate(id, {
    ...(Object.keys(set).length ? { $set: set } : {}),
    ...(note ? { $push: push } : {}),
  }, { new: true }).lean();
  if (!app) { res.status(404); return next(new Error("Application not found.")); }

  // only approved professionals hold room hours
  if (set.status && set.status !== "approved") await CollabRoomSlot.deleteMany({ application: app._id });

  // tell the professional when their status actually changes (not for "new" or a notes-only edit)
  let emailed = null;
  const html = set.status && set.status !== before.status && app.email
    ? collabStatusMail({ name: firstName(app.name), status: set.status, phone: app.phone }) : null;
  if (html) {
    const subject = {
      screening: "Your CYT Noida application is in screening",
      approved: "You're approved to practise at CYT Noida",
      on_hold: "An update on your CYT Noida application",
      rejected: "An update on your CYT Noida application",
    }[set.status];
    emailed = await sendMail(app.email, subject, `${subject}. Questions? Call +91 80777 57951.`, html, "Choose Your Therapist");
    await CollabApplication.updateOne({ _id: app._id }, { $push: { notes: {
      text: emailed ? `Emailed: ${STATUS_LABEL[set.status]}` : `Email failed: ${STATUS_LABEL[set.status]}`, by: "System", at: new Date(),
    } } });
    app.notes = [...(app.notes || []), { text: emailed ? `Emailed: ${STATUS_LABEL[set.status]}` : `Email failed: ${STATUS_LABEL[set.status]}`, by: "System", at: new Date() }];
  }

  const slots = await CollabRoomSlot.find({ application: app._id }).select("day hour").lean();
  res.json({ status: true, emailed, data: { ...app, assignedSlots: slots.map(({ day, hour }) => ({ day, hour })) } });
});

// DELETE /collab-applications/:id — admin: remove an application (spam, duplicate, test) with its room hours
export const deleteCollabApplication = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); return next(new Error("Invalid application.")); }
  const app = await CollabApplication.findByIdAndDelete(id).lean();
  if (!app) { res.status(404); return next(new Error("Application not found.")); }
  const { deletedCount } = await CollabRoomSlot.deleteMany({ application: app._id });
  if (app.email) await CollabEmailOtp.deleteOne({ email: app.email });
  console.log(`collab: ${req.user?.name || "admin"} deleted application ${app._id} (${app.name}, ${app.phone}), freed ${deletedCount} room hour(s)`);
  res.json({ status: true, message: `Deleted ${app.name}'s application${deletedCount ? ` and freed ${deletedCount} room hour(s)` : ""}.` });
});

// POST /collab-applications/:id/send-hours — admin: email the professional their confirmed room hours
export const sendCollabHours = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); return next(new Error("Invalid application.")); }
  const app = await CollabApplication.findById(id).lean();
  if (!app) { res.status(404); return next(new Error("Application not found.")); }
  if (app.status !== "approved") { res.status(400); return next(new Error("Approve them first.")); }
  if (!app.email) { res.status(400); return next(new Error("No email on this application — share the hours on WhatsApp.")); }
  const slots = await CollabRoomSlot.find({ application: app._id }).select("day hour").lean();
  if (!slots.length) { res.status(400); return next(new Error("Give them some room hours first.")); }

  const FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const range = (h) => `${hourLabel(h)} – ${hourLabel(h + 1)}`;
  const rows = [1, 2, 3, 4, 5, 6, 0]
    .map((d) => ({ d, hours: slots.filter((s) => s.day === d).map((s) => s.hour).sort((a, b) => a - b) }))
    .filter((r) => r.hours.length)
    .map((r) => ({ day: FULL[r.d], hours: r.hours.map(range).join(", ") }));

  const ok = await sendMail(app.email, "Your confirmed consultation hours — CYT Noida",
    rows.map((r) => `${r.day}: ${r.hours}`).join("\n"), collabHoursMail({ name: firstName(app.name), slots: rows, total: slots.length }), "Choose Your Therapist");
  if (!ok) { res.status(502); return next(new Error("Couldn't send the email right now. Please try again.")); }
  const updated = await CollabApplication.findByIdAndUpdate(app._id, {
    $set: { hoursSentAt: new Date() },
    $push: { notes: { text: `Emailed confirmed hours (${slots.length} hrs/week)`, by: req.user?.name || "Admin", at: new Date() } },
  }, { new: true }).lean();
  res.json({ status: true, message: `Hours emailed to ${app.email}`, data: { ...updated, assignedSlots: slots.map(({ day, hour }) => ({ day, hour })) } });
});

// GET /collab-room — admin: the weekly room board
export const getCollabRoom = expressAsyncHandler(async (req, res) => {
  const [slots, people] = await Promise.all([
    CollabRoomSlot.find({}).populate("application", "name role").lean(),
    CollabApplication.find({ status: { $in: ["approved", "screening"] } })
      .select("name role status availability flexibility").sort({ name: 1 }).lean(),
  ]);
  res.json({
    status: true,
    data: {
      hours: ROOM_HOURS,
      slots: slots.filter((s) => s.application).map((s) => ({
        day: s.day, hour: s.hour,
        applicationId: s.application._id, name: s.application.name, role: s.application.role,
      })),
      people,
    },
  });
});

// PUT /collab-room/slot — admin: { day, hour, applicationId | null }
export const setCollabRoomSlot = expressAsyncHandler(async (req, res, next) => {
  const day = Number(req.body.day);
  const hour = Number(req.body.hour);
  const { applicationId } = req.body;
  if (!Number.isInteger(day) || day < 0 || day > 6 || !ROOM_HOURS.includes(hour)) {
    res.status(400); return next(new Error("Invalid day or hour."));
  }

  if (!applicationId) {
    await CollabRoomSlot.deleteOne({ day, hour });
    return res.json({ status: true, message: "Slot freed." });
  }
  if (!mongoose.Types.ObjectId.isValid(applicationId)) { res.status(400); return next(new Error("Invalid professional.")); }
  const app = await CollabApplication.findById(applicationId).select("name status").lean();
  if (!app) { res.status(404); return next(new Error("Professional not found.")); }
  if (app.status !== "approved") { res.status(400); return next(new Error(`${app.name} is not approved yet — approve them first.`)); }

  const taken = await CollabRoomSlot.findOne({ day, hour }).populate("application", "name").lean();
  if (taken) {
    if (String(taken.application?._id) === String(applicationId)) return res.json({ status: true, message: "Already assigned." });
    res.status(409);
    return next(new Error(`Room is already given to ${taken.application?.name || "someone else"} on ${DAY_NAMES[day]} at ${hourLabel(hour)}. Free it first.`));
  }
  try {
    await CollabRoomSlot.create({ day, hour, application: applicationId, assignedBy: req.user?.name || "" });
  } catch (err) {
    if (err?.code === 11000) { res.status(409); return next(new Error("Someone just took this hour. Refresh and try again.")); }
    throw err;
  }
  res.json({ status: true, message: `${app.name} → ${DAY_NAMES[day]} ${hourLabel(hour)}` });
});
