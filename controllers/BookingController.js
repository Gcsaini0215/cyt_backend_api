import expressAsyncHandler from "express-async-handler";
import Joi from "joi";
import Booking from "../models/Booking.js";
import NoidaAppointment from "../models/NoidaAppointment.js";
import { bookingSplit } from "../helper/payoutSplit.js";
import { busyStarts, busyNear, SESSION_MIN } from "../helper/therapistBusy.js";
import mongoose from "mongoose";
import Therapists from "../models/Therapists.js";
import { generate6DigitOTP, generateQrCode } from "../helper/generate.js";
import UPIInfo from "../models/UPIInfo.js";
import Users from "../models/Users.js";
import { sendMail } from "../helper/mailer.js";
import Transaction from "../models/Transaction.js";
import { PAYMENT_STATUS, SESSION_STATUS } from "../helper/status.js";
import generateToken from "../config/generateToken.js";
import PaymentStatus from "../models/PaymentStatus.js";
import Razorpay from "razorpay";
import crypto from "crypto";
import { resolveReferral, settleBookingRewards, REFERRAL_AMOUNT } from "../helper/referral.js";
import { notifyClient, changed as clientBookingsChanged } from "../services/clientNotify.js";

const getRazorpayInstance = () => {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
};

// Human-readable appointment slot in IST, e.g. "Mon, 1 Sep 2026, 02:00 pm IST"
const formatSlotIST = (d) => {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "To be confirmed";
  return (
    dt.toLocaleString("en-IN", {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
    }) + " IST"
  );
};

const formatSessionMode = (t) =>
  ({ video: "Video Call", audio: "Voice Call", "in-person": "In-Person" }[
    String(t || "").toLowerCase()
  ] || (t ? String(t) : "—"));
import { createMeetWithTimeout, isOnlineFormat, sessionWindow, deleteMeetEvent, moveMeetEvent, JOIN_EARLY_MIN } from "../helper/googleMeet.js";
import { sessionStartOtpMail, adminText, bookingCancelledMail, bookingConfirmationMail, bookingRequestReceivedMail, sessionRescheduledMail, clientText, newSessionAdminMail, otpVerificationEmail, therapistSessionMail, therapistText } from "../services/mailTemplates.js";
import { pushToUsers } from "./PushController.js";
import { notifyTherapists, therapistUserId } from "../services/therapistNotify.js";
import { attachBookingAssessments } from "./AssessmentRequestController.js";
import { assessmentsActive } from "./TherapistAddonController.js";
import { getPricing } from "../helper/assessmentPricing.js";
import { findUsableCoupon } from "../helper/coupon.js";
import SessionBundle from "../models/SessionBundle.js";
import { feeFor, packPrice, isUsable, takeSession, returnSession, activatePackFor } from "../helper/sessionBundle.js";
import Jwt from "jsonwebtoken";

// the signed-in user behind this request (Bearer token), or "" — /book-therapist has no auth middleware
const tokenUserId = (req) => {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return "";
  try { return String(Jwt.verify(h.slice(7), process.env.JWT_SECRET, { algorithms: ["HS256"] }).userId || ""); } catch { return ""; }
};

export const bookTherapist = expressAsyncHandler(async (req, res, next) => {
  const validateSchema = Joi.object({
    is_logged_in: Joi.boolean().required().messages({
      "boolean.base": "is_logged_in must be true or false",
      "any.required": "is_logged_in flag is required",
    }),
    name: Joi.string().min(2).optional().allow("", null),
    email: Joi.string().email().optional().allow("", null),
    phone: Joi.string().pattern(/^[0-9]{10}$/).optional().allow("", null),


    user_id: Joi.string()
      .when("is_logged_in", {
        is: true,
        then: Joi.required(),
        otherwise: Joi.optional().allow(null, ""),
      })
      .messages({
        "any.required": "user_id is required for logged-in users",
        "string.base": "user_id must be a string",
      }),
    service: Joi.string().required().messages({
      "string.base": "Service must be a string",
      "string.empty": "Service is required",
      "any.required": "Service is required",
    }),
    format: Joi.string().required().messages({
      "string.base": "Format must be a string",
      "string.empty": "Format is required",
      "any.required": "Format is required",
    }),
    whom: Joi.when("is_logged_in", {
      is: true,
      then: Joi.string().valid("For Other", "Self").required().messages({
        "string.base": "Whom must be a string",
        "string.empty": "Whom is required",
        "any.required": "Whom is required",
        "any.only": 'Whom must be one of "For Other" or "Self"',
      }),
      otherwise: Joi.optional().allow("", null),
    }),
    cname: Joi.string()
      .min(2)
      .when("whom", {
        is: "For Other",
        then: Joi.required(),
        otherwise: Joi.optional().allow(""),
      })
      .messages({
        "string.base": "Client name must be a text",
        "string.min": "Client name must be at least 2 characters long",
        "any.required": "Client name is required when booking for others",
      }),

    relation_with_client: Joi.string()
      .min(2)
      .when("whom", {
        is: "For Other",
        then: Joi.required(),
        otherwise: Joi.optional().allow(""),
      })
      .messages({
        "string.base": "Relation must be a text",
        "string.min": "Relation must be at least 2 characters long",
        "any.required": "Relation with client is required when booking for others",
      }),

    therapist: Joi.string().required().messages({
      "any.required": "Therapist ID is required",
      "string.base": "Therapist ID must be a string",
    }),
    amount: Joi.number().min(0).required().messages({
      "number.base": "Amount must be a number",
      "number.min": "Amount must be greater than or equal to 0",
      "any.required": "Amount is required",
    }),
    age: Joi.alternatives()
      .try(Joi.number().integer().min(1).max(120), Joi.string().allow("", null))
      .optional(),
    booking_date: Joi.date().optional(),
    session_type: Joi.string().optional().allow("", null),

  }).unknown(true);

  const { error } = validateSchema.validate(req.body);

  if (error) {
    res.status(400);
    return next(new Error(error));
  }

  // clinical assessments booked with the session: priced here (admin pricing), only with a therapist
  // whose Clinical Assessments add-on is active; the amount must cover them
  let assessmentLines = [], assessmentFee = 0, assessmentShare = 0;
  const wanted = [...new Set((Array.isArray(req.body.assessments) ? req.body.assessments : []).map(String))];
  if (wanted.length) {
    if (wanted.length > 3) { res.status(400); return next(new Error("You can add up to 3 assessments to a session.")); }
    const pricing = await getPricing();
    const th = await Therapists.findById(req.body.therapist).select("user").lean();
    if (!th || !(await assessmentsActive(th.user))) { res.status(400); return next(new Error("This therapist doesn't offer clinical assessments.")); }
    for (const k of wanted) {
      const t = pricing.tests[k];
      if (!t || !t.active) { res.status(400); return next(new Error("One of the chosen assessments isn't available.")); }
      assessmentLines.push({ tool: k, fee: t.price });
    }
    assessmentFee = assessmentLines.reduce((n, l) => n + l.fee, 0);
    assessmentShare = Math.round(assessmentFee * pricing.therapistShare);
    if (Number(req.body.amount) < assessmentFee) { res.status(400); return next(new Error("The amount doesn't cover the chosen assessments. Please refresh and try again.")); }
  }

  // session packs (helper/sessionBundle.js): buy one with this booking (pack_size), or book one of the
  // sessions of a pack already bought (bundle_id). Priced here, never from the browser; no other discounts.
  const packSize = Number(req.body.pack_size) || 0;
  const bundleId = req.body.bundle_id ? String(req.body.bundle_id) : "";
  let pack = null, useBundle = null;
  if (packSize || bundleId) {
    if (wanted.length || req.body.coupon || req.body.referral_code || Number(req.body.credit_used) > 0) {
      res.status(400); return next(new Error("A session pack can't be combined with coupons, referral credit or assessments."));
    }
  }
  if (packSize) {
    const fee = await feeFor(req.body.therapist, req.body.service, req.body.format);
    pack = fee ? packPrice(fee, packSize) : null;
    if (!pack) { res.status(400); return next(new Error("This session pack isn't available for this session. Please refresh and try again.")); }
  } else if (bundleId) {
    const me = tokenUserId(req);
    if (!req.body.is_logged_in || !me || me !== String(req.body.user_id) || !mongoose.Types.ObjectId.isValid(bundleId)) {
      res.status(401); return next(new Error("Please sign in to book from your session pack."));
    }
    useBundle = await SessionBundle.findById(bundleId).lean();
    if (!isUsable(useBundle) || String(useBundle.client) !== me || String(useBundle.therapist) !== String(req.body.therapist)) {
      res.status(400); return next(new Error("This session pack can't be used for this booking — it may have no sessions left or have expired."));
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      name,
      phone,
      service,
      format,
      whom,
      cname,
      relation_with_client,
      age,
      amount,
      notes,
      therapist,
      user_id,
      is_logged_in,
      guest_email_verified,
      booking_date,
      session_type,
    } = req.body;

    // Resolve the chosen appointment slot; fall back to now only if unparseable
    const parsedBookingDate =
      booking_date && !isNaN(new Date(booking_date).getTime())
        ? new Date(booking_date)
        : new Date();



    if (!mongoose.Types.ObjectId.isValid(therapist)) {
      res.status(400);
      return next(new Error("Therapist Not Found."));
    }

    const isExist = await Therapists.findById(therapist).populate("user", "name");

    if (!isExist) {
      res.status(400);
      return next(new Error("Therapist not exist."));
    }

    let user;
    const generatedOtp = generate6DigitOTP();
    let otp_count = 1;
    let email = req.body.email;

    if (is_logged_in) {
      if (!mongoose.Types.ObjectId.isValid(user_id)) {
        res.status(400);
        return next(new Error("Invalid user id."));
      }
      user = await Users.findById(user_id);
      if (!user) {
        res.status(400);
        return next(new Error("User not found."));
      }

      user.otp = generatedOtp;
      user.otp_count = otp_count;
      await user.save({ session });
    } else {
      if (!email) {
        res.status(400);
        return next(new Error("Email is required to book a session."));
      }
      if (!guest_email_verified) {
        res.status(400);
        return next(new Error("Please verify your email before booking."));
      }
      email = email.toLowerCase();
      user = await Users.findOne({ email }).session(session);
      if (user) {
        if (user.is_verified === 1) {
          res.status(400);
          return next(new Error("This user is already registered with us as a Therapist"));
        }
        user.otp = generatedOtp;
        user.otp_count = otp_count;
        if (name && !user.name) user.name = name;
        if (phone && !user.phone) user.phone = phone;
        if (age && whom !== "For Other" && !user.age) user.age = age;
        await user.save({ session });
      } else {
        user = await Users.create(
          [{
            name:  name || email.split("@")[0],
            email,
            phone: phone || "",
            otp:   generatedOtp,
            otp_count,
            age,
          }],
          { session }
        );
        user = user[0];
      }
    }

    // A friend's referral code (first session only) and the client's own referral credit.
    // Re-checked here — the discount shown on the booking page is only a preview.
    let referral_code = "", referral_discount = 0, credit_used = 0;
    if (req.body.referral_code) {
      const ref = await resolveReferral({ code: req.body.referral_code, email: user.email });
      if (ref && !ref.error) { referral_code = ref.referrer.referral_code; referral_discount = REFERRAL_AMOUNT; }
    }
    // the therapist's own coupon — recorded on the booking; it counts as used once the booking is paid
    let coupon_id = null, coupon_code = "";
    if (req.body.coupon && !referral_code) {
      const found = await findUsableCoupon(therapist, req.body.coupon);
      if (found.coupon) { coupon_id = found.coupon._id; coupon_code = found.coupon.code; }
    }
    const wantCredit = Math.max(0, Number(req.body.credit_used) || 0);
    if (wantCredit && is_logged_in) credit_used = Math.min(wantCredit, Number(user.referral_credit) || 0);

    // Prevent double-booking the same therapist slot. A slot is "taken" if a
    // paid booking exists for it, or someone else's pending one was started in the
    // last 20 minutes (mid-checkout). Abandoned carts free up — at once when the
    // client closes Razorpay (slot_released_at), otherwise after 20 minutes.
    const pendingCutoff = mongoose.Types.ObjectId.createFromTime(
      Math.floor((Date.now() - 20 * 60 * 1000) / 1000)
    );
    const slotConflict = await Booking.findOne({
      therapist,
      booking_date: parsedBookingDate,
      status: { $ne: "Cancelled" },
      $or: [
        { payment_status: "Paid" },
        { payment_status: "Pending Payment", _id: { $gt: pendingCutoff }, slot_released_at: null, client: { $ne: user._id } },
      ],
    }).session(session);
    if (slotConflict || await busyNear(therapist, parsedBookingDate, { excludeClient: user._id })) {
      res.status(409);
      return next(new Error("That time slot has just been taken. Please pick another slot."));
    }

    const booked = await Booking.create(
      [{
        therapist,
        client: user._id,
        // a pack session is always the pack's own service + format (that's what it was priced on)
        service: useBundle ? useBundle.service : service,
        format: useBundle ? useBundle.format : format,
        session_type: session_type || "",
        booking_date: parsedBookingDate,
        whom,
        cname,
        age,
        relation_with_client,
        notes,
        amount: pack ? pack.per_session : useBundle ? useBundle.per_session : amount,
        ...(pack ? { pack_size: pack.size, pack_fee: pack.fee, pack_total: pack.total } : {}),
        otp: generatedOtp,
        guest_email_verified: !is_logged_in && !!guest_email_verified,
        payment_status: "Pending Payment",
        referral_code,
        referral_discount,
        credit_used,
        coupon_id,
        coupon_code,
        assessments: assessmentLines,
        assessment_fee: assessmentFee,
        assessment_therapist_share: assessmentShare,
      }],
      { session }
    );

    // The "complete your payment" email is no longer sent here (the client is usually still on
    // the Razorpay screen). services/pendingPaymentMail.js sends it only if the booking is
    // still unpaid 10 minutes later.

    await session.commitTransaction();
    session.endSession();

    // from a pack: nothing to pay — take one of its sessions and confirm the booking now
    if (useBundle) {
      const b = await takeSession(useBundle._id, user._id, therapist);
      if (!b) {
        await Booking.deleteOne({ _id: booked[0]._id });
        res.status(400);
        return next(new Error("Your session pack has no sessions left."));
      }
      const tx = await Transaction.create({
        booking: booked[0]._id, bookingModel: "Booking", user: user._id, amount: useBundle.per_session,
        payment_method: "Session pack", status: PAYMENT_STATUS.SUCCESS, is_payment_success: true,
        transaction_id: `PACK-${String(b._id).slice(-6).toUpperCase()}-${b.used}`,
      });
      await Booking.updateOne({ _id: booked[0]._id }, { $set: { transaction: tx._id, payment_status: "Paid", bundle: b._id } });
      // emails + Meet link take a few seconds — answer first, confirm in the background
      loadForConfirm(booked[0]._id).then((full) => confirmPaidBooking(full, tx.transaction_id))
        .catch((e) => console.error("[pack] confirm failed:", e.message));
      return res.status(201).json({
        status: true,
        message: "Session booked from your pack.",
        data: { id: booked[0]._id, paid: true, pack_left: Math.max(0, b.size - b.used) },
      });
    }

    return res.status(201).json({
      status: true,
      message: "Booking saved successfully.",
      data: { id: booked[0]._id, ...(pack ? { amount: pack.total } : {}) },
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(new Error(err.message || "Something went wrong"));
  }
});

export const generatePaymentQR = expressAsyncHandler(async (req, res, next) => {
  const bookingId = req.params.id;
  if (!bookingId) {
    res.status(400);
    return next(new Error("Please pass booking ID"));
  }
  try {
    const getUpi = await UPIInfo.findOne();

    if (!getUpi) {
      res.status(400);
      return next(new Error("Id Not found!"));
    }
    const isBookingDetail = await Booking.findById(bookingId);
    if (!isBookingDetail) {
      res.status(400);
      return next(new Error("booking not found with this id"));
    }

    const data = {
      upiID: getUpi.upi_id,
      name: getUpi.name,
      amount: isBookingDetail.amount,
      note: "Booking Therapist",
    };

    const qrImage = await generateQrCode(data);
    const retrunData = {
      qrImage,
      upi_details: getUpi,
      booking_id: isBookingDetail._id,
    };
    res.status(201).json({
      status: true,
      message: "QR has been generated.",
      data: retrunData,
    });
  } catch (err) {
    return next(new Error(err.message));
  }
});

export const saveTransactionId = expressAsyncHandler(async (req, res, next) => {
  const validateSchema = Joi.object({
    transactionId: Joi.string().required().messages({
      "string.base": "Transaction ID must be a string",
      "string.empty": "Transaction ID is required",
      "any.required": "Transaction ID is required",
    }),

    booking_id: Joi.string().required().messages({
      "string.base": "Booking ID must be a string",
      "string.empty": "Booking ID is required",
      "any.required": "Booking ID is required",
    }),
  }).unknown(true);
  const { error } = validateSchema.validate(req.body);

  if (error) {
    res.status(400);
    return next(new Error(error));
  }

  try {

    const { transactionId, booking_id } = req.body;

    if (!mongoose.Types.ObjectId.isValid(booking_id)) {
      res.status(400);
      return next(new Error("Booking invalid."));
    }
    const isBookingDetail = await Booking.findById(booking_id).populate("client", "_id name email age role").populate({
      path: "therapist",
      select: "_id user profile_code",
      populate: {
        path: "user",
        select: "name profile email"
      }
    });
    if (!isBookingDetail) {
      res.status(400);
      return next(new Error("booking not found with this id"));
    }

    const data = {
      booking: isBookingDetail._id,
      bookingModel: "Booking",
      user: isBookingDetail.client._id,
      amount: isBookingDetail.amount,
      payment_method: "UPI",
      status: PAYMENT_STATUS.UNDERPROCESS,
      is_payment_success: true,
      transaction_id: transactionId,
    };

    const savedTransaction = await Transaction.create(data);
    if (!savedTransaction) {
      res.status(400);
      return next(new Error("Failed to save transaction."));
    }
    isBookingDetail.transaction = savedTransaction._id;
    isBookingDetail.payment_status = "Paid";
    await isBookingDetail.save();
    attachBookingAssessments(isBookingDetail); // clinical assessments booked with it → sent to the client to complete before the session

    // tell the therapist this instant — before the Meet link and emails, which take a few seconds
    notifyTherapists([isBookingDetail.therapist.user._id], {
      type: "booking", title: "New session booked",
      body: `${isBookingDetail.client?.name || "A client"} · ${isBookingDetail.service || "Session"} · ${formatSlotIST(isBookingDetail.booking_date)}`,
      link: "/appointments", ref: `booking:${isBookingDetail._id}`,
    });

    // online session + therapist connected Google → a Meet link on their calendar (never blocks confirmation)
    const meet = await createMeetWithTimeout(isBookingDetail);
    if (meet) {
      isBookingDetail.meet_link = meet.link;
      isBookingDetail.calendar_event_id = meet.eventId;
      await Booking.updateOne({ _id: isBookingDetail._id }, { $set: { meet_link: meet.link, calendar_event_id: meet.eventId } });
    }
    const meetLink = isBookingDetail.meet_link || "";

    const therapistName = isBookingDetail.therapist.user.name;
    const therapistId = isBookingDetail.therapist.profile_code;
    const clientName = isBookingDetail.client.name;
    const clientAge = isBookingDetail.client.age;
    const paymentAmount = isBookingDetail.amount;
    const pin = isBookingDetail.otp;
    const service = isBookingDetail.service;
    const format = isBookingDetail.format;
    const whom = isBookingDetail.whom;
    const cname = isBookingDetail.cname;
    const relation_with_client = isBookingDetail.relation_with_client;
    const notes = isBookingDetail.notes;
    const sessionDateTime = formatSlotIST(isBookingDetail.booking_date);
    const sessionMode = formatSessionMode(isBookingDetail.session_type);


    //Client Mail
    const subjectClient = `Session Confirmed! ${isBookingDetail.therapist.user.name} · ${sessionDateTime}`;
    const textClient = clientText(isBookingDetail, transactionId);
    const clientHtml = bookingConfirmationMail({
      clientName,
      therapistName,
      clientAge,
      transactionId: transactionId,
      service,
      format,
      sessionDateTime,
      sessionMode,
      whom,
      cname,
      relation_with_client,
      notes,
      meetLink

    });
    const clientMailSent = await sendMail(isBookingDetail.client.email, subjectClient, textClient, clientHtml);
    if (!clientMailSent) console.error(`[saveTransactionId] Client mail FAILED to ${isBookingDetail.client.email} for booking ${isBookingDetail._id}`);

    //Therapist Mail
    const subjectTherapist = `NEW SESSION: ${clientName} · ${sessionDateTime} · ${service || 'General'}`;
    const textTherapist = therapistText(isBookingDetail, transactionId);
    const therapistHtml = therapistSessionMail({
      therapistName,
      clientName,
      clientAge,
      paymentAmount,
      transactionId,
      service,
      format,
      sessionDateTime,
      sessionMode,
      whom,
      cname,
      relation_with_client,
      notes,
      meetLink
    })
    if (!isBookingDetail.therapist?.user?.email) {
      console.error(`[saveTransactionId] Therapist has no email on file — booking ${isBookingDetail._id}, therapist ${isBookingDetail.therapist?._id}`);
    } else {
      const therapistMailSent = await sendMail(isBookingDetail.therapist.user.email, subjectTherapist, textTherapist, therapistHtml);
      if (!therapistMailSent) console.error(`[saveTransactionId] Therapist mail FAILED to ${isBookingDetail.therapist.user.email} for booking ${isBookingDetail._id}`);
    }
    await pushToUsers(
      { userId: isBookingDetail.therapist.user._id },
      "New Session Booked",
      `${clientName} booked a ${service || 'General'} session with you.`,
      "/appointments"
    );

    //Admin Mail
    const subjectAdmin = `CONFIRMED BOOKING: ${clientName} booked ${isBookingDetail.therapist.user.name} | ₹${paymentAmount}`;
    const textAdmin = adminText(isBookingDetail, transactionId);
    const htmlAdmin = newSessionAdminMail({
      therapistName,
      clientName,
      clientAge,
      paymentAmount,
      transactionId,
      therapistId,
      service,
      format,
      sessionDateTime,
      sessionMode,
      whom,
      cname,
      relation_with_client,
      notes,
      meetLink
    });
    await sendMail("hello@chooseyourtherapist.in", subjectAdmin, textAdmin, htmlAdmin);


    res.status(201).json({
      status: true,
      message: "Payment Success.",
      data: isBookingDetail,
      token: generateToken(isBookingDetail.client._id, isBookingDetail.client.role)
    });
  } catch (err) {

    return next(new Error(err.message));
  }
});

export const createRazorpayOrder = expressAsyncHandler(async (req, res, next) => {
  let { amount } = req.body;
  const { booking_id } = req.body;
  
  console.log("Creating Razorpay Order - Amount:", amount, "Booking ID:", booking_id);
  console.log("Razorpay Key ID:", process.env.RAZORPAY_KEY_ID ? "Found" : "Missing");

  if (!amount || !booking_id) {
    res.status(400);
    return next(new Error("Amount and Booking ID are required"));
  }

  if (mongoose.Types.ObjectId.isValid(booking_id)) {
    const b = await Booking.findById(booking_id).select("therapist client booking_date payment_status slot_released_at pack_size pack_total");
    if (b?.payment_status === "Paid") {
      res.status(409);
      return next(new Error("This booking is already paid."));
    }
    if (b && (await slotTakenByOther(b))) {
      res.status(409);
      return next(new Error("Sorry, this time slot has just been booked by someone else. Please pick another slot."));
    }
    // a session pack is charged its server-side total, whatever the page sent
    if (b?.pack_size > 0 && b.pack_total > 0) amount = b.pack_total;
    // paying again → hold the slot again
    if (b?.slot_released_at) await Booking.updateOne({ _id: b._id }, { $set: { slot_released_at: null } });
  }

  try {
    const options = {
      amount: Math.round(amount * 100), // amount in the smallest currency unit
      currency: "INR",
      receipt: `rcpt_${booking_id}`,
    };

    const razorpay = getRazorpayInstance();
    console.log("Creating Razorpay order with options:", JSON.stringify(options));
    const order = await razorpay.orders.create(options);
    console.log("Razorpay order created successfully:", order.id);

    if (!order) {
      res.status(500);
      return next(new Error("Failed to create Razorpay order"));
    }

    res.status(200).json({
      status: true,
      message: "Razorpay order created successfully",
      data: order,
      // The checkout must open with the same key the order was created under —
      // and the same account whose secret verifies the signature afterwards.
      key_id: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("Razorpay Order Error:", err);
    return next(new Error(err.message || "Error creating Razorpay order"));
  }
});

// After a booking is paid (Razorpay, or a session from a pack): assessments, referral rewards, the client's
// and therapist's notifications, the Meet link and the confirmation emails (client, therapist, admin).
async function confirmPaidBooking(isBookingDetail, transactionId) {
    attachBookingAssessments(isBookingDetail); // clinical assessments booked with it → sent to the client to complete before the session
    settleBookingRewards(isBookingDetail).catch((e) => console.error("[referral] settle failed:", e.message));
    notifyClient(isBookingDetail.client?._id, {
      type: "booking", title: `Session confirmed with ${isBookingDetail.therapist?.user?.name || "your therapist"}`,
      body: `${formatSlotIST(isBookingDetail.booking_date)} · ${isBookingDetail.service || "Session"}`, link: "/client/my-bookings", ref: `booking:${isBookingDetail._id}`,
    });

    // tell the therapist this instant — before the Meet link and emails, which take a few seconds
    notifyTherapists([isBookingDetail.therapist.user._id], {
      type: "booking", title: "New session booked",
      body: `${isBookingDetail.client?.name || "A client"} · ${isBookingDetail.service || "Session"} · ${formatSlotIST(isBookingDetail.booking_date)}`,
      link: "/appointments", ref: `booking:${isBookingDetail._id}`,
    });

    // online session + therapist connected Google → a Meet link on their calendar (never blocks confirmation)
    const meet = await createMeetWithTimeout(isBookingDetail);
    if (meet) {
      isBookingDetail.meet_link = meet.link;
      isBookingDetail.calendar_event_id = meet.eventId;
      await Booking.updateOne({ _id: isBookingDetail._id }, { $set: { meet_link: meet.link, calendar_event_id: meet.eventId } });
    }
    const meetLink = isBookingDetail.meet_link || "";

    // Send emails (Reuse the logic from saveTransactionId)
    const therapistName = isBookingDetail.therapist.user.name;
    const therapistId = isBookingDetail.therapist.profile_code;
    const clientName = isBookingDetail.client.name;
    const clientAge = isBookingDetail.client.age;
    const paymentAmount = isBookingDetail.amount;
    const pin = isBookingDetail.otp;
    const service = isBookingDetail.service;
    const format = isBookingDetail.format;
    const whom = isBookingDetail.whom;
    const cname = isBookingDetail.cname;
    const relation_with_client = isBookingDetail.relation_with_client;
    const notes = isBookingDetail.notes;
    const sessionDateTime = formatSlotIST(isBookingDetail.booking_date);
    const sessionMode = formatSessionMode(isBookingDetail.session_type);

    //Client Mail
    const subjectClient = `Session Confirmed! ${isBookingDetail.therapist.user.name} · ${sessionDateTime}`;
    const textClient = clientText(isBookingDetail, transactionId);
    const clientHtml = bookingConfirmationMail({
      clientName,
      therapistName,
      clientAge,
      transactionId: transactionId,
      service,
      format,
      sessionDateTime,
      sessionMode,
      whom,
      cname,
      relation_with_client,
      notes,
      meetLink
    });
    const clientMailSent = await sendMail(isBookingDetail.client.email, subjectClient, textClient, clientHtml);
    if (!clientMailSent) console.error(`[confirmPaidBooking] Client mail FAILED to ${isBookingDetail.client.email} for booking ${isBookingDetail._id}`);

    //Therapist Mail
    const subjectTherapist = `NEW SESSION: ${clientName} · ${sessionDateTime} · ${service || 'General'}`;
    const textTherapist = therapistText(isBookingDetail, transactionId);
    const therapistHtml = therapistSessionMail({
      therapistName,
      clientName,
      clientAge,
      paymentAmount,
      transactionId,
      service,
      format,
      sessionDateTime,
      sessionMode,
      whom,
      cname,
      relation_with_client,
      notes,
      meetLink
    });
    if (!isBookingDetail.therapist?.user?.email) {
      console.error(`[confirmPaidBooking] Therapist has no email on file — booking ${isBookingDetail._id}, therapist ${isBookingDetail.therapist?._id}`);
    } else {
      const therapistMailSent = await sendMail(isBookingDetail.therapist.user.email, subjectTherapist, textTherapist, therapistHtml);
      if (!therapistMailSent) console.error(`[confirmPaidBooking] Therapist mail FAILED to ${isBookingDetail.therapist.user.email} for booking ${isBookingDetail._id}`);
    }
    await pushToUsers(
      { userId: isBookingDetail.therapist.user._id },
      "New Session Booked",
      `${clientName} booked a ${service || 'General'} session with you.`,
      "/appointments"
    );

    //Admin Mail
    const subjectAdmin = `CONFIRMED BOOKING: ${clientName} booked ${isBookingDetail.therapist.user.name} | ₹${paymentAmount}`;
    const textAdmin = adminText(isBookingDetail, transactionId);
    const htmlAdmin = newSessionAdminMail({
      therapistName,
      clientName,
      clientAge,
      paymentAmount,
      transactionId,
      therapistId,
      service,
      format,
      sessionDateTime,
      sessionMode,
      whom,
      cname,
      relation_with_client,
      notes,
      meetLink
    });
    await sendMail("hello@chooseyourtherapist.in", subjectAdmin, textAdmin, htmlAdmin);
}

// a booking with what confirmPaidBooking needs
const loadForConfirm = (id) => Booking.findById(id).populate("client", "_id name email age role").populate({
  path: "therapist", select: "_id user profile_code", populate: { path: "user", select: "name profile email" },
}).populate("transaction", "amount transaction_id payment_method");

export const verifyRazorpayPayment = expressAsyncHandler(async (req, res, next) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    booking_id
  } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !booking_id) {
    res.status(400);
    return next(new Error("Missing required payment verification details"));
  }

  const sign = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSign = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(sign.toString())
    .digest("hex");

  console.log("Verifying Razorpay Payment:", { razorpay_order_id, razorpay_payment_id });

  if (razorpay_signature !== expectedSign) {
    console.error("Payment verification failed. Signatures do not match.");
    await Booking.findByIdAndUpdate(booking_id, { payment_status: "Payment Failed" });
    res.status(400);
    return next(new Error("Invalid payment signature"));
  }

  try {
    const isBookingDetail = await Booking.findById(booking_id).populate("client", "_id name email age role").populate({
      path: "therapist",
      select: "_id user profile_code",
      populate: {
        path: "user",
        select: "name profile email"
      }
    });

    if (!isBookingDetail) {
      res.status(400);
      return next(new Error("Booking not found with this id"));
    }

    const data = {
      booking: isBookingDetail._id,
      bookingModel: "Booking",
      user: isBookingDetail.client._id,
      amount: isBookingDetail.amount,
      payment_method: "Razorpay",
      status: PAYMENT_STATUS.SUCCESS,
      is_payment_success: true,
      transaction_id: razorpay_payment_id,
    };

    const savedTransaction = await Transaction.create(data);
    if (!savedTransaction) {
      res.status(400);
      return next(new Error("Failed to save transaction."));
    }

    isBookingDetail.transaction = savedTransaction._id;
    isBookingDetail.payment_status = "Paid";
    await isBookingDetail.save();
    // a pack bought with this booking: this is its first session
    if (isBookingDetail.pack_size && !isBookingDetail.bundle) {
      try { await activatePackFor(isBookingDetail, razorpay_payment_id); } catch (e) { console.error("[pack] activate failed:", e.message); }
    }
    await confirmPaidBooking(isBookingDetail, razorpay_payment_id);

    res.status(200).json({
      status: true,
      message: "Payment verified and booking confirmed.",
      data: isBookingDetail,
      token: generateToken(isBookingDetail.client._id, isBookingDetail.client.role)
    });

  } catch (err) {
    return next(new Error(err.message));
  }
});

export const getBookings = expressAsyncHandler(async (req, res, next) => {
  try {
    let findKey, queryId, select;

    if (req.user.role === 1) {
      // Therapist: booking.therapist is Therapists._id, not Users._id
      const therapistProfile = await Therapists.findOne({ user: req.user._id }).select("_id");
      if (!therapistProfile) {
        return res.status(201).json({ status: true, message: "Fetched successfully.", data: [] });
      }
      findKey = "therapist";
      queryId  = therapistProfile._id;
      select   = "-otp";
    } else {
      findKey = "client";
      queryId  = req.user._id;
      select   = "-reassignments"; // admin's internal note on a therapist change stays with admin / therapists
    }

    let result = await Booking.find({ [findKey]: queryId, $or: [{ transaction: { $exists: true, $ne: null } }, { source: "noida" }] }).select(select)
      .populate({
        path: "client",
        select: "name email phone profile age gender",
      })
      .populate({
        path: "therapist",
        // the practice address is private (helper/therapistArea.js) — loaded here only so a client with a
        // paid in-person session can be told where to go; stripped from every other booking below
        select: `_id user profile_code profile_type state${req.user.role === 1 ? "" : " office_address office_city office_state office_pincode office_location"}`,
        populate: {
          path: "user",
          select: "name email profile",
        },
      })
      .populate({
        path: "transaction",
        // method + time power the invoice "Paid on / Method" lines and the
        // therapist notifications feed
        select: "amount transaction_id payment_method createdAt",
        populate: {
          path: "status",
          select: "_id name"
        }
      })
      .sort({ _id: -1 })
      .exec();

    // the therapist sees what they earn from each session: 70% of the session amount (helper/payoutSplit.js)
    if (req.user.role === 1) {
      result = result.map((b) => {
        const o = b.toObject();
        const sp = bookingSplit(o);
        // a Noida booking made without an email has no client account: name + phone from the booking
        const client = o.client || (o.source === "noida" ? { name: o.cname || "Client", phone: o.noida_phone || "", email: "" } : o.client);
        return { ...o, client, therapist_share: sp.therapist, platform_share: sp.platform, client_paid: sp.paid, share_pct: sp.pct };
      });
    } else {
      result = result.map((b) => {
        const o = b.toObject();
        if (!o.therapist) return o;
        const { office_address, office_city, office_state, office_pincode, office_location, ...ther } = o.therapist;
        const paid = o.payment_status === "Paid" || !!o.transaction;
        if (!paid || o.status === "Cancelled" || o.source === "noida" || !isInPerson(o)) return { ...o, therapist: ther };
        const loc = office_location && Number.isFinite(office_location.lat) && Number.isFinite(office_location.lng) ? office_location : null;
        return { ...o, therapist: ther, meet_at: { address: office_address || "", city: office_city || "", state: office_state || ther.state || "", pincode: office_pincode || "", location: loc } };
      });
    }

    res.status(201).json({
      status: true,
      message: "Fetched successfully.",
      data: result || [],
    });
  } catch (err) {
    return next(new Error(err.message));
  }
});

// Public: busy slots for a therapist so the booking calendar can grey them out.
// Returns only ISO date-times (no client info). "Busy" = a paid booking, or a
// pending one started in the last 20 minutes.
export const getBookedSlots = expressAsyncHandler(async (req, res, next) => {
  const { therapistId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(therapistId)) {
    return res.status(400).json({ status: false, message: "Invalid therapist id" });
  }
  try {
    const pendingCutoff = mongoose.Types.ObjectId.createFromTime(
      Math.floor((Date.now() - 20 * 60 * 1000) / 1000)
    );
    void pendingCutoff;
    // every session this psychologist is busy at — online bookings and CYT Noida bookings alike — blocks any
    // start less than an hour away (the page matches exact times, so each 5-minute start in that window is listed)
    const starts = await busyStarts(therapistId);
    const out = new Set();
    const step = 5 * 60000, win = (SESSION_MIN - 5) * 60000;
    for (const t of starts) for (let x = t - win; x <= t + win; x += step) if (x >= Date.now() - SESSION_MIN * 60000) out.add(new Date(x).toISOString());
    return res.status(200).json({ status: true, data: [...out] });
  } catch (err) {
    return next(new Error(err.message));
  }
});

// POST /booking/:id/release-slot — the client closed Razorpay without paying: free the slot
// now instead of holding it for 20 minutes. Only an unpaid booking from the last hour can be
// released (the id is known only to whoever started that checkout); the booking itself stays,
// so the "complete your booking" reminder still goes out.
export const releaseBookingSlot = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ status: false, message: "Invalid booking id" });
  const recent = mongoose.Types.ObjectId.createFromTime(Math.floor((Date.now() - 60 * 60 * 1000) / 1000));
  const r = await Booking.updateOne(
    { payment_status: "Pending Payment", slot_released_at: null, _id: { $eq: new mongoose.Types.ObjectId(id), $gt: recent } },
    { $set: { slot_released_at: new Date() } }
  );
  return res.status(200).json({ status: true, released: r.modifiedCount === 1 });
});

// GET /my-pending-bookings — the client's own unpaid bookings for a session still ahead, so the dashboard
// can offer "Complete payment" (get-bookings lists only paid ones). Leaves out bookings started more than
// 7 days ago and any the client has since paid for another way (a paid booking with the same therapist
// at the same time, or a later paid booking with that therapist).
export const getMyPendingBookings = expressAsyncHandler(async (req, res) => {
  if (req.user.role === 1) return res.status(200).json({ status: true, data: [] });
  const since = mongoose.Types.ObjectId.createFromTime(Math.floor((Date.now() - 7 * 86400000) / 1000));
  const rows = await Booking.find({
    client: req.user._id, payment_status: "Pending Payment", status: { $ne: "Cancelled" },
    booking_date: { $gt: new Date() }, _id: { $gt: since },
  }).select("therapist client service format session_type booking_date amount createdAt").sort({ _id: -1 }).limit(10).lean();
  if (!rows.length) return res.status(200).json({ status: true, data: [] });
  const paid = await Booking.find({
    client: req.user._id, therapist: { $in: rows.map((r) => r.therapist) }, status: { $ne: "Cancelled" },
    $or: [{ payment_status: "Paid" }, { transaction: { $exists: true, $ne: null } }],
  }).select("_id therapist booking_date").lean();
  const seen = new Set();
  const out = [];
  for (const b of rows) {
    const k = `${b.therapist}|${new Date(b.booking_date).getTime()}`;
    if (seen.has(k)) continue; // tried the same slot twice — the newest attempt is enough
    seen.add(k);
    const done = paid.some((p) => String(p.therapist) === String(b.therapist)
      && (new Date(p.booking_date).getTime() === new Date(b.booking_date).getTime() || String(p._id) > String(b._id)));
    if (done) continue;
    const ther = await Therapists.findById(b.therapist).select("_id user profile_type state").populate("user", "name profile").lean();
    out.push({
      _id: String(b._id), state: (await slotTakenByOther(b)) ? "taken" : "payable",
      therapist: ther ? { _id: String(ther._id), profile_type: ther.profile_type || "", state: ther.state || "", user: { name: ther.user?.name || "", profile: ther.user?.profile || "" } } : null,
      service: b.service, format: b.format, session_type: b.session_type || "", booking_date: b.booking_date, amount: b.amount,
    });
    if (out.length >= 3) break;
  }
  return res.status(200).json({ status: true, data: out });
});

// Is this booking's slot taken by somebody else — a paid booking, or another person's live checkout?
async function slotTakenByOther(b) {
  const pendingCutoff = mongoose.Types.ObjectId.createFromTime(Math.floor((Date.now() - 20 * 60 * 1000) / 1000));
  return !!(await Booking.exists({
    _id: { $ne: b._id },
    therapist: b.therapist,
    booking_date: b.booking_date,
    status: { $ne: "Cancelled" },
    $or: [
      { payment_status: "Paid" },
      { payment_status: "Pending Payment", _id: { $ne: b._id, $gt: pendingCutoff }, slot_released_at: null, client: { $ne: b.client } },
    ],
  }));
}

// GET /booking/:id/pay-info — what the "Complete payment" link from the reminder email needs:
// the saved session (no client details) and whether it can still be paid for.
// state: payable | paid | taken | past | cancelled
export const getBookingPayInfo = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).json({ status: false, message: "Booking not found" });
  const b = await Booking.findById(id)
    .select("therapist client service format session_type booking_date amount payment_status status")
    .lean();
  if (!b) return res.status(404).json({ status: false, message: "Booking not found" });
  const ther = await Therapists.findById(b.therapist).select("_id user profile_type state").populate("user", "name profile").lean();
  let state = "payable";
  if (b.payment_status === "Paid") state = "paid";
  else if (b.status === "Cancelled" || b.payment_status === "Payment Failed") state = "cancelled";
  else if (new Date(b.booking_date).getTime() <= Date.now()) state = "past";
  else if (await slotTakenByOther(b)) state = "taken";
  return res.status(200).json({
    status: true,
    data: {
      id: String(b._id), state,
      therapist: ther ? { id: String(ther._id), name: ther.user?.name || "", profile: ther.user?.profile || "", profile_type: ther.profile_type || "", state: ther.state || "" } : null,
      service: b.service, format: b.format, session_type: b.session_type || "", booking_date: b.booking_date, amount: b.amount,
    },
  });
});

// does this therapist (Users _id) own the booking?
async function ownsBooking(userId, booking) {
  const t = await Therapists.findOne({ user: userId }).select("_id").lean();
  return !!t && String(booking.therapist) === String(t._id);
}

const fmtIstTime = (ms) => new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

// POST /start-session-now { bookingId } — one tap, no PIN (replaces the emailed-PIN step)
export const startSessionNow = expressAsyncHandler(async (req, res) => {
  const { bookingId } = req.body || {};
  if (!mongoose.Types.ObjectId.isValid(bookingId)) return res.status(400).json({ status: false, message: "Booking id required." });
  const b = await Booking.findById(bookingId);
  if (!b) return res.status(404).json({ status: false, message: "Booking not found." });
  if (!(await ownsBooking(req.user._id, b))) return res.status(403).json({ status: false, message: "This booking isn't yours." });
  if (b.payment_status !== "Paid" && !b.transaction) return res.status(400).json({ status: false, message: "This booking isn't paid yet." });
  if (b.status === SESSION_STATUS.STARTED) return res.json({ status: true, message: "Session already started.", data: b });
  if (b.status !== SESSION_STATUS.NEW) return res.status(400).json({ status: false, message: `Session is ${String(b.status).toLowerCase()}.` });
  if (isInPerson(b)) return res.status(400).json({ status: false, message: "In-person sessions start with the code emailed to the client." });
  const w = sessionWindow(b.booking_date);
  const now = Date.now();
  if (now < w.opens) {
    const mins = Math.ceil((w.opens - now) / 60000);
    return res.status(400).json({ status: false, message: `You can start ${JOIN_EARLY_MIN} minutes before the session — at ${fmtIstTime(w.opens)} (in ${mins >= 60 ? Math.round(mins / 60) + " h" : mins + " min"}).` });
  }
  if (now > w.closes) return res.status(400).json({ status: false, message: "This session's time has passed. Contact support if it did happen." });
  b.status = SESSION_STATUS.STARTED;
  b.session_started_at = new Date();
  await b.save();
  clientBookingsChanged(b.client);
  res.json({ status: true, message: "Session started.", data: b });
});

// POST /bookings/:id/join — therapist or client clicks Join; returns the Meet link.
// When both have joined (within the session window) the session is marked started.
export const joinSession = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ status: false, message: "Invalid booking." });
  const b = await Booking.findById(id);
  if (!b) return res.status(404).json({ status: false, message: "Booking not found." });
  const isTherapistUser = req.user.role === 1;
  if (isTherapistUser ? !(await ownsBooking(req.user._id, b)) : String(b.client) !== String(req.user._id)) {
    return res.status(403).json({ status: false, message: "This booking isn't yours." });
  }
  if (b.status === SESSION_STATUS.COMPLETED || b.status === SESSION_STATUS.CANCELED) {
    return res.status(400).json({ status: false, code: "CLOSED", message: `This session is ${String(b.status).toLowerCase()}.` });
  }
  const w = sessionWindow(b.booking_date);
  if (Date.now() < w.opens) return res.status(400).json({ status: false, code: "EARLY", message: `Join opens at ${fmtIstTime(w.opens)} — ${JOIN_EARLY_MIN} minutes before the session.` });
  if (Date.now() > w.closes) return res.status(400).json({ status: false, code: "ENDED", message: "This session's time is over, so the meeting link is closed." });
  if (!b.meet_link) {
    // online session without a link yet (booked before Google was connected) → create it now
    if (!isOnlineFormat(b.format)) return res.status(400).json({ status: false, message: "This is an in-person session — tap Start instead." });
    const full = await Booking.findById(b._id).populate("client", "name email").populate({ path: "therapist", select: "_id user", populate: { path: "user", select: "_id" } });
    const meet = await createMeetWithTimeout(full, 12000);
    if (!meet) {
      return res.status(409).json({
        status: false,
        code: isTherapistUser ? "NO_GOOGLE" : "NO_LINK",
        message: isTherapistUser
          ? "Connect your Google account in Settings → Account to create a Meet link for this session."
          : "Your therapist hasn't shared a meeting link yet — please check back closer to the session time.",
      });
    }
    b.meet_link = meet.link;
    b.calendar_event_id = meet.eventId;
  }
  const now = new Date();
  const clientJustJoined = !isTherapistUser && !b.client_joined_at;
  const therapistJustJoined = isTherapistUser && !b.therapist_joined_at;
  if (isTherapistUser && !b.therapist_joined_at) b.therapist_joined_at = now;
  if (!isTherapistUser && !b.client_joined_at) b.client_joined_at = now;
  if (b.therapist_joined_at && b.client_joined_at && b.status === SESSION_STATUS.NEW) {
    b.status = SESSION_STATUS.STARTED;
    b.session_started_at = now;
  }
  await b.save();
  if (clientJustJoined) {
    // the client is in the meeting → tell the therapist right away
    notifyTherapists([await therapistUserId(b.therapist)], {
      type: "joined", title: `${req.user.name || "Your client"} has joined the session`,
      body: b.therapist_joined_at ? "They're in the meeting now." : "Tap Join to start — they're waiting for you.",
      link: "/appointments", ref: `joined:${b._id}`,
    });
  }
  if (therapistJustJoined) {
    notifyClient(b.client, {
      type: "joined", title: `${req.user.name || "Your therapist"} has joined your session`,
      body: b.client_joined_at ? "You're both in — enjoy your session." : "Tap Join to start your session.", link: "/my-dashboard", ref: `tjoined:${b._id}`,
    });
  } else clientBookingsChanged(b.client);
  res.json({ status: true, data: { meet_link: b.meet_link, status: b.status, therapist_joined_at: b.therapist_joined_at, client_joined_at: b.client_joined_at } });
});

// POST /bookings/:id/reschedule { booking_date, reason? } — therapist moves an upcoming session
/* Moves one upcoming online session to `when` — shared by the therapist (POST /bookings/:id/reschedule)
   and the admin panel (POST /admin/bookings/:id/reschedule). Checks clashes, updates the Meet event and
   tells the client (and, when an admin moves it, the therapist). Returns { code, body } for the response. */
async function moveSession(id, body, { byAdmin = false, userId = null } = {}) {
  const fail = (code, message) => ({ code, body: { status: false, message } });
  if (!mongoose.Types.ObjectId.isValid(id)) return fail(400, "Invalid booking.");
  const when = new Date(body?.booking_date);
  if (isNaN(when)) return fail(400, "Pick a valid date and time.");
  // the team may fix a time closer in (e.g. a wrong-timezone booking); therapists need 30 minutes' notice
  if (when.getTime() < Date.now() + (byAdmin ? 5 : 30) * 60000) return fail(400, `Pick a time at least ${byAdmin ? 5 : 30} minutes from now.`);
  if (when.getTime() > Date.now() + 90 * 86400000) return fail(400, "Pick a time within the next 90 days.");
  const b = await Booking.findById(id).populate("client", "name email").populate({ path: "therapist", select: "_id user", populate: { path: "user", select: "name" } });
  if (!b) return fail(404, "Booking not found.");
  if (!byAdmin && !(await ownsBooking(userId, { therapist: b.therapist._id }))) return fail(403, "This booking isn't yours.");
  if (b.status !== SESSION_STATUS.NEW) return fail(400, `Only upcoming sessions can be rescheduled (this one is ${String(b.status).toLowerCase()}).`);
  if (b.source === "noida") return fail(400, byAdmin ? "This is a CYT Noida session — reschedule it from Noida Centre → CYT Noida." : "This is a CYT Noida centre session — to change its time, please ask the Noida desk (+91 80777 57951).");
  const who = byAdmin ? "The therapist" : "You";
  const clash = await Booking.findOne({
    _id: { $ne: b._id }, therapist: b.therapist._id, status: { $nin: ["Cancelled", "Completed"] },
    booking_date: { $gt: new Date(when.getTime() - 60 * 60000), $lt: new Date(when.getTime() + 60 * 60000) },
    $or: [{ payment_status: "Paid" }, { transaction: { $ne: null } }],
  }).select("_id booking_date").lean();
  if (clash) return fail(409, `${who} already ${byAdmin ? "has" : "have"} a session at ${new Date(clash.booking_date).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })} that day — pick a time at least an hour apart.`);
  if (await busyNear(b.therapist._id, when, { excludeBookingId: b._id })) return fail(409, `${who} ${byAdmin ? "has" : "have"} a CYT Noida session around that time — pick a time at least an hour apart.`);

  const oldTime = formatSlotIST(b.booking_date);
  b.booking_date = when;
  b.therapist_joined_at = null;
  b.client_joined_at = null;
  b.pending_mail_sent_at = b.pending_mail_sent_at || new Date();
  await b.save();
  const moved = await moveMeetEvent(b);

  const newTime = formatSlotIST(when);
  const reason = String(body?.reason || "").trim().slice(0, 300);
  notifyClient(b.client?._id, {
    type: "rescheduled", title: "Your session was moved", body: `${b.therapist?.user?.name || "Your therapist"} · now ${newTime}${reason ? ` — ${reason}` : ""}`,
    link: "/client/my-bookings", ref: `resched:${b._id}:${when.getTime()}`,
  });
  if (byAdmin && b.therapist?.user?._id) {
    notifyTherapists([b.therapist.user._id], {
      type: "booking", title: "A session was moved by the CYT team",
      body: `${b.cname || b.client?.name || "Client"} · now ${newTime} (was ${oldTime})${reason ? ` — ${reason}` : ""}`,
      link: "/appointments", ref: `resched:${b._id}:${when.getTime()}`,
    });
  }
  if (b.client?.email) {
    sendMail(b.client.email, `Session rescheduled: ${newTime}`,
      `Your session with ${b.therapist?.user?.name || "your therapist"} has moved to ${newTime} (was ${oldTime}).${b.meet_link ? " Meeting link: " + b.meet_link : ""}`,
      sessionRescheduledMail({ clientName: b.cname || b.client.name, therapistName: b.therapist?.user?.name, service: b.service, format: b.format, oldTime, newTime, meetLink: b.meet_link, reason }))
      .catch(() => {});
  }
  const told = [b.client?.email ? "The client has been emailed." : "", byAdmin ? "The therapist has been notified." : "", moved ? "Calendar updated." : ""].filter(Boolean).join(" ");
  return { code: 200, body: { status: true, message: `Moved to ${newTime}. ${told}`.trim(), data: { _id: b._id, booking_date: b.booking_date } } };
}

// POST /bookings/:id/reschedule — the therapist moves one of their sessions
export const rescheduleSession = expressAsyncHandler(async (req, res) => {
  const out = await moveSession(req.params.id, req.body, { userId: req.user._id });
  res.status(out.code).json(out.body);
});

// POST /admin/bookings/:id/reschedule — the CYT team moves a session (permission "bookings")
export const adminRescheduleSession = expressAsyncHandler(async (req, res) => {
  const out = await moveSession(req.params.id, req.body, { byAdmin: true });
  res.status(out.code).json(out.body);
});

// In-person sessions: POST /start-session/send-code { bookingId } — emails the client a fresh 6-digit
// code; the therapist asks the client for it and enters it in /start-session to start the session.
const isInPerson = (b) => /in[-\s]?person|offline|clinic|centre|center/i.test(`${b?.format || ""} ${b?.session_type || ""}`);
export const sendSessionStartCode = expressAsyncHandler(async (req, res) => {
  const b = await Booking.findById(req.body?.bookingId).populate("client", "name email").populate({ path: "therapist", populate: { path: "user", select: "name" } });
  if (!b) return res.status(404).json({ status: false, message: "Booking not found." });
  if (!(await ownsBooking(req.user._id, { therapist: b.therapist?._id || b.therapist }))) return res.status(403).json({ status: false, message: "This booking isn't yours." });
  if (b.status !== SESSION_STATUS.NEW) return res.status(400).json({ status: false, message: b.status === SESSION_STATUS.STARTED ? "Session already started." : "This session can't be started." });
  if (!isInPerson(b)) return res.status(400).json({ status: false, message: "Start codes are only for in-person sessions." });
  const at = new Date(b.booking_date).getTime();
  if (Date.now() < at - 60 * 60 * 1000) return res.status(400).json({ status: false, message: "You can start this session from 1 hour before its time." });
  if (Date.now() > at + 12 * 60 * 60 * 1000) return res.status(400).json({ status: false, message: "This session's time has passed." });
  if (b.otp_sent_at && Date.now() - new Date(b.otp_sent_at).getTime() < 45 * 1000) return res.status(429).json({ status: false, message: "A code was just sent — please wait a few seconds before sending another." });
  if (!b.client?.email) return res.status(400).json({ status: false, message: b.source === "noida" ? "This CYT Noida client has no email, so there's no start code — the Noida desk marks the visit attended, which completes it here too." : "The client has no email on file." });
  b.otp = generate6DigitOTP();
  b.otp_sent_at = new Date();
  await b.save();
  const ok = await sendMail(b.client.email, "Your session code — Choose Your Therapist", `Your session code is ${b.otp}. Share it with your psychologist to start your in-person session.`, sessionStartOtpMail({ name: b.client.name, therapistName: b.therapist?.user?.name, otp: b.otp }));
  notifyClient(b.client._id, { type: "joined", title: "Your session code has been emailed", body: `${b.therapist?.user?.name || "Your psychologist"} is starting your in-person session — share the code from your email with them.`, link: "/client/my-bookings", ref: `startcode:${b._id}:${b.otp_sent_at.getTime()}` });
  const masked = String(b.client.email).replace(/^(.{2}).*(@.*)$/, "$1•••$2");
  res.json({ status: true, message: ok === false ? "Code generated, but the email may not have gone through — ask the client to check spam, or resend." : `Code sent to ${masked}.`, data: { sentTo: masked } });
});

export const startSession = expressAsyncHandler(async (req, res, next) => {
  const { bookingId, pin } = req.body;
  try {

    if (!bookingId || !pin) {
      res.status(400);
      throw new Error("Booking id and pin required.");
    }

    const result = await Booking.findById(bookingId);

    if (!result) {
      res.status(404);
      throw new Error("Booking not found.");
    }
    if (!(await ownsBooking(req.user._id, result))) {
      res.status(403);
      throw new Error("This booking isn't yours.");
    }
    if (result.status === SESSION_STATUS.COMPLETED) {
      res.status(404);
      throw new Error("Session completed already!");
    }

    if (result.status === SESSION_STATUS.STARTED) {
      res.status(404);
      throw new Error("Session started already!");
    }

    if (result.otp != pin) {
      res.status(400);
      throw new Error("Invalid Pin.");
    }


    result.session_started_at = new Date();
    result.status = SESSION_STATUS.STARTED
    await result.save();
    clientBookingsChanged(result.client);

    res.status(200).json({
      status: true,
      message: "Session started.",
      data: result,
    });

  } catch (err) {
    return next(new Error(err.message));
  }
});


export const EndSession = expressAsyncHandler(async (req, res, next) => {
  const { bookingId } = req.body;
  try {

    if (!bookingId) {
      res.status(400);
      throw new Error("Booking id required.");
    }

    const result = await Booking.findById(bookingId);

    if (!result) {
      res.status(404);
      throw new Error("Booking not found.");
    }
    if (!(await ownsBooking(req.user._id, result))) {
      res.status(403);
      throw new Error("This booking isn't yours.");
    }

    if (result.status === SESSION_STATUS.COMPLETED) {
      res.status(404);
      throw new Error("Session completed already.");
    }


    if (result.status === SESSION_STATUS.CANCELED) {
      res.status(404);
      throw new Error("Session cancelled");
    }

    result.session_completed_at = new Date();
    result.status = SESSION_STATUS.COMPLETED;
    await result.save();
    if (result.noida_appointment) {
      await NoidaAppointment.updateOne({ _id: result.noida_appointment, attendance: { $in: ["", "arrived"] } }, { $set: { attendance: "completed", attendanceAt: new Date() } }).catch(() => {});
    }
    notifyClient(result.client, {
      type: "completed", title: "Session completed",
      body: "How did it go? Leave a quick review and book your next session.", link: "/my-dashboard", ref: `completed:${result._id}`,
    });
    deleteMeetEvent(result); // lock the Meet link (in the background)

    res.status(200).json({
      status: true,
      message: "Session completed.",
      data: result,
    });

  } catch (err) {
    return next(new Error(err.message));
  }
});


export const getBookingsForAdmin = expressAsyncHandler(async (req, res, next) => {
  try {
    let result = await Booking.find({ source: { $ne: "noida" } })
      .populate({
        path: "client",
        select: "name email phone profile age gender",
      })
      .populate({
        path: "therapist",
        select: "_id user profile_code profile_type",
        populate: {
          path: "user",
          select: "name email profile",
        },
      })
      .populate({
        path: "transaction",
        select: "amount transaction_id",
        populate: {
          path: "status",
          select: "_id name"
        }
      })
      .sort({ _id: -1 })
      .exec();

    let paymentStatus = await PaymentStatus.find();

    res.status(201).json({
      status: true,
      message: "Fetched successfully.",
      data: result || [],
      statuslist: paymentStatus
    });
  } catch (err) {
    return next(new Error(err.message));
  }
});

export const checkRazorpayStatus = expressAsyncHandler(async (req, res, next) => {
  try {
    const razorpay = getRazorpayInstance();
    // Try to fetch a dummy order list — if account is blocked/inactive this will throw
    const result = await razorpay.orders.all({ count: 1 });
    res.status(200).json({
      status: true,
      message: "Razorpay account is active and keys are valid",
      key_id: process.env.RAZORPAY_KEY_ID,
      mode: process.env.RAZORPAY_KEY_ID?.startsWith("rzp_live_") ? "LIVE" : "TEST",
      orders_fetched: result?.count ?? 0,
    });
  } catch (err) {
    res.status(200).json({
      status: false,
      message: "Razorpay account check failed",
      error: err?.error?.description || err?.message || "Unknown error",
      error_code: err?.error?.code || null,
      key_id: process.env.RAZORPAY_KEY_ID,
      mode: process.env.RAZORPAY_KEY_ID?.startsWith("rzp_live_") ? "LIVE" : "TEST",
    });
  }
});

const notifyBookingRemoved = async (booking, action) => {
  const populated = await Booking.findById(booking._id)
    .populate("client", "name email")
    .populate({ path: "therapist", select: "user", populate: { path: "user", select: "name email" } });
  if (!populated) return;

  const therapistName = populated.therapist?.user?.name || "your therapist";
  const clientName = populated.client?.name || "the client";
  if (populated.payment_status === "Paid") {
    notifyClient(populated.client?._id, {
      type: "cancelled", title: `Session ${action}`, body: `${therapistName} · ${formatSlotIST(populated.booking_date)}`,
      link: "/client/my-bookings", ref: `${action}:${populated._id}`,
    });
    notifyTherapists([populated.therapist?.user?._id], {
      type: "cancelled", title: `Session ${action}`,
      body: `${clientName} · ${populated.service || "Session"} · ${formatSlotIST(populated.booking_date)}`,
      link: "/appointments", ref: `${action}:${populated._id}`,
    });
  }

  if (populated.client?.email) {
    const html = bookingCancelledMail({
      recipientName: clientName,
      otherPartyName: therapistName,
      service: populated.service,
      format: populated.format,
      booking_date: populated.booking_date,
      action,
    });
    const sent = await sendMail(populated.client.email, `Your session has been ${action} — Choose Your Therapist`, "", html, "Choose Your Therapist");
    if (!sent) console.error(`[${action}Booking] Client mail FAILED to ${populated.client.email} for booking ${populated._id}`);
  }

  if (populated.therapist?.user?.email) {
    const html = bookingCancelledMail({
      recipientName: therapistName,
      otherPartyName: clientName,
      service: populated.service,
      format: populated.format,
      booking_date: populated.booking_date,
      action,
    });
    const sent = await sendMail(populated.therapist.user.email, `A session has been ${action} — Choose Your Therapist`, "", html, "Choose Your Therapist");
    if (!sent) console.error(`[${action}Booking] Therapist mail FAILED to ${populated.therapist.user.email} for booking ${populated._id}`);
  }
};

export const cancelBooking = expressAsyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ status: false, message: "Booking not found." });

    const wasCancelled = booking.status === SESSION_STATUS.CANCELED;
    booking.status = SESSION_STATUS.CANCELED;
    await booking.save();
    if (!wasCancelled) await returnSession(booking); // a pack session goes back to the pack
    deleteMeetEvent(booking);

    await notifyBookingRemoved(booking, "cancelled");

    res.status(200).json({ status: true, message: "Booking cancelled successfully." });
  } catch (err) {
    return next(new Error(err.message));
  }
});

export const deleteBooking = expressAsyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ status: false, message: "Booking not found." });

    await notifyBookingRemoved(booking, "deleted");
    if (booking.status !== SESSION_STATUS.CANCELED) await returnSession(booking);
    await Booking.findByIdAndDelete(id);
    res.status(200).json({ status: true, message: "Booking deleted successfully." });
  } catch (err) {
    return next(new Error(err.message));
  }
});
