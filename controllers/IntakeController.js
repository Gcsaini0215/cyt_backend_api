import IntakeClient from "../models/IntakeClient.js";

export const getIntakeClients = async (req, res) => {
  const clients = await IntakeClient.find().sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: clients });
};

export const createIntakeClient = async (req, res) => {
  const existing = await IntakeClient.findOne({ id: req.body.id });
  if (existing) return res.json({ success: true, data: existing });
  const client = await IntakeClient.create(req.body);
  res.json({ success: true, data: client });
};

export const updateIntakeClient = async (req, res) => {
  const client = await IntakeClient.findOneAndUpdate(
    { id: req.params.id },
    req.body,
    { new: true, upsert: true, lean: true }
  );
  res.json({ success: true, data: client });
};

export const deleteIntakeClient = async (req, res) => {
  await IntakeClient.findOneAndDelete({ id: req.params.id });
  res.json({ success: true });
};
