import expressAsyncHandler from "express-async-handler";
import Role from "../models/Role.js";
import Admin from "../models/Admin.js";

export const listRoles = expressAsyncHandler(async (req, res) => {
  const roles = await Role.find().lean();
  res.json({ status: true, data: roles });
});

export const createRole = expressAsyncHandler(async (req, res) => {
  const { name, permissions = [], color } = req.body;
  if (!name || !name.trim()) {
    res.status(400);
    throw new Error("Role name is required");
  }
  const existing = await Role.findOne({ name: name.trim() });
  if (existing) {
    res.status(400);
    throw new Error("A role with this name already exists");
  }
  const role = await Role.create({
    name: name.trim(),
    permissions,
    color: color || "#228756",
    createdBy: req.user._id,
  });
  res.status(201).json({ status: true, message: "Role created", data: role });
});

export const updateRole = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, permissions, color } = req.body;
  const role = await Role.findById(id);
  if (!role) {
    res.status(404);
    throw new Error("Role not found");
  }
  if (name && name.trim()) role.name = name.trim();
  if (permissions !== undefined) role.permissions = permissions;
  if (color) role.color = color;
  await role.save();
  res.json({ status: true, message: "Role updated", data: role });
});

export const deleteRole = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  const inUse = await Admin.countDocuments({ roleId: id });
  if (inUse > 0) {
    res.status(400);
    throw new Error(`Cannot delete: ${inUse} team member(s) still have this role`);
  }
  await Role.findByIdAndDelete(id);
  res.json({ status: true, message: "Role deleted" });
});
