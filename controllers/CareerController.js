import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JobOpening from "../models/JobOpening.js";
import JobApplication from "../models/JobApplication.js";
import { sendMail } from "../helper/mailer.js";

/* Careers: public /careers page (open jobs + apply with a resume) and admin → Settings → Careers
   (set up jobs, see everyone who applied, move them through new → shortlisted → interview → hired / rejected). */

const TEAM_INBOX = "chooseyourtherapist@gmail.com";
const DOCS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "uploads", "documents");
const STATUSES = ["new", "shortlisted", "interview", "hired", "rejected"];
const DEPARTMENTS = ["Marketing", "Clinical", "Operations", "Sales", "Technology", "Other"];
const TYPES = ["Full-time", "Part-time", "Internship", "Freelance", "Contract"];

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const str = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const list = (v) => (Array.isArray(v) ? v : String(v || "").split("\n")).map((x) => str(x, 300)).filter(Boolean).slice(0, 20);
const slugify = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "job";
const removeUpload = (file) => { if (file?.path) fs.unlink(file.path, () => {}); };

// first visit with no jobs at all: start with the roles CYT is hiring for (editable / closable in admin)
const STARTER_JOBS = [
  {
    title: "Digital Marketing Executive", department: "Marketing", type: "Full-time", location: "Noida · Hybrid", experience: "0–2 years",
    summary: "Help more people find the right therapist. You'll run our SEO, Google and Meta campaigns, and measure what brings clients in.",
    responsibilities: ["Plan and run Google and Meta ad campaigns", "Improve our website pages for search (SEO)", "Track leads and bookings from every channel", "Work with the content team on campaigns"],
    requirements: ["Basic knowledge of SEO, Google Ads and Meta Ads", "Comfortable with Google Analytics and spreadsheets", "Good written English and Hindi", "Interest in mental health"],
    order: 1,
  },
  {
    title: "Social Media & Content Creator", department: "Marketing", type: "Full-time", location: "Noida · Hybrid", experience: "0–2 years",
    summary: "Make mental health content people want to save and share: reels, carousels and short posts for Instagram, LinkedIn and YouTube.",
    responsibilities: ["Plan a weekly content calendar", "Script, shoot and edit reels and carousels", "Turn therapists' tips into simple posts", "Reply to comments and messages kindly"],
    requirements: ["A portfolio of posts or reels you have made", "Canva / CapCut or similar tools", "Sensitive, stigma-free writing about mental health"],
    order: 2,
  },
  {
    title: "Counselling Psychologist (Online)", department: "Clinical", type: "Freelance", location: "Remote · online sessions", experience: "1+ years",
    summary: "See clients online through CYT. Set your own hours and fees, and get clients matched to your expertise.",
    responsibilities: ["Run online therapy sessions with clients matched to you", "Keep session notes on the CYT therapist portal", "Follow CYT's ethics and confidentiality standards"],
    requirements: ["M.A. / M.Sc. in Psychology (Counselling or Clinical)", "Supervised practice experience", "RCI registration preferred"],
    clinical: true, order: 3,
  },
  {
    title: "Clinical Psychologist (Noida Centre)", department: "Clinical", type: "Part-time", location: "Noida · Sector 51 centre", experience: "1+ years",
    summary: "See clients in person at the CYT Noida centre, and do assessments for clients who need them.",
    responsibilities: ["In-person therapy sessions at the Noida centre", "Psychological assessments and reports", "Work with the CYT care team on referrals"],
    requirements: ["M.Phil. Clinical Psychology / Professional Diploma", "RCI registration", "Comfortable with standard assessment tools"],
    clinical: true, order: 4,
  },
];

const ensureStarterJobs = async () => {
  if (await JobOpening.estimatedDocumentCount()) return;
  await JobOpening.insertMany(STARTER_JOBS.map((j) => ({ ...j, slug: slugify(j.title) }))).catch(() => {});
};

const publicJob = (j) => ({
  _id: j._id, title: j.title, slug: j.slug, department: j.department, type: j.type, location: j.location,
  experience: j.experience, salary: j.salary, summary: j.summary, responsibilities: j.responsibilities,
  requirements: j.requirements, clinical: j.clinical, postedAt: j.createdAt,
});

/* ───────── public ───────── */

// GET /careers/jobs — open jobs for the /careers page
export const getOpenJobs = expressAsyncHandler(async (req, res) => {
  await ensureStarterJobs();
  const jobs = await JobOpening.find({ isOpen: true }).sort({ order: 1, createdAt: -1 }).lean();
  res.json({ status: true, data: jobs.map(publicJob), departments: DEPARTMENTS });
});

// POST /careers/apply — multipart: fields + "resume" file
export const applyForJob = expressAsyncHandler(async (req, res, next) => {
  const b = req.body || {};
  const file = req.file;
  const fail = (code, msg) => { removeUpload(file); res.status(code); return next(new Error(msg)); };

  if (b.website) return fail(400, "Please try again."); // honeypot — bots fill every field
  const name = str(b.name, 80);
  const email = str(b.email, 120).toLowerCase();
  const phone = str(b.phone, 20);
  if (name.length < 2) return fail(400, "Please enter your full name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(400, "Please enter a valid email address.");
  if (!/^\+?[0-9 ]{10,16}$/.test(phone)) return fail(400, "Please enter a valid phone number.");
  if (!file) return fail(400, "Please attach your resume (PDF or Word, up to 5 MB).");

  let job = null;
  if (b.jobId && b.jobId !== "general") {
    if (!mongoose.Types.ObjectId.isValid(b.jobId)) return fail(400, "Please choose a job.");
    job = await JobOpening.findOne({ _id: b.jobId, isOpen: true });
    if (!job) return fail(400, "This job is no longer open. Please choose another one.");
  }
  const jobTitle = job ? job.title : "General application";

  // the same person applying twice for the same job within a week → keep the first one
  const recent = await JobApplication.findOne({ email, job: job?._id || null, createdAt: { $gt: new Date(Date.now() - 7 * 864e5) } });
  if (recent) return fail(409, "You have already applied for this role. Our team will get back to you soon.");

  const app = await JobApplication.create({
    job: job?._id || null, jobTitle, name, email, phone,
    city: str(b.city, 80), experience: str(b.experience, 40), currentRole: str(b.currentRole, 120),
    qualification: str(b.qualification, 160), rciNumber: str(b.rciNumber, 40), link: str(b.link, 300),
    noticePeriod: str(b.noticePeriod, 40), message: str(b.message, 2000),
    resume: file.filename, resumeName: str(file.originalname, 120),
  });

  // thank-you to the applicant + a heads-up to the team (failures don't stop the application)
  sendMail(email, `We received your application — ${jobTitle}`,
    `Hi ${name}, thank you for applying for ${jobTitle} at Choose Your Therapist. Our team will review your application and get back to you.`,
    `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2d26;line-height:1.6;max-width:560px">
      <p>Hi ${esc(name)},</p>
      <p>Thank you for applying for <b>${esc(jobTitle)}</b> at Choose Your Therapist.</p>
      <p>Our team reads every application. If your profile fits, we'll contact you by email or phone for the next step.</p>
      <p style="margin-top:22px">Warm regards,<br/>Team Choose Your Therapist<br/><a href="https://www.chooseyourtherapist.in/careers">chooseyourtherapist.in/careers</a></p>
    </div>`, "Choose Your Therapist").catch(() => {});
  sendMail(TEAM_INBOX, `New job application: ${jobTitle} — ${name}`,
    `${name} (${email}, ${phone}) applied for ${jobTitle}.`,
    `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2d26;line-height:1.6">
      <p><b>${esc(name)}</b> applied for <b>${esc(jobTitle)}</b>.</p>
      <p>${esc(email)} · ${esc(phone)}${app.city ? ` · ${esc(app.city)}` : ""}${app.experience ? ` · ${esc(app.experience)} experience` : ""}</p>
      ${app.message ? `<p style="white-space:pre-line">${esc(app.message)}</p>` : ""}
      <p>Open admin → Settings → Careers to see the resume.</p>
    </div>`).catch(() => {});

  res.json({ status: true, message: "Application sent. Thank you!", data: { id: app._id } });
});

/* ───────── admin ───────── */

// GET /admin/careers/jobs — every job with its application counts
export const adminListJobs = expressAsyncHandler(async (req, res) => {
  await ensureStarterJobs();
  const [jobs, counts] = await Promise.all([
    JobOpening.find({}).sort({ order: 1, createdAt: -1 }).lean(),
    JobApplication.aggregate([{ $group: { _id: { job: "$job", status: "$status" }, n: { $sum: 1 } } }]),
  ]);
  const by = {};
  counts.forEach((c) => { const k = String(c._id.job); (by[k] = by[k] || { total: 0 })[c._id.status] = c.n; by[k].total += c.n; });
  res.json({ status: true, data: jobs.map((j) => ({ ...j, applications: by[String(j._id)] || { total: 0 } })), general: by.null || { total: 0 }, departments: DEPARTMENTS, types: TYPES });
});

const jobFields = (b) => ({
  title: str(b.title, 120), department: str(b.department, 40) || "Other", type: str(b.type, 40) || "Full-time",
  location: str(b.location, 80), experience: str(b.experience, 40), salary: str(b.salary, 80), summary: str(b.summary, 600),
  responsibilities: list(b.responsibilities), requirements: list(b.requirements),
  clinical: !!b.clinical, isOpen: b.isOpen !== false, order: Number(b.order) || 0,
});

const uniqueSlug = async (title, exceptId) => {
  const base = slugify(title); let slug = base; let i = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await JobOpening.exists({ slug, ...(exceptId ? { _id: { $ne: exceptId } } : {}) })) slug = `${base}-${i++}`;
  return slug;
};

// POST /admin/careers/jobs
export const adminCreateJob = expressAsyncHandler(async (req, res, next) => {
  const f = jobFields(req.body || {});
  if (f.title.length < 3) { res.status(400); return next(new Error("Give the job a title.")); }
  const job = await JobOpening.create({ ...f, slug: await uniqueSlug(f.title) });
  res.json({ status: true, message: "Job added", data: job });
});

// PATCH /admin/careers/jobs/:id — edit, or just { isOpen } to open / close it
export const adminUpdateJob = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); return next(new Error("Invalid job.")); }
  const b = req.body || {};
  let set;
  if (Object.keys(b).length === 1 && "isOpen" in b) set = { isOpen: !!b.isOpen };
  else {
    set = jobFields(b);
    if (set.title.length < 3) { res.status(400); return next(new Error("Give the job a title.")); }
    set.slug = await uniqueSlug(set.title, id);
  }
  const job = await JobOpening.findByIdAndUpdate(id, set, { new: true });
  if (!job) { res.status(404); return next(new Error("Job not found.")); }
  res.json({ status: true, message: set.isOpen === false && Object.keys(set).length === 1 ? "Job closed" : "Saved", data: job });
});

// DELETE /admin/careers/jobs/:id — applications stay (they keep the job title)
export const adminDeleteJob = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); return next(new Error("Invalid job.")); }
  await JobOpening.findByIdAndDelete(id);
  res.json({ status: true, message: "Job deleted. Its applications are kept." });
});

// GET /admin/careers/applications?job=&status=&q=
export const adminListApplications = expressAsyncHandler(async (req, res) => {
  const f = {};
  if (req.query.job === "general") f.job = null;
  else if (mongoose.Types.ObjectId.isValid(req.query.job)) f.job = req.query.job;
  if (STATUSES.includes(req.query.status)) f.status = req.query.status;
  const q = str(req.query.q, 60);
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    f.$or = [{ name: rx }, { email: rx }, { phone: rx }, { city: rx }, { jobTitle: rx }];
  }
  const [rows, byStatus] = await Promise.all([
    JobApplication.find(f).sort({ createdAt: -1 }).limit(500).lean(),
    JobApplication.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);
  res.json({ status: true, data: rows, counts: Object.fromEntries(byStatus.map((s) => [s._id, s.n])), statuses: STATUSES });
});

// PATCH /admin/careers/applications/:id — { status } and/or { note }
export const adminUpdateApplication = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); return next(new Error("Invalid application.")); }
  const b = req.body || {};
  const update = {};
  const notes = [];
  if (b.status) {
    if (!STATUSES.includes(b.status)) { res.status(400); return next(new Error("Invalid status.")); }
    update.status = b.status;
    notes.push({ text: `Status → ${b.status}`, by: req.user?.name || "Admin", at: new Date() });
  }
  const note = str(b.note, 1000);
  if (note) notes.push({ text: note, by: req.user?.name || "Admin", at: new Date() });
  if (!update.status && !notes.length) { res.status(400); return next(new Error("Nothing to save.")); }
  const app = await JobApplication.findByIdAndUpdate(id, { ...update, ...(notes.length ? { $push: { notes: { $each: notes } } } : {}) }, { new: true });
  if (!app) { res.status(404); return next(new Error("Application not found.")); }
  res.json({ status: true, message: "Saved", data: app });
});

// DELETE /admin/careers/applications/:id — also removes the resume file
export const adminDeleteApplication = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); return next(new Error("Invalid application.")); }
  const app = await JobApplication.findByIdAndDelete(id);
  if (app?.resume) fs.unlink(path.join(DOCS_DIR, path.basename(app.resume)), () => {});
  res.json({ status: true, message: "Application deleted" });
});

// GET /admin/careers/applications/:id/resume — the file itself, only through an admin session
export const adminGetResume = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); return next(new Error("Invalid application.")); }
  const app = await JobApplication.findById(id).select("resume resumeName").lean();
  const file = app?.resume ? path.join(DOCS_DIR, path.basename(app.resume)) : "";
  if (!file || !fs.existsSync(file)) { res.status(404); return next(new Error("Resume file not found.")); }
  const ext = path.extname(file).toLowerCase();
  const type = { ".pdf": "application/pdf", ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" }[ext] || "application/octet-stream";
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", `inline; filename="${(app.resumeName || `resume${ext}`).replace(/[^\w.\- ]/g, "_")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  fs.createReadStream(file).pipe(res);
});
