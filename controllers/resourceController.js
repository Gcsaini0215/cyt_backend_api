import expressAsyncHandler from "express-async-handler";
import FileMeta from "../models/FileMeta.js";
import fs from "fs";
import path from "path";

const BASE_URL = process.env.BASE_URL || "https://api.chooseyourtherapist.in";

/* GET /api/resources — active resources (therapist) */
export const getResources = expressAsyncHandler(async (req, res) => {
  const resources = await FileMeta.find({ isActive: true, title: { $ne: "" } })
    .sort({ uploadedAt: -1 });
  res.json({ status: true, data: resources });
});

/* GET /api/resources/all — all (admin) */
export const getAllResources = expressAsyncHandler(async (req, res) => {
  const resources = await FileMeta.find({ title: { $ne: "" } })
    .sort({ uploadedAt: -1 });
  res.json({ status: true, data: resources });
});

/* POST /api/resources — upload PDF (admin) */
export const uploadResourceMeta = expressAsyncHandler(async (req, res) => {
  if (!req.file) { res.status(400); throw new Error("No PDF file uploaded"); }
  const { title, description, category, icon } = req.body;
  const url = `${BASE_URL}/uploads/resources/${req.file.filename}`;
  const resource = await FileMeta.create({
    url,
    fileName:    req.file.originalname,
    fileSize:    req.file.size,
    fileType:    req.file.mimetype,
    title:       title       || req.file.originalname,
    description: description || "",
    category:    category    || "General",
    icon:        icon        || "📄",
    isActive:    true,
    uploadedBy:  req.user?.name || "Admin",
  });
  res.json({ status: true, data: resource, message: "Resource uploaded successfully" });
});

/* DELETE /api/resources/:id (admin) */
export const deleteResource = expressAsyncHandler(async (req, res) => {
  const resource = await FileMeta.findById(req.params.id);
  if (!resource) { res.status(404); throw new Error("Resource not found"); }
  const filename = resource.url.split("/uploads/resources/")[1];
  if (filename) {
    const filePath = path.join(global.appRoot, "uploads/resources", filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  await resource.deleteOne();
  res.json({ status: true, message: "Resource deleted" });
});

/* PATCH /api/resources/:id/toggle (admin) */
export const toggleResource = expressAsyncHandler(async (req, res) => {
  const resource = await FileMeta.findById(req.params.id);
  if (!resource) { res.status(404); throw new Error("Resource not found"); }
  resource.isActive = !resource.isActive;
  await resource.save();
  res.json({ status: true, data: resource, message: `Resource ${resource.isActive ? "activated" : "deactivated"}` });
});
