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
    name, email, phone, city, college, degree, specialization,
    internType, mode, duration, hours, programFee, transactionId,
    availableFrom, motivation,
  } = req.body;

  let slug = slugify(name);
  const existing = await Trainee.findOne({ slug });
  if (existing) slug = `${slug}-${Date.now().toString().slice(-4)}`;

  const trainee = await Trainee.create({
    slug,
    name,
    email: email || "",
    phone: phone || "",
    city: city || "",
    college: college || "",
    degree: degree || "",
    specialization: specialization || "",
    internType: Array.isArray(internType) ? internType : [],
    mode: mode || "",
    duration: duration || "",
    hours: hours || "",
    programFee: programFee || null,
    transactionId: transactionId || "",
    availableFrom: availableFrom || "",
    motivation: motivation || "",
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
