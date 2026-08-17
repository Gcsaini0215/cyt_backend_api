import expressAsyncHandler from "express-async-handler";
import Joi from "joi";
import Trainee from "../models/Trainee.js";

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
