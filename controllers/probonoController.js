import expressAsyncHandler from "express-async-handler";
import ProbonoIntern from "../models/ProbonoIntern.js";
import ProbonoReview from "../models/ProbonoReview.js";

const BASE_URL = process.env.BASE_URL || "https://api.chooseyourtherapist.in";

const slugify = (name) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

/* GET /api/probono-interns — active only (public site) */
export const getProbonoInterns = expressAsyncHandler(async (req, res) => {
  const interns = await ProbonoIntern.find({ isActive: true }).sort({ createdAt: -1 });
  res.json({ status: true, data: interns });
});

/* GET /api/probono-interns/all — all, including hidden (admin) */
export const getAllProbonoInterns = expressAsyncHandler(async (req, res) => {
  const interns = await ProbonoIntern.find().sort({ createdAt: -1 });
  res.json({ status: true, data: interns });
});

/* POST /api/probono-interns (admin) */
export const createProbonoIntern = expressAsyncHandler(async (req, res) => {
  const { name, email, intro, bio, concerns, availableDays, roleLabel, rating, requestsSent, connected } = req.body;
  if (!name?.trim()) {
    res.status(400);
    throw new Error("Name is required");
  }

  const parsedDays = availableDays ? JSON.parse(availableDays) : [];
  if (!parsedDays.length) {
    res.status(400);
    throw new Error("Please select at least one available day");
  }

  let slug = slugify(name);
  const existing = await ProbonoIntern.findOne({ slug });
  if (existing) slug = `${slug}-${Date.now().toString().slice(-4)}`;

  const photo = req.file ? `${BASE_URL}/uploads/images/${req.file.filename}` : "";

  const intern = await ProbonoIntern.create({
    slug,
    name: name.trim(),
    email: email || "",
    photo,
    intro: intro || "",
    bio: bio || "",
    concerns: concerns ? JSON.parse(concerns) : [],
    availableDays: parsedDays,
    roleLabel: roleLabel?.trim() || "Trainee Psychologist",
    rating: rating ? Number(rating) : 5,
    requestsSent: requestsSent ? Number(requestsSent) : 0,
    connected: connected ? Number(connected) : 0,
  });

  res.json({ status: true, data: intern, message: "Probono intern added" });
});

/* PUT /api/probono-interns/:id (admin) */
export const updateProbonoIntern = expressAsyncHandler(async (req, res) => {
  const intern = await ProbonoIntern.findById(req.params.id);
  if (!intern) {
    res.status(404);
    throw new Error("Intern not found");
  }

  const { name, email, intro, bio, concerns, availableDays, roleLabel, rating, requestsSent, connected, isActive } = req.body;

  if (name?.trim() && name.trim() !== intern.name) {
    intern.name = name.trim();
    let slug = slugify(name);
    const existing = await ProbonoIntern.findOne({ slug, _id: { $ne: intern._id } });
    if (existing) slug = `${slug}-${Date.now().toString().slice(-4)}`;
    intern.slug = slug;
  }

  if (req.file) intern.photo = `${BASE_URL}/uploads/images/${req.file.filename}`;
  if (email !== undefined) intern.email = email;
  if (intro !== undefined) intern.intro = intro;
  if (bio !== undefined) intern.bio = bio;
  if (concerns !== undefined) intern.concerns = JSON.parse(concerns);
  if (availableDays !== undefined) {
    const parsedDays = JSON.parse(availableDays);
    if (!parsedDays.length) {
      res.status(400);
      throw new Error("Please select at least one available day");
    }
    intern.availableDays = parsedDays;
  }
  if (roleLabel !== undefined) intern.roleLabel = roleLabel.trim() || "Trainee Psychologist";
  if (rating !== undefined) intern.rating = Number(rating);
  if (requestsSent !== undefined) intern.requestsSent = Number(requestsSent);
  if (connected !== undefined) intern.connected = Number(connected);
  if (isActive !== undefined) intern.isActive = isActive === "true" || isActive === true;

  await intern.save();
  res.json({ status: true, data: intern, message: "Probono intern updated" });
});

/* DELETE /api/probono-interns/:id (admin) */
export const deleteProbonoIntern = expressAsyncHandler(async (req, res) => {
  const intern = await ProbonoIntern.findById(req.params.id);
  if (!intern) {
    res.status(404);
    throw new Error("Intern not found");
  }
  await intern.deleteOne();
  res.json({ status: true, message: "Probono intern deleted" });
});

/* PATCH /api/probono-interns/:id/toggle (admin) */
export const toggleProbonoIntern = expressAsyncHandler(async (req, res) => {
  const intern = await ProbonoIntern.findById(req.params.id);
  if (!intern) {
    res.status(404);
    throw new Error("Intern not found");
  }
  intern.isActive = !intern.isActive;
  await intern.save();
  res.json({ status: true, data: intern, message: `Intern ${intern.isActive ? "activated" : "deactivated"}` });
});

/* PATCH /api/probono-interns/:id/request-sent — public, rate-limited.
   Called when a visitor submits the "Connect Now" lead form for an intern. */
export const incrementRequestSent = expressAsyncHandler(async (req, res) => {
  const intern = await ProbonoIntern.findByIdAndUpdate(
    req.params.id,
    { $inc: { requestsSent: 1 } },
    { new: true }
  );
  if (!intern) {
    res.status(404);
    throw new Error("Intern not found");
  }
  res.json({ status: true, data: { requestsSent: intern.requestsSent } });
});

/* POST /api/probono-interns/:id/review — public, rate-limited */
export const saveProbonoReview = expressAsyncHandler(async (req, res, next) => {
  const { name, email, rating, description } = req.body;

  if (!name || !email || !rating || !description) {
    res.status(400);
    return next(new Error("Please provide all required fields"));
  }

  const intern = await ProbonoIntern.findById(req.params.id);
  if (!intern) {
    res.status(404);
    throw new Error("Intern not found");
  }

  const review = await ProbonoReview.create({
    probono_intern_id: intern._id,
    name,
    email,
    rating,
    description,
  });

  // Recompute the intern's overall star rating as the average of all their reviews,
  // so the stars shown on the listing/detail cards reflect real feedback.
  const allReviews = await ProbonoReview.find({ probono_intern_id: intern._id });
  const avgRating = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
  intern.rating = Math.round(avgRating * 10) / 10;
  await intern.save();

  res.status(201).json({ status: true, message: "Review submitted successfully.", data: review, rating: intern.rating });
});

/* GET /api/probono-interns/:id/reviews — public */
export const getProbonoReviews = expressAsyncHandler(async (req, res) => {
  const reviews = await ProbonoReview.find({ probono_intern_id: req.params.id }).sort({ createdAt: -1 });
  res.json({ status: true, data: reviews });
});

/* GET /api/probono-reviews (admin) — all reviews across all interns, for the admin panel */
export const getAllProbonoReviews = expressAsyncHandler(async (req, res) => {
  const reviews = await ProbonoReview.find({})
    .populate({ path: "probono_intern_id", select: "name slug photo" })
    .sort({ createdAt: -1 });
  res.json({ status: true, data: reviews });
});

/* DELETE /api/probono-reviews/:id (admin) */
export const deleteProbonoReview = expressAsyncHandler(async (req, res, next) => {
  const review = await ProbonoReview.findByIdAndDelete(req.params.id);
  if (!review) {
    res.status(404);
    return next(new Error("Review not found"));
  }

  const remaining = await ProbonoReview.find({ probono_intern_id: review.probono_intern_id });
  const newRating = remaining.length
    ? Math.round((remaining.reduce((sum, r) => sum + r.rating, 0) / remaining.length) * 10) / 10
    : 5;
  await ProbonoIntern.findByIdAndUpdate(review.probono_intern_id, { rating: newRating });

  res.json({ status: true, message: "Review deleted successfully" });
});
