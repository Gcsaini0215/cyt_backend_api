import expressAsyncHandler from "express-async-handler";
import Joi from "joi";
import Razorpay from "razorpay";
import crypto from "crypto";
import Trainee from "../models/Trainee.js";
import TraineeAccount from "../models/TraineeAccount.js";
import Jwt from "jsonwebtoken";
import { generate6DigitOTP } from "../helper/generate.js";
import { sendMail } from "../helper/mailer.js";
import { loginOtpEmail } from "../services/mailTemplates.js";

// Program fee ladder — the source of truth for what an application is charged. The public form
// shows the same numbers, but the amount is always decided here, never taken from the browser.
const INTERN_FEES = {
  "30 hrs": 1999,
  "40 hrs": 2499,
  "60 hrs": 3499,
  "80 hrs": 4499,
  "100 hrs": 5499,
  "120 hrs": 6499,
  "240 hrs": 8499,
};

const getRazorpay = () =>
  new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });

/* POST /api/trainees/create-order — public; opens a Razorpay order for the chosen program hours */
export const createTraineeOrder = expressAsyncHandler(async (req, res, next) => {
  const hours = String(req.body?.hours || "");
  const fee = INTERN_FEES[hours];
  if (!fee) {
    res.status(400);
    return next(new Error("Please choose a valid program duration."));
  }
  const order = await getRazorpay().orders.create({
    amount: fee * 100,
    currency: "INR",
    receipt: `intern_${Date.now()}`,
    notes: { purpose: "internship", hours },
  });
  // key id travels with the order so the checkout always opens under the account that created it
  res.json({ status: true, data: { orderId: order.id, amount: fee, keyId: process.env.RAZORPAY_KEY_ID } });
});

const slugify = (name) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/* POST /api/trainees — public, called when an internship application is submitted */
export const createTrainee = expressAsyncHandler(async (req, res, next) => {
  const validateSchema = Joi.object({
    name: Joi.string().min(2).required(),
    email: Joi.string().email().allow("", null).optional(),
    phone: Joi.string().allow("", null).optional(),
  }).unknown(true);

  const { error } = validateSchema.validate(req.body);
  if (error) {
    res.status(400);
    return next(new Error(error));
  }

  const {
    name, email, phone, city, gender, dob, college, degree, specialization, year,
    internType, mode, duration, hours, programFee, transactionId,
    availableFrom, motivation,
  } = req.body;

  // ── payment: a Razorpay payment is verified here (signature + that it was for THIS program);
  //    without one the application is stored as an unverified, self-reported UTR (legacy form).
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  let payment = { paymentMethod: "upi-manual", paymentStatus: "unverified" };
  if (razorpay_order_id || razorpay_payment_id || razorpay_signature) {
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      res.status(400);
      return next(new Error("Incomplete payment details."));
    }
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");
    if (expected !== razorpay_signature) {
      res.status(400);
      return next(new Error("Payment could not be verified."));
    }
    // Retry after a dropped response — same payment, same application, don't duplicate it.
    const already = await Trainee.findOne({ razorpayPaymentId: razorpay_payment_id });
    if (already) {
      return res.status(200).json({ status: true, data: already, message: "Application already saved" });
    }
    const fee = INTERN_FEES[hours];
    const order = await getRazorpay().orders.fetch(razorpay_order_id);
    if (!fee || order.amount !== fee * 100 || order.notes?.hours !== hours) {
      res.status(400);
      return next(new Error("The payment doesn't match the selected program. Please contact support with your payment ID."));
    }
    payment = {
      paymentMethod: "razorpay",
      paymentStatus: "paid",
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      transactionId: razorpay_payment_id,
      programFee: fee,
    };
  }

  let slug = slugify(name);
  const existing = await Trainee.findOne({ slug });
  if (existing) slug = `${slug}-${Date.now().toString().slice(-4)}`;

  const parsedInternType = Array.isArray(internType)
    ? internType
    : (internType ? [internType] : []);

  const trainee = await Trainee.create({
    slug,
    name,
    email: email || "",
    phone: phone || "",
    city: city || "",
    gender: gender || "",
    dob: dob || "",
    college: college || "",
    degree: degree || "",
    specialization: specialization || "",
    year: year || "",
    internType: parsedInternType,
    mode: mode || "",
    duration: duration || "",
    hours: hours || "",
    programFee: programFee || null,
    transactionId: transactionId || "",
    availableFrom: availableFrom || "",
    motivation: motivation || "",
    resume: req.files?.resumeFile?.[0]?.filename || "",
    collegeId: req.files?.collegeId?.[0]?.filename || "",
    passportPhoto: req.files?.passportPhoto?.[0]?.filename || "",
    ...payment,
  });

  res.status(201).json({ status: true, data: trainee, message: "Application saved" });
});

/* GET /api/trainees/:slug — public, powers the trainee's profile page */
export const getTraineeBySlug = expressAsyncHandler(async (req, res, next) => {
  const trainee = await Trainee.findOne({ slug: req.params.slug })
    .select("slug name internType mode duration hours status availableFrom college createdAt").lean();
  if (!trainee) {
    res.status(404);
    throw new Error("Trainee not found");
  }
  // public: no contact details, payment ids or documents — those come from /trainees/me after sign-in
  res.json({ status: true, data: trainee });
});

/* GET /api/admin/trainees — admin-only, every internship application ever submitted */
export const getAllTrainees = expressAsyncHandler(async (req, res, next) => {
  const trainees = await Trainee.find({}).sort({ createdAt: -1 });
  res.json({ status: true, data: trainees, message: "Fetched successfully" });
});

/* PATCH /api/admin/trainees/:id/status — admin-only, move an application through the pipeline */
export const updateTraineeStatus = expressAsyncHandler(async (req, res, next) => {
  const { status } = req.body;
  const allowed = ["pending", "active", "completed", "rejected"];
  if (!allowed.includes(status)) {
    res.status(400);
    return next(new Error(`Status must be one of: ${allowed.join(", ")}`));
  }

  const trainee = await Trainee.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!trainee) {
    res.status(404);
    throw new Error("Trainee not found");
  }
  res.json({ status: true, data: trainee, message: "Status updated" });
});

/* DELETE /api/admin/trainees/:id — admin-only */
export const deleteTrainee = expressAsyncHandler(async (req, res, next) => {
  const trainee = await Trainee.findByIdAndDelete(req.params.id);
  if (!trainee) {
    res.status(404);
    throw new Error("Trainee not found");
  }
  res.json({ status: true, message: "Trainee deleted" });
});

/* ── Trainee portal sign-in: email OTP — against the internship application (Trainee) or a portal account
   made with "Create account" (TraineeAccount). The token is a trainee-only JWT ({ kind: "trainee" }),
   kept apart from the client / therapist login. ── */
const TRAINEE_TTL = "30d";
const OTP_VALID_MS = 10 * 60 * 1000;
const cleanEmail = (email) => {
  const e = String(email || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
};
const emailRx = (e) => new RegExp(`^${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
const applicationByEmail = (e) => Trainee.findOne({ email: emailRx(e), status: { $ne: "rejected" } }).sort({ createdAt: -1 });

// who signs in with this email: the application first, otherwise a verified portal account
async function loginTarget(e, withOtp = false) {
  let q = applicationByEmail(e);
  if (withOtp) q = q.select("+login_otp");
  const app = await q;
  if (app) return { doc: app, app };
  let aq = TraineeAccount.findOne({ email: e, verified: true });
  if (withOtp) aq = aq.select("+login_otp");
  const acc = await aq;
  return acc ? { doc: acc, app: null } : null;
}

const nameOf = (d) => d.name || [d.firstName, d.lastName].filter(Boolean).join(" ") || "Trainee";
export const signTraineeToken = (doc, app) => Jwt.sign({
  kind: "trainee",
  traineeId: app ? String(app._id) : null,
  accountId: app ? null : String(doc._id),
  slug: app ? app.slug : null,
  name: nameOf(app || doc),
  email: (app || doc).email,
  phone: (app || doc).phone || "",
}, process.env.JWT_SECRET, { expiresIn: TRAINEE_TTL, algorithm: "HS256" });

async function sendCode(doc, subject) {
  if (doc.login_otp_at && Date.now() - new Date(doc.login_otp_at).getTime() < 30000) return { wait: true };
  const otp = String(generate6DigitOTP());
  doc.login_otp = otp;
  doc.login_otp_at = new Date();
  doc.login_otp_tries = 0;
  await doc.save();
  const ok = await sendMail(doc.email, subject, `Your Choose Your Therapist trainee portal code is ${otp}. It is valid for 10 minutes.`, loginOtpEmail(nameOf(doc), otp));
  return { ok };
}
async function checkCode(doc, otp) {
  if (!doc || !doc.login_otp) return "Please request a new code.";
  if (!doc.login_otp_at || Date.now() - new Date(doc.login_otp_at).getTime() > OTP_VALID_MS) return "This code has expired — please request a new one.";
  if (doc.login_otp_tries >= 5) return "Too many wrong codes — please request a new one.";
  if (String(otp || "").trim() !== doc.login_otp) {
    doc.login_otp_tries += 1;
    await doc.save();
    return "That code isn't right — please check and try again.";
  }
  doc.login_otp = "";
  doc.login_otp_tries = 0;
  return "";
}

/* POST /api/trainees/login { email } — send a sign-in code */
export const traineeLoginOtp = expressAsyncHandler(async (req, res) => {
  const e = cleanEmail(req.body?.email);
  if (!e) return res.status(400).json({ status: false, message: "Enter a valid email address" });
  const target = await loginTarget(e);
  if (!target) return res.status(404).json({ status: false, message: "No trainee account with this email yet — tap Create account below." });
  const r = await sendCode(target.doc, "Your trainee portal sign-in code");
  if (r.wait) return res.status(429).json({ status: false, message: "A code was just sent — please wait a few seconds and try again." });
  if (!r.ok) return res.status(502).json({ status: false, message: "Couldn't send the code — please try again." });
  res.json({ status: true, message: "Code sent to your email" });
});

/* POST /api/trainees/verify-otp { email, otp } — returns { token, slug } (slug null = no application yet) */
export const traineeVerifyOtp = expressAsyncHandler(async (req, res) => {
  const e = cleanEmail(req.body?.email);
  const target = e ? await loginTarget(e, true) : null;
  const err = await checkCode(target?.doc, req.body?.otp);
  if (err) return res.status(err.startsWith("Too many") ? 429 : 400).json({ status: false, message: err });
  await target.doc.save();
  res.json({ status: true, token: signTraineeToken(target.doc, target.app), slug: target.app ? target.app.slug : null });
});

/* POST /api/trainees/register { firstName, lastName, phone, email } — "Create account": sends a code */
export const traineeRegister = expressAsyncHandler(async (req, res) => {
  const firstName = String(req.body?.firstName || "").trim().slice(0, 60);
  const lastName = String(req.body?.lastName || "").trim().slice(0, 60);
  const phone = String(req.body?.phone || "").replace(/\D/g, "").slice(-10);
  const e = cleanEmail(req.body?.email);
  if (firstName.length < 2) return res.status(400).json({ status: false, message: "Enter your first name" });
  if (!/^[6-9]\d{9}$/.test(phone)) return res.status(400).json({ status: false, message: "Enter a valid 10-digit mobile number" });
  if (!e) return res.status(400).json({ status: false, message: "Enter a valid email address" });
  if (await applicationByEmail(e) || await TraineeAccount.exists({ email: e, verified: true })) {
    return res.status(409).json({ status: false, message: "An account with this email already exists — please sign in instead." });
  }
  let acc = await TraineeAccount.findOne({ email: e });
  if (!acc) acc = new TraineeAccount({ email: e, firstName });
  acc.firstName = firstName; acc.lastName = lastName; acc.phone = phone;
  const r = await sendCode(acc, "Verify your trainee portal account");
  if (r.wait) return res.status(429).json({ status: false, message: "A code was just sent — please wait a few seconds and try again." });
  if (!r.ok) return res.status(502).json({ status: false, message: "Couldn't send the code — please try again." });
  res.json({ status: true, message: "Code sent to your email" });
});

/* POST /api/trainees/register/verify { email, otp } — verifies the new account and signs in */
export const traineeRegisterVerify = expressAsyncHandler(async (req, res) => {
  const e = cleanEmail(req.body?.email);
  const acc = e ? await TraineeAccount.findOne({ email: e }).select("+login_otp") : null;
  const err = await checkCode(acc, req.body?.otp);
  if (err) return res.status(err.startsWith("Too many") ? 429 : 400).json({ status: false, message: err });
  acc.verified = true;
  await acc.save();
  const app = await applicationByEmail(e);
  res.json({ status: true, token: signTraineeToken(acc, app), slug: app ? app.slug : null });
});

/* GET /api/trainees/me — the signed-in trainee: their application (if any) and account details */
export const traineeMe = expressAsyncHandler(async (req, res) => {
  const h = req.headers.authorization || "";
  let d = null;
  try { d = h.startsWith("Bearer ") ? Jwt.verify(h.slice(7), process.env.JWT_SECRET, { algorithms: ["HS256"] }) : null; } catch { d = null; }
  if (!d || d.kind !== "trainee") return res.status(401).json({ status: false, message: "Please sign in" });
  let app = d.traineeId ? await Trainee.findById(d.traineeId) : null;
  if (!app && d.email) app = await applicationByEmail(String(d.email).toLowerCase()); // applied after making the account
  res.json({ status: true, data: app, account: { name: d.name, email: d.email, phone: d.phone || "" }, token: app && !d.traineeId ? signTraineeToken(app, app) : undefined });
});
