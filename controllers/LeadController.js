import expressAsyncHandler from "express-async-handler";
import Joi from "joi";
import mongoose from "mongoose";
import Lead from "../models/Lead.js";
import { leadNotificationEmail } from "../services/mailTemplates.js";
import { sendMail } from "../helper/mailer.js";
export const saveLead = expressAsyncHandler(async (req, res, next) => {
  const validateSchema = Joi.object({
    name: Joi.string().min(2).required().messages({
      "string.base": "Name must be a text",
      "string.min": "Name must be at least 2 characters long",
      "any.required": "Name is required",
    }),
    phone: Joi.string().pattern(/^[0-9]{10}$/).required().messages({
      "string.pattern.base": "Phone number must be exactly 10 digits",
      "any.required": "Phone number is required",
    }),
    email: Joi.string().email().required().messages({
      "string.email": "Please provide a valid email address",
      "any.required": "Email is required",
    }),
    concern: Joi.string().allow("").optional(),
    source: Joi.string().allow("").optional(),
  }).unknown(true);

  const { error } = validateSchema.validate(req.body);

  if (error) {
    res.status(400);
    return next(new Error(error));
  }

  try {
    const { name, phone, email, concern, source, location, message, reason } = req.body;
    
    // Capture potential alternative field names from frontend for concern (dropdown values)
    // Filter out "Not provided" or empty strings to find a real value
    const getVal = (v) => (v && v !== "Not provided") ? v : null;
    
    const finalConcern = getVal(concern) || getVal(req.body.reason) || getVal(req.body.message) || getVal(req.body.interest) || getVal(req.body.service) || getVal(req.body.dropdown) || getVal(req.body.type) || "Not provided";
    const finalSource = getVal(source) || getVal(req.body.source) || "Direct Search";
    const finalLocation = getVal(location) || getVal(req.body.location) || "Not provided";
    const finalMessage = getVal(message) || getVal(reason) || "Not provided";

    // Create a data object that matches what's sent in the email (excluding large/unnecessary internal fields if any)
    const emailCompatibleData = { ...req.body };

    console.log("Lead Form Data received:", req.body);

    const lead = await Lead.create({
      name,
      phone,
      email,
      concern: finalConcern,
      source: finalSource,
      location: finalLocation,
      message: finalMessage,
      data: emailCompatibleData
    });

    const sendMailid = "chooseyourtherapist@gmail.com"
    const subject = `New Lead: ${name} - Consultation Request`;
    const text = `A new lead has been submitted: ${name}. Phone: ${phone}. Source: ${finalSource}`;
    
    const leadData = {
      ...req.body,
      name: name,
      phone: phone,
      email: email,
      concern: finalConcern,
      source: finalSource
    };

    console.log("Final leadData being passed to template:", leadData);

    const html = leadNotificationEmail(leadData);
    
    console.log("Lead Email HTML generated successfully. Length:", html.length);
    await sendMail(sendMailid, subject, text, html);

    return res.status(201).json({
      status: true,
      message: "Lead saved successfully.",
      data: { id: lead._id },
    });

  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const getLeads = expressAsyncHandler(async (req, res, next) => {
  try {
    const leads = await Lead.find({}).sort({ created_at: -1 });
    
    // Process leads to ensure location and message are available for older records if they exist in the 'data' field
    const processedLeads = leads.map(lead => {
      const leadObj = lead.toObject();
      if (!leadObj.location && leadObj.data) {
        leadObj.location = leadObj.data.location || "Not provided";
      }
      if (!leadObj.message && leadObj.data) {
        leadObj.message = leadObj.data.message || leadObj.data.reason || "Not provided";
      }
      return leadObj;
    });

    return res.status(200).json(processedLeads);
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const deleteLead = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid Lead ID format."));
  }

  try {
    const lead = await Lead.findByIdAndDelete(id);
    if (!lead) {
      res.status(404);
      return next(new Error("Lead not found."));
    }
    return res.status(200).json({
      status: true,
      message: "Lead deleted successfully.",
    });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});