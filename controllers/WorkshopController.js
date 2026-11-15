import expressAsyncHandler from "express-async-handler";
import Joi from "joi";
import mongoose from "mongoose";
import Workshop from "../models/Workshop.js";
import Users from "../models/Users.js";
import WorkshopBooking from "../models/WorkshopBooking.js";
import { generate6DigitOTP, generateQrCode } from "../helper/generate.js";
import { sendMail } from "../helper/mailer.js";
import UPIInfo from "../models/UPIInfo.js";
import { PAYMENT_STATUS } from "../helper/status.js";
import Transaction from "../models/Transaction.js";
import PaymentStatus from "../models/PaymentStatus.js";
import Therapists from "../models/Therapists.js";
import generateToken from "../config/generateToken.js";
import { otpVerificationEmail } from "../services/mailTemplates.js";

export const CreateWorkshop = expressAsyncHandler(async (req, res, next) => {
  const workshopSchema = Joi.object({
    title: Joi.string().required().messages({
      "string.base": "Title should be a type of text",
      "string.empty": "Title cannot be an empty field",
      "any.required": "Title is a required field",
    }),
    category: Joi.string().required().messages({
      "string.base": "Category should be a type of text",
      "string.empty": "Category cannot be an empty field",
      "any.required": "Category is a required field",
    }),
    short_desc: Joi.string().required().messages({
      "string.base": "Short description should be a type of text",
      "string.empty": "Short description cannot be an empty field",
      "any.required": "Short description is a required field",
    }),
    desc: Joi.string().required().messages({
      "string.base": "Description should be a type of text",
      "string.empty": "Description cannot be an empty field",
      "any.required": "Description is a required field",
    }),
    level: Joi.string().required().messages({
      "string.base": "Level should be a type of text",
      "string.empty": "Level cannot be an empty field",
      "any.required": "Level is a required field",
    }),
    language: Joi.string().required().messages({
      "string.base": "Language should be a type of text",
      "string.empty": "Language cannot be an empty field",
      "any.required": "Language is a required field",
    }),
    event_date: Joi.date().required().messages({
      "date.base": "Event date should be a valid date",
      "date.empty": "Event date cannot be an empty field",
      "any.required": "Event date is a required field",
    }),
    event_end_date: Joi.date().required().messages({
      "date.base": "Event End date should be a valid date",
      "date.empty": "Event End date cannot be an empty field",
      "any.required": "Event End date is a required field",
    }),
    mrp: Joi.number().required().messages({
      "number.base": "MRP should be a number",
      "number.empty": "MRP cannot be an empty field",
      "any.required": "MRP is a required field",
    }),
    price: Joi.number().required().messages({
      "number.base": "Price should be a number",
      "number.empty": "Price cannot be an empty field",
      "any.required": "Price is a required field",
    }),
    event_time: Joi.string().required().messages({
      "string.base": "Event Time should be a type of text",
      "string.empty": "Event Time cannot be an empty field",
      "any.required": "Event Time is a required field",
    }),
    duration: Joi.string().required().messages({
      "string.base": "Duration should be a type of text",
      "string.empty": "Duration cannot be an empty field",
      "any.required": "Duration is a required field",
    }),
  }).unknown(true);

  const { error } = workshopSchema.validate(req.body);
  if (error) {
    return next(error);
  }

  const {
    title,
    short_desc,
    level,
    language,
    event_date,
    event_end_date,
    mrp,
    price,
    desc,
    category,
    event_time,
    duration,
  } = req.body;

  try {
    const imagefile = req.files["image"] ? req.files["image"][0] : null;
    const pdffile = req.files["pdf"] ? req.files["pdf"][0] : null;

    if (!imagefile || !pdffile) {
      return res
        .status(400)
        .json({ message: "Both image and PDF files are required." });
    }
    const MAX_IMAGE_SIZE = 1 * 1024 * 1024;
    const MAX_PDF_SIZE = 5 * 1024 * 1024;
    let workshop_image = null;
    let content_pdf = null;

    if (imagefile.size > MAX_IMAGE_SIZE) {
      res.status(400);
      throw new Error(
        `Image file size should not exceed ${MAX_IMAGE_SIZE / (1024 * 1024)
        } MB.`
      );
    } else {
      workshop_image = imagefile.filename;
    }

    if (pdffile.size > MAX_PDF_SIZE) {
      res.status(400);
      throw new Error(
        `PDF file size should not exceed ${MAX_PDF_SIZE / (1024 * 1024)} MB.`
      );
    } else {
      content_pdf = pdffile.filename;
    }

    const therapist = await Therapists.findOne({ user: req.user._id });

    let post_by = therapist._id;
    const savedWorkshop = await Workshop.create({
      post_by,
      title,
      category,
      short_desc,
      level,
      language,
      event_date,
      event_end_date,
      mrp,
      price,
      desc,
      event_time,
      duration,
      workshop_image,
      content_pdf,
      reviews: [],
    });

    if (savedWorkshop) {
      res.status(201).json({
        message: "Workshop created successfully.",
        data: {},
        status: true,
      });
    } else {
      res.status(400);
      throw new Error("Failed to create workshop.");
    }
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

export const UpdateWorkshop = expressAsyncHandler(async (req, res, next) => {
  const workshopSchema = Joi.object({
    title: Joi.string().required().messages({
      "string.base": "Title should be a type of text",
      "string.empty": "Title cannot be an empty field",
      "any.required": "Title is a required field",
    }),
    category: Joi.string().required().messages({
      "string.base": "Category should be a type of text",
      "string.empty": "Category cannot be an empty field",
      "any.required": "Category is a required field",
    }),
    short_desc: Joi.string().required().messages({
      "string.base": "Short description should be a type of text",
      "string.empty": "Short description cannot be an empty field",
      "any.required": "Short description is a required field",
    }),
    desc: Joi.string().required().messages({
      "string.base": "Description should be a type of text",
      "string.empty": "Description cannot be an empty field",
      "any.required": "Description is a required field",
    }),
    level: Joi.string().required().messages({
      "string.base": "Level should be a type of text",
      "string.empty": "Level cannot be an empty field",
      "any.required": "Level is a required field",
    }),
    language: Joi.string().required().messages({
      "string.base": "Language should be a type of text",
      "string.empty": "Language cannot be an empty field",
      "any.required": "Language is a required field",
    }),
    event_date: Joi.date().required().messages({
      "date.base": "Event date should be a valid date",
      "date.empty": "Event date cannot be an empty field",
      "any.required": "Event date is a required field",
    }),
    event_end_date: Joi.date().required().messages({
      "date.base": "Event End date should be a valid date",
      "date.empty": "Event End date cannot be an empty field",
      "any.required": "Event End date is a required field",
    }),
    mrp: Joi.number().required().messages({
      "number.base": "MRP should be a number",
      "number.empty": "MRP cannot be an empty field",
      "any.required": "MRP is a required field",
    }),
    price: Joi.number().required().messages({
      "number.base": "Price should be a number",
      "number.empty": "Price cannot be an empty field",
      "any.required": "Price is a required field",
    }),
    event_time: Joi.string().required().messages({
      "string.base": "Event Time should be a type of text",
      "string.empty": "Event Time cannot be an empty field",
      "any.required": "Event Time is a required field",
    }),
    duration: Joi.string().required().messages({
      "string.base": "Duration should be a type of text",
      "string.empty": "Duration cannot be an empty field",
      "any.required": "Duration is a required field",
    }),
  }).unknown(true);

  const { error } = workshopSchema.validate(req.body);
  if (error) {
    return next(error);
  }

  const {
    title,
    short_desc,
    level,
    language,
    event_date,
    event_end_date,
    mrp,
    price,
    desc,
    workshopId,
    category,
    event_time,
    duration,
  } = req.body;

  try {
    const isExists = await Workshop.findById(workshopId);
    if (!isExists) {
      res.status(400);
      throw new Error("No workshop found.");
    }
    const imagefile = req.files?.image?.[0] || null;
    const pdffile = req.files?.pdf?.[0] || null;

    const MAX_IMAGE_SIZE = 1 * 1024 * 1024;
    const MAX_PDF_SIZE = 5 * 1024 * 1024;
    let workshop_image = isExists.workshop_image;
    let content_pdf = isExists.content_pdf;

    if (imagefile) {
      if (imagefile.size > MAX_IMAGE_SIZE) {
        return res.status(400).json({
          message: `Image file size should not exceed ${MAX_IMAGE_SIZE / (1024 * 1024)} MB.`,
          status: false,
        });
      }
      workshop_image = imagefile.filename;
    }
    if (pdffile) {
      if (pdffile.size > MAX_PDF_SIZE) {
        return res.status(400).json({
          message: `PDF file size should not exceed ${MAX_PDF_SIZE / (1024 * 1024)} MB.`,
          status: false,
        });
      }
      content_pdf = pdffile.filename;
    }

    const updatedWorkShop = await Workshop.findByIdAndUpdate(
      workshopId,
      {
        title,
        category,
        short_desc,
        level,
        language,
        event_date,
        event_end_date,
        mrp,
        price,
        desc,
        event_time,
        duration,
        workshop_image,
        content_pdf,
      },
      { new: true }
    );
    res.status(200).json({
      message: "Workshop updated successfully.",
      data: updatedWorkShop,
      status: true,
    });

  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

export const CreateReview = expressAsyncHandler(async (req, res, next) => {
  const reviewSchema = Joi.object({
    name: Joi.string().email().required(),
    profile: Joi.string().email().required(),
    star: Joi.string()
      .length(1)



      .pattern(/^[0-9]+$/)
      .required()
      .messages({
        "string.pattern.base": "Please enter valid number.",
      }),
    review: Joi.string().required().messages({
      "string.base": "Review should be a type of text",
      "string.empty": "Review cannot be an empty field",
      "any.required": "Review is a required field",
    }),
  });
  const { error } = reviewSchema.validate(req.body);

  if (error) {
    return next(error);
  }

  const workshopId = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(workshopId)) {
    return res.status(400).json({
      status: false,
      message: "Invalid workshop ID.",
    });
  }

  const { name, image, review, star } = req.body;

  try {
    const workshop = await Workshop.findById(workshopId);
    if (!workshop) {
      return res.status(404).json({
        status: false,
        message: "Workshop not found.",
      });
    }

    const newReview = { name, image, review, star };
    workshop.reviews.push(newReview);

    const updatedWorkshop = await workshop.save();

    res.status(201).json({
      status: true,
      message: "Review added successfully.",
      data: updatedWorkshop,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

export const GetWorkshops = expressAsyncHandler(async (req, res, next) => {
  try {
    let { page, pageSize } = req.query;
    page = parseInt(page) || 1;
    pageSize = parseInt(pageSize) || 6;
    const skip = (page - 1) * pageSize;
    const limit = pageSize;
    const therapist = await Therapists.findOne({ user: req.user._id })
    const workshops = await Workshop.find({
      post_by: therapist._id,
    })
      .sort({ _id: -1 })
      .skip(skip)
      .limit(limit);
    res.status(201).json({
      message: "Fetched successfully",
      data: workshops || [],
      status: true,
    });
  } catch (error) {
    res.status(400);
    throw new Error("Unknow error");
  }
});

export const DisableWorkshop = expressAsyncHandler(async (req, res, next) => {
  try {
    let { is_active, id } = req.query;
    const workshop = await Workshop.findById(id);
    if (workshop) {
      workshop.is_active = is_active;
      await workshop.save();
      res.status(201).json({
        message: "Updated successfully",
        data: {},
        status: true,
      });
    } else {
      res.status(400);
      throw new Error("Workshop not found.");
    }
  } catch (error) {
    res.status(400);
    throw new Error(error);
  }
});

export const DeleteWorkshop = expressAsyncHandler(async (req, res, next) => {
  try {
    let { id } = req.query;
    const workshop = await Workshop.findByIdAndDelete(id);
    if (workshop) {
      res.status(200).json({
        message: "Deleted successfully",
        data: {},
        status: true,
      });
    } else {
      res.status(400);
      throw new Error("Workshop not found.");
    }
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

export const GetWorkshop = expressAsyncHandler(async (req, res, next) => {
  try {
    let { workshopId } = req.params;
    const workshop = await Workshop.findById(workshopId);
    res.status(201).json({
      message: "Fetched successfully",
      data: workshop || [],
      status: true,
    });
  } catch (error) {
    res.status(400);
    throw new Error("Unknow error");
  }
});

export const GetWorkshopWeb = expressAsyncHandler(async (req, res, next) => {
  try {
    let { workshopId } = req.params;
    const today = new Date().toISOString().split("T")[0];
    const workshop = await Workshop.findOne({
      _id: workshopId,
      is_active: 1,
      event_date: { $gte: today }, // only future or ongoing
    }).populate({
      path: "post_by", // this is the therapist
      select: "profile_type experties user", // include user so it can be populated
      populate: {
        path: "user", // populate the user inside therapist
        select: "name phone email bio profile age gender dob", // fields you need
      },
    });
    if (workshop) {
      const moreWorkshopsByThisUser = await Workshop.find({
        post_by: workshop.post_by._id,
        _id: { $ne: workshop._id },
        event_date: { $gte: today },
      });
      const similarWorkshop = await Workshop.find({
        post_by: { $ne: workshop.post_by._id },
        event_date: { $gte: today },
      });
      res.status(201).json({
        message: "Fetched successfully",
        data: workshop,
        workshopByThisUser: moreWorkshopsByThisUser || [],
        similarWorkshop: similarWorkshop || [],
        status: true,
      });
    } else {
      res.status(201).json({
        message: "Fetched successfully",
        data: [],
        workshopByThisUser: [],
        similarWorkshop: [],
        status: true,
      });
    }
  } catch (error) {
    res.status(400);
    throw new Error("Unknow error");
  }
});

export const GetWorkshopsWeb = expressAsyncHandler(async (req, res, next) => {
  let { level, language, category, search } = req.query;
  try {
    const matchConditions = {
      is_active: 1,
    };

    if (level && level.trim() !== "") {
      matchConditions.level = level;
    }

    if (language && language.trim() !== "") {
      matchConditions.language = language;
    }

    if (category && category.trim() !== "") {
      matchConditions.category = category;
    }

    if (search && search.trim() !== "") {
      const nameRegex = new RegExp(search, "i");
      matchConditions.title = { $regex: nameRegex };
    }

    const currentDateISO = new Date().toISOString().slice(0, 10);
    matchConditions.event_date = { $gte: currentDateISO };

    const data = await Workshop.find(matchConditions).sort({ _id: -1 });

    res.status(200).json({
      message: "Fetched successfully",
      data: data,
      status: true,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error);
  }
});

export const BookWorkshop = expressAsyncHandler(async (req, res, next) => {
  const bookingSchema = Joi.object({
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

    is_student: Joi.boolean().required(),

    program_name: Joi.string()
      .when("is_student", {
        is: true,
        then: Joi.required().messages({
          "any.required": "Program name is required when student",
        }),
        otherwise: Joi.optional().allow(""),
      })
      .messages({
        "string.base": "Program name must be a text",
      }),

    institution_name: Joi.string()
      .when("is_student", {
        is: true,
        then: Joi.required().messages({
          "any.required": "Institution name is required when student",
        }),
        otherwise: Joi.optional().allow(""),
      })
      .messages({
        "string.base": "Institution name must be a text",
      }),

    is_logged_in: Joi.boolean().required().messages({
      "boolean.base": "is_logged_in must be true or false",
      "any.required": "is_logged_in flag is required",
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
    amount: Joi.number().min(0).required().messages({
      "number.base": "Amount must be a number",
      "number.min": "Amount must be greater than or equal to 0",
      "any.required": "Amount is required",
    }),
    workshopId: Joi.string().required().messages({
      "any.required": "Workshop ID is required",
      "string.base": "Workshop ID must be a string",
    }),

    therapist: Joi.string().required().messages({
      "any.required": "Therapist ID is required",
      "string.base": "Therapist ID must be a string",
    }),

  }).unknown(true);

  const { error } = bookingSchema.validate(req.body);

  if (error) {
    res.status(400);
    return next(new Error(error.details[0].message));
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      name,
      phone,
      is_student,
      program_name,
      institution_name,
      is_logged_in,
      user_id,
      workshopId,
      amount
    } = req.body;

    let email = req.body.email;

    if (!mongoose.Types.ObjectId.isValid(workshopId)) {
      res.status(400);
      return next(new Error("Workshop Not Exist."));
    }

    const isExist = await Workshop.findById(workshopId).session(session);

    if (!isExist) {
      res.status(400);
      return next(new Error("Workshop not exist."));
    }

    let generatedOtp = generate6DigitOTP();
    let otp_count = 1;
    let user;

    if (is_logged_in) {
      if (!mongoose.Types.ObjectId.isValid(user_id)) {
        res.status(400);
        return next(new Error("Invalid user id."));
      }
      user = await Users.findById(user_id).session(session);
      if (!user) {
        res.status(400);
        return next(new Error("User not found."));
      }

      user.otp = generatedOtp;
      user.otp_count = (user.otp_count || 0) + 1;
      await user.save({ session });
    } else {
      email = email.toLowerCase();
      user = await Users.findOne({ email }).session(session);
      if (user) {
        if (user.is_verified === 1) {
          res.status(400);
          return next(new Error("This user is already registred with us"));
        }
        user.otp = generatedOtp;
        user.otp_count = (user.otp_count || 0) + 1;
        await user.save({ session });
      } else {

        user = await Users.create(
          [{
            name,
            email,
            phone,
            otp: generatedOtp,
            otp_count: 1,
          }],
          { session }
        );
        user = user[0];

      }
    }

    const existingBooking = await WorkshopBooking.findOne({
      workshop: isExist._id,
      user: user._id,
      transaction: { $ne: null }
    }).session(session);

    if (existingBooking) {
      throw new Error("You have already booked this workshop.");
    }

    const booking = await WorkshopBooking.create(
      [{
        workshop: isExist._id,
        user: user._id,
        is_student,
        program_name,
        institution_name,
        amount,
      }],
      { session }
    );

    const subject = "Welcome to CYT";
    const text = `Hello Thank you for registering use the this otp ${generatedOtp} to verify booking.Best regards,CYT`;
    const html = otpVerificationEmail(generatedOtp);

    await sendMail(email, subject, text, html);

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      status: true,
      message: "Booking saved successfully. An OTP was sent to your email.",
      data: { id: booking[0]._id },
    });


  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(new Error(err.message));
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
    const isBookingDetail = await WorkshopBooking.findById(bookingId);
    if (!isBookingDetail) {
      res.status(400);
      return next(new Error("booking not found with this id"));

    }
    if (isBookingDetail.is_payment_success) {
      res.status(400);
      return next(new Error("Booking amount already received for this id new"));
      // return res.status(200).json({
      //   message: "Booking amount already received for this id",
      //   status: true,
      //   data:null
      // });
    }
    const data = {
      upiID: getUpi.upi_id,
      name: getUpi.name,
      amount: isBookingDetail.amount,
      note: "Booking workshop",
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

export const savePaymentDetails = expressAsyncHandler(async (req, res, next) => {
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

    const isBookingDetail = await WorkshopBooking.findById(booking_id).populate("user");
    if (!isBookingDetail) {
      res.status(400);
      return next(new Error("booking not found with this id"));
    }
    if (isBookingDetail.is_payment_success) {
      return res.status(400).json({
        message: "Booking amount already received for this id",
        status: false,
      });
    }

    const data = {
      booking: isBookingDetail._id,
      bookingModel: "WorkshopBooking",
      user: isBookingDetail.user,
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
    isBookingDetail.is_payment_success = true;
    await isBookingDetail.save();

    res.status(201).json({
      status: true,
      message: "Payment Success.",
      data: isBookingDetail,
      // auto-login only for client accounts (guest checkout); never a therapist/admin token — audit P0-1
      ...(isBookingDetail.user?.role === 0 ? { token: generateToken(isBookingDetail.user._id, isBookingDetail.user.role) } : {}),
    });
  } catch (err) {
    return next(new Error(err.message));
  }
});

export const GetMyBookings = expressAsyncHandler(async (req, res, next) => {

  try {

    await PaymentStatus.findOne();
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400);
      return next(new Error("Booking invalid."));
    }

    let result = await WorkshopBooking.find({ user: userId, transaction: { $exists: true, $ne: null } })
      .populate({
        path: "user",
        select: "name email mobile profile age gender",
      })
      .populate({
        path: "workshop",
        populate: {
          path: "post_by",
          select: "_id user profile_code",
          populate: {
            path: "user",
            select: "_id name email profile"
          }
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
      message: "Fetched Successfully.",
      data: result || [],
    });
  } catch (err) {
    return next(new Error(err.message));
  }
});