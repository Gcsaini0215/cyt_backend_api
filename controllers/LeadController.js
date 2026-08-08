import expressAsyncHandler from "express-async-handler";
import Joi from "joi";
import mongoose from "mongoose";
import crypto from "crypto";
import Lead from "../models/Lead.js";
import { leadNotificationEmail } from "../services/mailTemplates.js";
import { sendMail } from "../helper/mailer.js";

const CONSULT_AMOUNT_RUPEES = 99;
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
    email: Joi.string().email().allow("", null).optional().messages({
      "string.email": "Please provide a valid email address",
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
    
    try {
      console.log("Lead Email HTML generated successfully. Length:", html.length);
      await sendMail(sendMailid, subject, text, html);
    } catch (mailErr) {
      console.error("Lead notification email failed (non-fatal):", mailErr.message);
    }

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

export const verifyConsultPayment = expressAsyncHandler(async (req, res, next) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    name,
    phone,
    email,
    concern,
    source,
  } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    res.status(400);
    return next(new Error("Missing payment verification details"));
  }

  const validateSchema = Joi.object({
    name: Joi.string().min(2).required(),
    phone: Joi.string().pattern(/^[0-9]{10}$/).required().messages({
      "string.pattern.base": "Phone number must be exactly 10 digits",
    }),
    email: Joi.string().email().allow("", null).optional(),
  }).unknown(true);

  const { error } = validateSchema.validate(req.body);
  if (error) {
    res.status(400);
    return next(new Error(error));
  }

  const sign = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSign = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(sign.toString())
    .digest("hex");

  if (razorpay_signature !== expectedSign) {
    res.status(400);
    return next(new Error("Invalid payment signature"));
  }

  try {
    const finalSource = source && source !== "Not provided" ? source : "15-Min Paid Consultation";

    const lead = await Lead.create({
      name,
      phone,
      email,
      concern: concern || "15-Minute Paid Consultation",
      source: finalSource,
      message: "Paid consultation booking (₹" + CONSULT_AMOUNT_RUPEES + ")",
      data: {
        ...req.body,
        amount: CONSULT_AMOUNT_RUPEES,
        payment_status: "Paid",
        razorpay_order_id,
        razorpay_payment_id,
      },
    });

    const sendMailid = "chooseyourtherapist@gmail.com";
    const subject = `New Paid Lead: ${name} - 15-Min Consultation (₹${CONSULT_AMOUNT_RUPEES})`;
    const text = `A new paid consultation was booked: ${name}. Phone: ${phone}. Payment ID: ${razorpay_payment_id}`;

    try {
      const html = leadNotificationEmail({ ...req.body, name, phone, email, concern, source: finalSource });
      await sendMail(sendMailid, subject, text, html);
    } catch (mailErr) {
      console.error("Consult payment notification email failed (non-fatal):", mailErr.message);
    }

    return res.status(201).json({
      status: true,
      message: "Payment verified and consultation booked successfully.",
      data: { id: lead._id },
    });
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