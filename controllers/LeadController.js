import expressAsyncHandler from "express-async-handler";
import Joi from "joi";
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
    const { name, phone, email, concern, source } = req.body;
    
    // Capture potential alternative field names from frontend for concern
    const finalConcern = concern || req.body.reason || req.body.message || req.body.interest || "Not provided";
    const finalSource = source || req.body.source || "Direct Search";

    console.log("Lead Form Data received:", req.body);

    const lead = await Lead.create({
      name,
      phone,
      email,
      concern: finalConcern,
      source: finalSource,
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