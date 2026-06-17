import expressAsyncHandler from "express-async-handler";
import Joi from "joi";
import Booking from "../models/Booking.js";
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

const getRazorpayInstance = () => {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
};
import { adminText, bookingConfirmationMail, clientText, newSessionAdminMail, otpVerificationEmail, therapistSessionMail, therapistText } from "../services/mailTemplates.js";

export const bookTherapist = expressAsyncHandler(async (req, res, next) => {
  const validateSchema = Joi.object({
    is_logged_in: Joi.boolean().required().messages({
      "boolean.base": "is_logged_in must be true or false",
      "any.required": "is_logged_in flag is required",
    }),
    name: Joi.string()
      .min(2)
      .when("is_logged_in", {
        is: false,
        then: Joi.required(),
        otherwise: Joi.optional().allow(""),
      })
      .messages({
        "string.base": "Name must be a text",
        "string.min": "Name must be at least 2 characters long",
        "any.required": "Name is required for guest users",
      }),

    email: Joi.string()
      .email()
      .when("is_logged_in", {
        is: false,
        then: Joi.required(),
        otherwise: Joi.optional().allow(""),
      })
      .messages({
        "string.email": "Please provide a valid email address",
        "any.required": "Email is required for guest users",
      }),

    phone: Joi.string()
      .pattern(/^[0-9]{10}$/)
      .when("is_logged_in", {
        is: false,
        then: Joi.required(),
        otherwise: Joi.optional().allow(""),
      })
      .messages({
        "string.pattern.base": "Phone number must be exactly 10 digits",
        "any.required": "Phone number is required for guest users",
      }),


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
    age: Joi.alternatives().conditional(Joi.object({
      whom: Joi.valid("For Other").required(),
      is_logged_in: Joi.valid(false).required(),
    }).unknown(), {
      then: Joi.number()
        .integer()
        .min(12)
        .max(100)
        .required()
        .messages({
          "number.base": "Age must be a number",
          "number.integer": "Age must be an integer",
          "number.min": "Age must be at least 12",
          "number.max": "Age must be less than or equal to 100",
          "any.required": "Age is required when booking for others as a guest user",
        }),
      otherwise: Joi.number()
        .integer()
        .min(12)
        .max(100)
        .optional()
        .allow(null, ""),
    }),

  }).unknown(true);

  const { error } = validateSchema.validate(req.body);

  if (error) {
    res.status(400);
    return next(new Error(error));
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
      is_logged_in
    } = req.body;



    if (!mongoose.Types.ObjectId.isValid(therapist)) {
      res.status(400);
      return next(new Error("Therapist Not Found."));
    }

    const isExist = await Therapists.findById(therapist);

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
      email = email.toLowerCase();
      user = await Users.findOne({ email }).session(session);
      if (user) {
        if (user.is_verified === 1) {
          res.status(400);
          return next(new Error("This user is already registred with us as Therapist"));
        }
        user.otp = generatedOtp;
        user.otp_count = otp_count;
        await user.save({ session });
      } else {
        user = await Users.create(
          [{
            name,
            email,
            phone,
            otp: generatedOtp,
            otp_count,
            age,
          }],
          { session }
        );
        user = user[0];
      }
    }

    const booked = await Booking.create(
      [{
        therapist,
        client: user._id,
        service,
        format,
        whom,
        cname,
        age,
        relation_with_client,
        notes,
        amount,
        otp: generatedOtp,
      }],
      { session }
    );

    const subject = "Welcome to CYT";
    const text = `Hello Thank you for registering. Use this otp to verify ${generatedOtp}.Best regards CYT`;
    const html = otpVerificationEmail(generatedOtp);
    await sendMail(email, subject, text, html);

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      status: true,
      message: "Booking saved successfully.",
      data: { id: booked[0]._id },
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
    await isBookingDetail.save();

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


    //Client Mail
    const subjectClient = `Session Confirmed! Your appointment with ${isBookingDetail.therapist.user.name} is scheduled. | PIN: ${pin}`;
    const textClient = clientText(isBookingDetail, transactionId);
    const clientHtml = bookingConfirmationMail({
      clientName,
      therapistName,
      clientAge,
      transactionId: transactionId,
      service,
      format,
      whom,
      cname,
      relation_with_client,
      notes,
      pin

    });
    await sendMail(isBookingDetail.client.email, subjectClient, textClient, clientHtml);

    //Therapist Mail
    const subjectTherapist = `NEW SESSION: ${clientName} - ${service || 'General'} Session assigned to you | PIN: ${pin}`;
    const textTherapist = therapistText(isBookingDetail, transactionId);
    const therapistHtml = therapistSessionMail({
      therapistName,
      clientName,
      clientAge,
      paymentAmount,
      transactionId,
      service,
      format,
      whom,
      cname,
      relation_with_client,
      notes
    })
    await sendMail(isBookingDetail.therapist.user.email, subjectTherapist, textTherapist, therapistHtml);

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
      whom,
      cname,
      relation_with_client,
      notes
    });
    await sendMail("Appointment.cyt@gmail.com", subjectAdmin, textAdmin, htmlAdmin);


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
  const { amount, booking_id } = req.body;
  
  console.log("Creating Razorpay Order - Amount:", amount, "Booking ID:", booking_id);
  console.log("Razorpay Key ID:", process.env.RAZORPAY_KEY_ID ? "Found" : "Missing");

  if (!amount || !booking_id) {
    res.status(400);
    return next(new Error("Amount and Booking ID are required"));
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
    });
  } catch (err) {
    console.error("Razorpay Order Error:", err);
    return next(new Error(err.message || "Error creating Razorpay order"));
  }
});

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
    await isBookingDetail.save();

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
    const transactionId = razorpay_payment_id;

    //Client Mail
    const subjectClient = `Session Confirmed! Your appointment with ${isBookingDetail.therapist.user.name} is scheduled. | PIN: ${pin}`;
    const textClient = clientText(isBookingDetail, transactionId);
    const clientHtml = bookingConfirmationMail({
      clientName,
      therapistName,
      clientAge,
      transactionId: transactionId,
      service,
      format,
      whom,
      cname,
      relation_with_client,
      notes,
      pin
    });
    await sendMail(isBookingDetail.client.email, subjectClient, textClient, clientHtml);

    //Therapist Mail
    const subjectTherapist = `NEW SESSION: ${clientName} - ${service || 'General'} Session assigned to you | PIN: ${pin}`;
    const textTherapist = therapistText(isBookingDetail, transactionId);
    const therapistHtml = therapistSessionMail({
      therapistName,
      clientName,
      clientAge,
      paymentAmount,
      transactionId,
      service,
      format,
      whom,
      cname,
      relation_with_client,
      notes
    });
    await sendMail(isBookingDetail.therapist.user.email, subjectTherapist, textTherapist, therapistHtml);

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
      whom,
      cname,
      relation_with_client,
      notes
    });
    await sendMail("Appointment.cyt@gmail.com", subjectAdmin, textAdmin, htmlAdmin);

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
      select   = "";
    }

    let result = await Booking.find({ [findKey]: queryId, transaction: { $exists: true, $ne: null } }).select(select)
      .populate({
        path: "client",
        select: "name email phone profile age gender",
      })
      .populate({
        path: "therapist",
        select: "_id user profile_code",
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

    res.status(201).json({
      status: true,
      message: "Fetched successfully.",
      data: result || [],
    });
  } catch (err) {
    return next(new Error(err.message));
  }
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
    let result = await Booking.find({})
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

export const deleteBooking = expressAsyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const booking = await Booking.findById(id);
    if (!booking) return res.status(404).json({ status: false, message: "Booking not found." });

    // Therapist can only delete their own bookings; admin can delete any
    if (req.user.role === 1) {
      const therapistProfile = await Therapists.findOne({ user: req.user._id }).select("_id");
      if (!therapistProfile || booking.therapist.toString() !== therapistProfile._id.toString()) {
        return res.status(403).json({ status: false, message: "Not authorized to delete this booking." });
      }
    }

    await Booking.findByIdAndDelete(id);
    res.status(200).json({ status: true, message: "Booking deleted successfully." });
  } catch (err) {
    return next(new Error(err.message));
  }
});
