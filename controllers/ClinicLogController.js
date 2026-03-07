import expressAsyncHandler from "express-async-handler";
import ClinicLog from "../models/ClinicLog.js";

export const saveClinicLog = expressAsyncHandler(async (req, res, next) => {
  const { name, email, phone, date, type, amount, remainingAmount, status, therapist_name, therapist_type } = req.body;

  if (!name || !phone || !amount || !date || !type) {
    res.status(400);
    return next(new Error("Missing required fields"));
  }

  try {
    // req.user._id is populated by isAuthCommon middleware
    const log = await ClinicLog.create({
      therapist: req.user._id,
      name,
      email,
      phone,
      date,
      type,
      amount,
      remainingAmount,
      status,
      therapist_name,
      therapist_type
    });

    return res.status(201).json({
      status: true,
      message: "Clinic log saved successfully.",
      data: log,
    });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const getClinicLogs = expressAsyncHandler(async (req, res, next) => {
  try {
    // Only show logs for the logged-in therapist
    const logs = await ClinicLog.find({ therapist: req.user._id })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      status: true,
      message: "Clinic logs fetched successfully.",
      data: logs,
    });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const updateClinicLog = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  try {
    const log = await ClinicLog.findOneAndUpdate(
      { _id: id, therapist: req.user._id },
      req.body,
      { new: true }
    );
    if (!log) {
      res.status(404);
      return next(new Error("Log not found or not authorized"));
    }
    return res.status(200).json({
      status: true,
      message: "Log updated successfully.",
      data: log,
    });
  } catch (err) {
    return next(new Error(err.message));
  }
});

export const deleteClinicLog = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  try {
    const log = await ClinicLog.findOneAndDelete({ _id: id, therapist: req.user._id });
    if (!log) {
      res.status(404);
      return next(new Error("Log not found or not authorized"));
    }
    return res.status(200).json({
      status: true,
      message: "Log deleted successfully.",
    });
  } catch (err) {
    return next(new Error(err.message));
  }
});
