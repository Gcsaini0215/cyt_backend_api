import expressAsyncHandler from "express-async-handler";
import SessionReport from "../models/SessionReport.js";

const FIELDS = [
  "reportNumber", "clientName", "age", "gender", "occupation", "maritalStatus",
  "sessionDate", "sessionMode", "therapistName", "therapistDesignation",
  "primaryComplaint", "mse", "observation", "riskLevel", "riskNotes", "homework",
];

const pickFields = (body) =>
  FIELDS.reduce((acc, k) => {
    if (body[k] !== undefined) acc[k] = String(body[k] ?? "");
    return acc;
  }, {});

const duplicateMessage = (err) =>
  err.code === 11000 ? "A report with this Report Number already exists." : err.message;

export const createSessionReport = expressAsyncHandler(async (req, res, next) => {
  const data = pickFields(req.body);
  if (!data.reportNumber?.trim() || !data.clientName?.trim() || !data.sessionDate?.trim()) {
    res.status(400);
    return next(new Error("Report number, client name and session date are required"));
  }
  try {
    const report = await SessionReport.create({ ...data, createdBy: req.user._id });
    return res.status(201).json({ status: true, message: "Report saved successfully.", data: report });
  } catch (err) {
    res.status(err.code === 11000 ? 409 : 500);
    return next(new Error(duplicateMessage(err)));
  }
});

export const getSessionReports = expressAsyncHandler(async (req, res, next) => {
  try {
    const reports = await SessionReport.find().sort({ createdAt: -1 });
    return res.status(200).json({ status: true, message: "Reports fetched successfully.", data: reports });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const updateSessionReport = expressAsyncHandler(async (req, res, next) => {
  const data = pickFields(req.body);
  if (
    ("reportNumber" in data && !data.reportNumber.trim()) ||
    ("clientName" in data && !data.clientName.trim()) ||
    ("sessionDate" in data && !data.sessionDate.trim())
  ) {
    res.status(400);
    return next(new Error("Report number, client name and session date cannot be empty"));
  }
  try {
    const report = await SessionReport.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!report) {
      res.status(404);
      return next(new Error("Report not found"));
    }
    return res.status(200).json({ status: true, message: "Report updated successfully.", data: report });
  } catch (err) {
    res.status(err.code === 11000 ? 409 : 500);
    return next(new Error(duplicateMessage(err)));
  }
});

export const deleteSessionReport = expressAsyncHandler(async (req, res, next) => {
  try {
    const report = await SessionReport.findByIdAndDelete(req.params.id);
    if (!report) {
      res.status(404);
      return next(new Error("Report not found"));
    }
    return res.status(200).json({ status: true, message: "Report deleted successfully." });
  } catch (err) {
    return next(new Error(err.message));
  }
});
