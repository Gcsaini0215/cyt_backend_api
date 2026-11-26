import expressAsyncHandler from "express-async-handler";
import Joi from "joi";
import mongoose from "mongoose";
import crypto from "crypto";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/LeadActivity.js";
import Admin from "../models/Admin.js";
import User from "../models/Users.js";
import Booking from "../models/Booking.js";
import { leadNotificationEmail, institutionLeadEmail, institutionLeadSubject, isInstitutionLead } from "../services/mailTemplates.js";
import { sendMail } from "../helper/mailer.js";
import Razorpay from "razorpay";
import { CONSULT_AMOUNT_RUPEES } from "../helper/consult.js";

export const saveLead = expressAsyncHandler(async (req, res, next) => {
  const validateSchema = Joi.object({
    name: Joi.string().min(2).required().messages({
      "string.base": "Name must be a text",
      "string.min": "Name must be at least 2 characters long",
      "any.required": "Name is required",
    }),
    // Indian numbers come as 10 digits; other countries in full international form ("+966501234567")
    phone: Joi.string().pattern(/^([0-9]{10}|\+[1-9][0-9]{6,14})$/).required().messages({
      "string.pattern.base": "Please enter a valid mobile number",
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

    console.log(`Lead form received from ${name || "unknown"}`);

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
    // Schools & Colleges / Corporate (EAP) enquiries get their own full email (institution, size, needs, timeline…)
    const institution = isInstitutionLead(req.body);
    const subject = institution ? institutionLeadSubject(req.body) : `New Lead: ${name} - Consultation Request`;
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

    const html = institution ? institutionLeadEmail(leadData) : leadNotificationEmail(leadData);
    
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
    const leads = await Lead.find({}).sort({ created_at: -1 }).populate("assignedTo", "name email");
    const me = String(req.user?._id || "");
    const pickView = req.query?.view === "pick";
    const superAdmin = isSuper(req);
    const last10 = (p) => String(p || "").replace(/\D/g, "").slice(-10);

    // the same phone number filling a form again → "came N times" with the dates
    const byPhone = {};
    leads.forEach((l) => { const k = last10(l.phone); if (k.length === 10) (byPhone[k] = byPhone[k] || []).push(l.created_at); });

    // numbers that already have a CYT client account → their paid sessions
    const p10 = Object.keys(byPhone);
    const users = p10.length ? await User.find({ phone: { $in: [...p10, ...p10.map((p) => "91" + p), ...p10.map((p) => "+91" + p)] } }).select("_id phone name").lean() : [];
    const sess = users.length ? await Booking.aggregate([{ $match: { client: { $in: users.map((u) => u._id) }, payment_status: "Paid" } }, { $group: { _id: "$client", n: { $sum: 1 }, last: { $max: "$booking_date" } } }]) : [];
    const sessBy = Object.fromEntries(sess.map((s) => [String(s._id), s]));
    const clientBy = {};
    users.forEach((u) => { clientBy[last10(u.phone)] = { id: u._id, sessions: sessBy[String(u._id)]?.n || 0, last: sessBy[String(u._id)]?.last || null }; });

    // who picked / contacted / closed it, and when — the steps on each lead card
    const acts = await LeadActivity.find({ lead: { $in: leads.map((l) => l._id) } }).sort({ createdAt: 1 }).select("lead action status remark adminName createdAt").lean();
    const histBy = {};
    acts.forEach((a) => { (histBy[String(a.lead)] = histBy[String(a.lead)] || []).push({ action: a.action || "status", status: a.status, remark: a.remark, by: a.adminName, at: a.createdAt }); });

    // popup leads pack "Age: 26\nLocation: Noida\nConcern: …" into one field — pull the parts out
    const part = (txt, key) => { const m = String(txt || "").match(new RegExp(`${key}\\s*:\\s*([^\\n]*)`, "i")); return m ? m[1].trim() : ""; };

    const processedLeads = leads.map(lead => {
      const leadObj = lead.toObject();
      if (!leadObj.location && leadObj.data) {
        leadObj.location = leadObj.data.location || "Not provided";
      }
      if (!leadObj.message && leadObj.data) {
        leadObj.message = leadObj.data.message || leadObj.data.reason || "Not provided";
      }
      const k = last10(leadObj.phone);
      const raw = leadObj.data?.concern || leadObj.concern || "";
      leadObj.extra = {
        form: leadObj.data?.subject || (leadObj.data?.type === "internship" ? "Internship enquiry" : leadObj.source === "Noida Offer" ? "Noida offer" : /callback/i.test(leadObj.concern || "") ? "Callback" : ""),
        age: part(raw, "Age"),
        city: part(raw, "Location") || part(raw, "City"),
        trainee: (String(raw).match(/preferred trainee:\s*([^,\n]+)/i) || [])[1]?.trim() || "",
        offerCode: leadObj.data?.code || "",
        visits: (byPhone[k] || []).length || 1,
        visitDates: byPhone[k] || [],
        client: clientBy[k] || null,
        history: histBy[String(leadObj._id)] || [],
      };
      leadObj.mine = !!leadObj.assignedTo && String(leadObj.assignedTo._id) === me;
      // Leads page (?view=pick): a team member sees the phone and email only after picking the lead
      if (pickView && !leadObj.mine && !superAdmin) {
        leadObj.phone = ""; leadObj.email = "";
        if (leadObj.data) { const { phone, email, ...rest } = leadObj.data; leadObj.data = rest; }
        leadObj.hidden = true;
      }
      return leadObj;
    });

    return res.status(200).json(processedLeads);
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const getProbonoLeads = expressAsyncHandler(async (req, res, next) => {
  try {
    const leads = await Lead.find({ source: "Probono Therapist Page" }).sort({ created_at: -1 });
    return res.status(200).json({ status: true, data: leads });
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

  // the order must be a consultation order for the full price (BookingController.createRazorpayOrder)
  try {
    const rz = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    const order = await rz.orders.fetch(razorpay_order_id);
    if (!order || !String(order.receipt || "").startsWith("rcpt_consult_") || Number(order.amount) !== CONSULT_AMOUNT_RUPEES * 100) {
      console.error("Consult payment: order doesn't match", { razorpay_order_id, receipt: order?.receipt, amount: order?.amount });
      res.status(400);
      return next(new Error(`This payment couldn't be matched to a consultation. Please contact us with payment ID ${razorpay_payment_id}.`));
    }
  } catch (e) {
    console.error("Consult payment: could not fetch the order:", e?.error?.description || e.message);
    res.status(502);
    return next(new Error(`We couldn't confirm your payment right now. Please contact us with payment ID ${razorpay_payment_id}.`));
  }
  // a retry with the same payment: don't make a second lead
  const existingLead = await Lead.findOne({ "data.razorpay_payment_id": razorpay_payment_id }).lean();
  if (existingLead) return res.status(200).json({ status: true, message: "Payment verified and consultation booked successfully.", data: { id: existingLead._id } });

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
      const html = leadNotificationEmail({ ...req.body, name, phone, email, concern, source: finalSource, amount: CONSULT_AMOUNT_RUPEES });
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

const isSuper = (req) => !req.user?.roleId;

/* Pick a lead: the one write below only succeeds while the lead has no owner, so when two team
   members tap Pick at the same moment exactly one gets it and the other is told who did. */
export const pickLead = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); return next(new Error("Invalid Lead ID format.")); }
  const me = req.user._id;
  const lead = await Lead.findOneAndUpdate({ _id: id, assignedTo: null }, { assignedTo: me, pickedAt: new Date() }, { new: true })
    .populate("assignedTo", "name email");
  if (!lead) {
    const exists = await Lead.findById(id).populate("assignedTo", "name");
    if (!exists) { res.status(404); return next(new Error("Lead not found.")); }
    if (String(exists.assignedTo?._id) === String(me)) return res.status(200).json({ status: true, message: "Already yours.", data: exists });
    res.status(409);
    return res.json({ status: false, message: `Already picked by ${exists.assignedTo?.name || "someone else"}.`, data: exists });
  }
  await LeadActivity.create({ lead: id, action: "pick", status: lead.status || "new", remark: "", admin: me, adminName: req.user.name }).catch(() => {});
  return res.status(200).json({ status: true, message: "Picked. It's yours now.", data: lead });
});

// Give a picked lead back to the open list (its owner, or the super admin).
export const releaseLead = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); return next(new Error("Invalid Lead ID format.")); }
  const filter = isSuper(req) ? { _id: id } : { _id: id, assignedTo: req.user._id };
  const lead = await Lead.findOneAndUpdate(filter, { assignedTo: null, pickedAt: null }, { new: true });
  if (!lead) { res.status(409); return next(new Error("Only the person who picked this lead can release it.")); }
  await LeadActivity.create({ lead: id, action: "release", status: lead.status || "new", remark: String(req.body?.remark || "").trim().slice(0, 300), admin: req.user._id, adminName: req.user.name }).catch(() => {});
  return res.status(200).json({ status: true, message: "Released. Anyone can pick it now.", data: lead });
});

// A note on a lead, saved on the server so the whole team sees it (was browser-only before).
export const addLeadNote = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const text = String(req.body?.note || "").trim().slice(0, 1000);
  if (!mongoose.Types.ObjectId.isValid(id)) { res.status(400); return next(new Error("Invalid Lead ID format.")); }
  if (!text) { res.status(400); return next(new Error("Write a note first.")); }
  const lead = await Lead.findById(id).select("status");
  if (!lead) { res.status(404); return next(new Error("Lead not found.")); }
  const a = await LeadActivity.create({ lead: id, action: "note", status: lead.status || "new", remark: text, admin: req.user._id, adminName: req.user.name });
  return res.status(200).json({ status: true, message: "Note saved", data: { action: "note", status: a.status, remark: a.remark, by: a.adminName, at: a.createdAt } });
});

// Statuses that represent an actual action taken on the lead — these
// require the team member to leave a remark, so the superadmin activity
// feed always has context for what happened, not just a bare status flip.
const STATUSES_REQUIRING_REMARK = ["contacted", "converted", "lost", "completed"];

export const updateLeadStatus = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { status, remark } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid Lead ID format."));
  }

  const validStatuses = ["new", "contacted", "converted", "lost", "completed"]; // completed = old lead closed from Open
  if (!validStatuses.includes(status)) {
    res.status(400);
    return next(new Error("Invalid status value."));
  }

  if (STATUSES_REQUIRING_REMARK.includes(status) && !remark?.trim()) {
    res.status(400);
    return next(new Error("A remark is required when marking a lead as contacted, converted, or lost."));
  }

  try {
    const me = req.user._id;
    const superAdmin = isSuper(req);
    // Only the lead's owner (or the super admin) changes its stage. An unpicked lead is picked by
    // whoever changes it — in the same single write, so two people can never both get it.
    let lead = await Lead.findOneAndUpdate({ _id: id, assignedTo: me }, { status }, { new: true });
    if (!lead) {
      lead = await Lead.findOneAndUpdate({ _id: id, assignedTo: null }, { status, assignedTo: me, pickedAt: new Date() }, { new: true });
      if (lead) await LeadActivity.create({ lead: id, action: "pick", status, remark: "", admin: me, adminName: req.user.name }).catch(() => {});
    }
    if (!lead && superAdmin) lead = await Lead.findByIdAndUpdate(id, { status }, { new: true });
    if (!lead) {
      const exists = await Lead.findById(id).populate("assignedTo", "name");
      if (!exists) { res.status(404); return next(new Error("Lead not found.")); }
      res.status(409);
      return next(new Error(`${exists.assignedTo?.name || "Someone else"} has picked this lead. Only they can change it.`));
    }
    lead = await Lead.findById(id).populate("assignedTo", "name email");

    const activity = await LeadActivity.create({
      lead: id,
      status,
      remark: remark?.trim() || "",
      admin: req.user._id,
      adminName: req.user.name,
    });

    return res.status(200).json({
      status: true,
      message: "Lead status updated",
      data: { lead, activity },
    });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Assigns (or unassigns, with adminId: null) a lead to a team member and
// emails them the lead details — the same notification the fixed inbox
// already gets, just addressed to whoever now owns following it up.
export const assignLead = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { adminId } = req.body;
  const note = String(req.body?.remark || "").trim().slice(0, 500);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid Lead ID format."));
  }
  // referring a lead on to a teammate needs a note, so they know what has happened so far
  if (adminId && !isSuper(req) && !note) {
    res.status(400);
    return next(new Error("Write a note for the person you're referring this lead to."));
  }
  if (adminId && String(adminId) === String(req.user._id) && !isSuper(req)) {
    res.status(400);
    return next(new Error("Pick the lead instead of referring it to yourself."));
  }

  let admin = null;
  if (adminId) {
    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      res.status(400);
      return next(new Error("Invalid team member ID."));
    }
    admin = await Admin.findById(adminId).select("name email");
    if (!admin) {
      res.status(404);
      return next(new Error("Team member not found."));
    }
  }

  try {
    // Team members can only hand on a lead that is free or their own; taking one away from
    // someone else is for the super admin. The check and the write are one step.
    const filter = isSuper(req) ? { _id: id } : { _id: id, $or: [{ assignedTo: req.user._id }, { assignedTo: null }] };
    const lead = await Lead.findOneAndUpdate(filter, { assignedTo: adminId || null, pickedAt: adminId ? new Date() : null }, { new: true })
      .populate("assignedTo", "name email");
    if (!lead) {
      const exists = await Lead.findById(id).populate("assignedTo", "name");
      if (!exists) { res.status(404); return next(new Error("Lead not found.")); }
      res.status(409);
      return next(new Error(`${exists.assignedTo?.name || "Someone else"} has this lead. Only the super admin can move it.`));
    }
    await LeadActivity.create({ lead: id, action: adminId ? "assign" : "release", status: lead.status || "new", remark: admin ? `Referred to ${admin.name}${note ? `: ${note}` : ""}` : "Back to open leads", admin: req.user._id, adminName: req.user.name }).catch(() => {});

    if (admin?.email) {
      try {
        const full = { ...(lead.data || {}), name: lead.name, phone: lead.phone, email: lead.email, concern: lead.concern, source: lead.source, location: lead.location, message: lead.message };
        const institution = isInstitutionLead(full);
        await sendMail(
          admin.email,
          institution ? institutionLeadSubject(full, { assigned: true }) : `🔔 Lead Assigned to You: ${lead.name}`,
          `A lead has been assigned to you: ${lead.name}, ${lead.phone}.`,
          institution
            ? institutionLeadEmail(full, { assignedTo: admin.name || "you" })
            : leadNotificationEmail({ ...full, source: "Assigned to you" })
        );
      } catch (mailErr) {
        console.error("Lead assignment email failed (non-fatal):", mailErr.message);
      }
    }

    return res.status(200).json({ status: true, message: admin ? "Lead assigned." : "Lead unassigned.", data: lead });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

// Superadmin-only audit feed: every status change any team member has made
// across every lead, newest first, with lead + admin attribution attached.
export const getLeadActivity = expressAsyncHandler(async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 30));

    const [items, total] = await Promise.all([
      LeadActivity.find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .populate("lead", "name phone email")
        .lean(),
      LeadActivity.countDocuments({}),
    ]);

    return res.status(200).json({
      status: true,
      data: items,
      total,
      page,
      pages: Math.ceil(total / pageSize) || 1,
    });
  } catch (err) {
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const deleteLeadActivity = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error("Invalid activity ID format."));
  }

  try {
    const activity = await LeadActivity.findByIdAndDelete(id);
    if (!activity) {
      res.status(404);
      return next(new Error("Activity entry not found."));
    }
    return res.status(200).json({
      status: true,
      message: "Activity entry deleted.",
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