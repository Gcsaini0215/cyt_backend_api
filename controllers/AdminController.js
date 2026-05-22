import expressAsyncHandler from "express-async-handler";
import Admin from "../models/Admin.js";

export const listAdmins = expressAsyncHandler(async (req, res) => {
  const admins = await Admin.find()
    .select("-password -otp")
    .populate("roleId", "name color")
    .lean();
  res.json({ status: true, data: admins });
});

export const createAdmin = expressAsyncHandler(async (req, res) => {
  const { name, email, roleId } = req.body;
  if (!name || !email) {
    res.status(400);
    throw new Error("Name and email are required");
  }
  const existing = await Admin.findOne({ email: email.trim().toLowerCase() });
  if (existing) {
    res.status(400);
    throw new Error("An admin with this email already exists");
  }
  const admin = await Admin.create({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    roleId: roleId || null,
  });
  res.status(201).json({ status: true, message: "Admin added", data: admin });
});

export const updateAdminRole = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const { roleId } = req.body;
  if (req.user._id.toString() === id) {
    res.status(400);
    throw new Error("Cannot change your own role");
  }
  const admin = await Admin.findById(id);
  if (!admin) {
    res.status(404);
    throw new Error("Admin not found");
  }
  admin.roleId = roleId || null;
  await admin.save();
  res.json({ status: true, message: "Role updated", data: admin });
});

export const deleteAdmin = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (req.user._id.toString() === id) {
    res.status(400);
    throw new Error("Cannot delete your own account");
  }
  const admin = await Admin.findById(id);
  if (!admin) {
    res.status(404);
    throw new Error("Admin not found");
  }
  await Admin.findByIdAndDelete(id);
  res.json({ status: true, message: "Admin removed" });
});
