import expressAsyncHandler from "express-async-handler";
import Joi from "joi";
import Razorpay from "razorpay";
import crypto from "crypto";
import Trainee from "../models/Trainee.js";

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
  const trainee = await Trainee.findOne({ slug: req.params.slug });
  if (!trainee) {
    res.status(404);
    throw new Error("Trainee not found");
  }
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
