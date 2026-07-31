import expressAsyncHandler from "express-async-handler";
import ProbonoIntern from "../models/ProbonoIntern.js";

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
  const { name, email, intro, bio, concerns, rating, requestsSent, connected } = req.body;
  if (!name?.trim()) {
    res.status(400);
    throw new Error("Name is required");
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

  const { name, email, intro, bio, concerns, rating, requestsSent, connected, isActive } = req.body;

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
