import expressAsyncHandler from "express-async-handler";
import Therapists, { defaultFees } from "../models/Therapists.js";
import Users from "../models/Users.js";
import Bank from "../models/Bank.js";
import Fees from "../models/Fees.js";
import Availbility from "../models/Availbility.js";
import mongoose from "mongoose";
import Workshop from "../models/Workshop.js";
import Review from "../models/Review.js";
import Booking from "../models/Booking.js";
import WorkshopBooking from "../models/WorkshopBooking.js";
export const updateprofile = expressAsyncHandler(async (req, res, next) => {
  const {
    phone,
    name,
    license_number,
    gender,
    state,
    office_address,
    year_of_exp,
    qualification,
    language_spoken,
    session_formats,
    bio,
  } = req.body;

  if (name.length < 3) {
    res.status(400);
    return next(new Error("Please enter valid name"));
  }
  if (phone.length != 10) {
    res.status(400);
    return next(new Error("Please enter valid phone"));
  }

  try {
    let newProfile = "";
    if (req.file && req.file !== null) {
      if (req.file.size > 200 * 1024) {
        res.status(400);
        return next(new Error("File size should be less than 200KB!"));
      }
      newProfile = req.file.filename;
    }

    let therapist = await Therapists.findOne({ user: req.user._id });
    therapist.license_number = license_number;
    therapist.gender = gender;
    therapist.state = state;
    therapist.office_address = office_address;
    therapist.year_of_exp = year_of_exp;
    therapist.qualification = qualification;
    therapist.language_spoken = language_spoken;
    therapist.session_formats = session_formats;
    await therapist.save();
    await Users.findByIdAndUpdate(
      req.user._id,
      {
        phone,
        name,
        bio,
        gender,
        profile: newProfile || req.user.profile
      },
      { new: true }
    );

    res.status(201).json({
      status: true,
      message: "Profile has been updated.",
      data: therapist,
    });
  } catch (err) {
    return next(new Error(err.message));
  }
});

export const updateServiceExperties = expressAsyncHandler(
  async (req, res, next) => {
    const { services, experties } = req.body;

    try {
      const updatedUser = await Therapists.findOneAndUpdate(
        { user: req.user._id },
        {
          services,
          experties,
        },
        { new: true }
      );
      if (updatedUser) {
        res.status(201).json({
          status: true,
          message: "Services and Experties has been updated.",
          data: {},
        });
      } else {
        res.status(400);
        return next(new Error("Failed to update Services and Experties"));
      }
    } catch (err) {
      return next(new Error(err.message));
    }
  }
);

export const updateAccountDetails = expressAsyncHandler(
  async (req, res, next) => {
    const { ac_name, ac_number, ifsc, upi } = req.body;

    try {
      const filter = { _id: req.user._id };
      const update = {
        $set: {
          ac_name: ac_name,
          ac_number: ac_number,
          ifsc: ifsc,
          upi: upi,
        },
      };

      const options = { upsert: true }; // upsert option
      const result = await Bank.updateOne(filter, update, options);

      if (result.upsertedCount || result.modifiedCount) {
        res.status(201).json({
          status: true,
          message: "Account details has been updated.",
          data: [],
        });
      } else {
        res.status(400);
        return next(new Error("Failed to update account details"));
      }
    } catch (err) {
      return next(new Error(err.message));
    }
  }
);

export const updateFeeDetails = expressAsyncHandler(async (req, res, next) => {
  const { fees } = req.body;

  try {
    const filter = { user: req.user._id };
    const update = { $set: { fees: fees } };

    const result = await Therapists.updateOne(filter, update);

    if (result) {
      res.status(201).json({
        status: true,
        message: "Fee details has been updated.",
        data: [],
      });
    } else {
      res.status(400);
      return next(new Error("Failed to update fee details"));
    }
  } catch (err) {
    return next(new Error(err.message));
  }
});

export const updateAvailabilityDetails = expressAsyncHandler(
  async (req, res, next) => {
    const { schedule } = req.body;

    try {
      const isExist = await Therapists.findOne({ user: req.user._id });
      if (isExist) {
        isExist.availabilities = schedule;
        await isExist.save();
        res.status(201).json({
          status: true,
          message: "Details has been updated.",
          data: [],
        });
      } else {
        res.status(400);
        return next(new Error("Therapist not exists!"));
      }
    } catch (error) {
      res.status(400);
      return next(new Error(`Failed to update details,${error.message}`));
    }
  }
);

export const getAvailabilityDetails = expressAsyncHandler(
  async (req, res, next) => {
    try {
      const availabilityDetails = await Availbility.findOne({
        user_id: req.user._id,
      }).select("schedule");

      if (!availabilityDetails) {
        return res.status(200).json({
          status: true,
          message: "Fetched details successfully.",
          data: [],
        });
      }

      res.status(200).json({
        status: true,
        message: "Fetched details successfully.",
        data: availabilityDetails.schedule,
      });
    } catch (err) {
      return next(new Error(err.message));
    }
  }
);

export const getAccountDetails = expressAsyncHandler(async (req, res, next) => {
  try {
    const bankDetails = await Bank.findById(req.user._id).select(
      "ac_name ac_number ifsc upi -_id"
    );

    res.status(201).json({
      status: true,
      message: "Fetched details successfully.",
      data: bankDetails || [],
    });
  } catch (err) {
    return next(new Error(err.message));
  }
});

export const getFeeDetails = expressAsyncHandler(async (req, res, next) => {
  try {
    const bankDetails = await Fees.findById(req.user._id).select(
      "icv ica icip cca ccv ccip tca tcv tcip -_id"
    );

    res.status(201).json({
      status: true,
      message: "Fetched details successfully.",
      data: bankDetails || [],
    });
  } catch (err) {
    return next(new Error(err.message));
  }
});

export const getTherapists = expressAsyncHandler(async (req, res, next) => {
  try {
    const data = await Therapists.find({}).populate('user',"email phone profile age bio is_verified gender name").sort({ createdAt: -1 });
    res.status(201).json({
      message: "Fetched successfully",
      data: data,
      status: true,
    });
  } catch (error) {
    res.status(400);
    throw new Error("Unknow error");
  }
});

export const getFilteredTherapists = expressAsyncHandler(
  async (req, res, next) => {
    let {
      page,
      pageSize,
      priority,
      profile_type,
      year_of_exp,
      language_spoken,
      qualification,
      search,
    } = req.query;
    try {
      page = parseInt(page) || 1;
      pageSize = parseInt(pageSize);
      let skip = 0;

      if (!pageSize) {
        pageSize = await Therapists.countDocuments();
      } else {
        skip = (page - 1) * pageSize;
      }


      const matchConditions = {
        show_to_page: 1,
      };

      if (priority && parseInt(priority) < 3 && parseInt(priority) > 0) {
        matchConditions.priority = parseInt(priority);
      }

      if (profile_type && profile_type.trim() !== "") {
        matchConditions.profile_type = profile_type;
      }

      if (year_of_exp && year_of_exp.trim() !== "") {
        matchConditions.year_of_exp = year_of_exp;
      }

      if (qualification && qualification.trim() !== "") {
        matchConditions.qualification = qualification;
      }

      if (language_spoken && language_spoken.trim() !== "") {
        const languageRegex = new RegExp(
          `(^|,)\\s*${language_spoken}\\s*(,|$)`,
          "i"
        );
        matchConditions.language_spoken = { $regex: languageRegex };
      }

      if (search && search.trim() !== "") {
        const searchRegex = new RegExp(search, "i");
        matchConditions.$or = [
          { "services.service": searchRegex },
          { experties: searchRegex },
          { state: searchRegex },
        ];
      }

      const [data, totalCount] = await Promise.all([
        Therapists.find(matchConditions)
          .skip(skip)
          .limit(pageSize)
          .select("-resume -__v -is_mail_sent -is_aproved")
          .populate("user", "name phone email bio profile gender age dob"),
        Therapists.countDocuments(matchConditions),
      ]);

      res.status(200).json({
        message: "Fetched successfully",
        data,
        totalCount,
        status: true,
      });
    } catch (error) {
      res.status(400);
      throw new Error(error);
    }
  }
);

export const getProfile = expressAsyncHandler(async (req, res, next) => {
  const userId = req.params.userId;
  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400);
      return next(new Error("Invalid user ID format"));
    }
   let therapist = await Therapists.findById(userId)
      .select(" -resume -__v -is_mail_sent")
      .populate("user", "name phone email bio profile age gender dob").lean();;
    
    if (!therapist) {
      return res.status(404).json({
        message: "Therapist not found",
        data: {},
        status: false,
      });
    }
     const today = new Date().toISOString().split("T")[0]; 
    const workshop = await Workshop.find({ post_by: therapist._id, is_active: 1,event_date: { $gte: today } })

    const reviews = await Review.find({ therapist_id: therapist._id }).sort({ createdAt: -1 });

     therapist.workshops = workshop;
     therapist.reviews = reviews;

    res.status(200).json({
      message: "Fetched successfully",
      data: therapist||{},
      status: true,
    });
  } catch (error) {
    console.log(error);
    res.status(400);
    throw new Error(`Unknow error`);
  }
});

export const checkProfileSet = expressAsyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  try {
    const data = await Therapists.aggregate([
      {
        $match: {
          _id: mongoose.Types.ObjectId(userId),
        },
      },
      {
        $lookup: {
          from: "fees",
          localField: "_id",
          foreignField: "_id",
          as: "fees",
        },
      },
      {
        $unwind: "$fees",
      },
      {
        $lookup: {
          from: "availabilities",
          localField: "_id",
          foreignField: "user_id",
          as: "availabilities",
        },
      },
      {
        $unwind: {
          path: "$availabilities",
          preserveNullAndEmptyArrays: true, // Use this if you want to include therapists without availabilities
        },
      },
      {
        $project: {
          services: 1,
          experties: 1,
          icv: "$fees.icv",
          ica: "$fees.ica",
          icip: "$fees.icip",
          cca: "$fees.cca",
          ccv: "$fees.ccv",
          ccip: "$fees.ccip",
          tca: "$fees.tca",
          tcv: "$fees.tcv",
          tcip: "$fees.tcip",
          schedule: "$availabilities.schedule", // Include schedule in the projection
        },
      },
    ]);

    let check = true;

    if (data && data.length > 0) {
      let userData = data[0];

      const userDetailsEmpty =
        !userData.ica &&
        !userData.icip &&
        !userData.icv &&
        !userData.tca &&
        !userData.tcip &&
        !userData.tcv &&
        !userData.cca &&
        !userData.ccip &&
        !userData.ccv;

      const servicesEmpty = userData.services == null;

      const scheduleEmpty = userData.schedule.length === 0;

      if (userDetailsEmpty || servicesEmpty || scheduleEmpty) {
        check = false;
      }
    }

    res.status(200).json({
      message: "Fetched successfully",
      data: { check },
      status: true,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error);
  }
});

export const getTherapist = expressAsyncHandler(async (req, res, next) => {
  const user = req.user;

  try {
    const userExists = await Therapists.findOne({ user: user._id })
      .select("-_id -resume -__v -is_mail_sent")
      .populate("user", "name phone email bio profile age gender dob");
    res.status(201).json({
      message: "Fetched successfully",
      data: userExists || {},
      status: true,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error?.message || "Unknown Error");
  }
});

export const getDashboardData = expressAsyncHandler(async (req, res, next) => {
  const user = req.user;

  try {
    const therapistProfile = await Therapists.findOne({ user: user._id });
    
    if (!therapistProfile) {
      return res.status(201).json({
        message: "Fetched successfully",
        data: {
          workshops: 0,
          appointments: 0,
          revenue: 0,
          client: 0,
        },
        status: true,
      });
    }

    const workshopCount = await Workshop.countDocuments({
      post_by: therapistProfile._id,
      is_active: 1,
    });

    const bookings = await Booking.find({ therapist: therapistProfile._id, transaction: { $exists: true, $ne: null } })
      .populate("client", "name email phone profile")
      .sort({ _id: -1 });

    const appointmentRevenue = bookings.reduce((sum, booking) => {
      return sum + (booking.amount ? parseFloat(booking.amount.toString()) : 0);
    }, 0);

    const workshops = await Workshop.find({ post_by: therapistProfile._id });
    const workshopIds = workshops.map(w => w._id);
    const workshopBookings = await WorkshopBooking.find({ workshop: { $in: workshopIds }, is_payment_success: true })
      .populate("user", "name email phone profile")
      .populate("workshop", "title category event_date")
      .sort({ _id: -1 });

    const workshopRevenue = workshopBookings.reduce((sum, booking) => {
      return sum + (booking.amount ? parseFloat(booking.amount.toString()) : 0);
    }, 0);

    const totalRevenue = appointmentRevenue + workshopRevenue;

    const uniqueClients = new Set([
      ...bookings.map(b => b.client?._id?.toString()),
      ...workshopBookings.map(wb => wb.user?._id?.toString())
    ].filter(id => id)).size;

    res.status(201).json({
      message: "Fetched successfully",
      data: {
        workshops: workshopCount,
        appointments: bookings.length,
        revenue: totalRevenue.toFixed(2),
        client: uniqueClients,
        recentAppointments: bookings.slice(0, 5),
        recentWorkshops: workshopBookings.slice(0, 5),
      },
      status: true,
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message || "Unknown error");
  }
});

export const ShowToPage = expressAsyncHandler(async (req, res, next) => {
  const userId = req.params.therapistId;
  if (!userId) {
    res.status(400);
    return next(new Error("Please pass user ID"));
  }
  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400);
      return next(new Error("Invalid user ID format"));
    }
    const userExists = await Therapists.findById(userId);

    if (!userExists) {
      res.status(400);
      return next(new Error("This therapist is not exists"));
    }

    const show_to_page = !userExists.show_to_page;

    const updatedUser = await Therapists.findByIdAndUpdate(
      userId,
      { show_to_page },
      { new: true }
    );

    res.status(201).json({
      message: "Therapist set to page successfully",
      data:updatedUser,
      status: true,
    });
  } catch (error) {
    res.status(400);
    return next(new Error(error));
  }
});



export const SetPriority = expressAsyncHandler(async (req, res, next) => {
  const {therapistId,value=0} = req.body;
  if (!therapistId ) {
    res.status(400);
    return next(new Error("Please pass user ID"));
  }
  try {
    if (!mongoose.Types.ObjectId.isValid(therapistId)) {
      res.status(400);
      return next(new Error("Invalid user ID format"));
    }
    const userExists = await Therapists.findById(therapistId);

    if (!userExists) {
      res.status(400);
      return next(new Error("This therapist is not exists"));
    }

    const priority = value;
    const updatedUser = await Therapists.findByIdAndUpdate(
      therapistId,
      { priority },
      { new: true }
    );

    res.status(201).json({
      message: "Priority set successfully",
      data:updatedUser,
      status: true,
    });
  } catch (error) {
    res.status(400);
    return next(new Error(error));
  }
});

export const saveReview = expressAsyncHandler(async (req, res, next) => {
  const { therapistId, name, email, rating, description } = req.body;

  if (!therapistId || !name || !email || !rating || !description) {
    res.status(400);
    return next(new Error("Please provide all required fields"));
  }

  try {
    const review = await Review.create({
      therapist_id: therapistId,
      name,
      email,
      rating,
      description,
    });

    res.status(201).json({
      status: true,
      message: "Review submitted successfully.",
      data: review,
    });
  } catch (err) {
    return next(new Error(err.message));
  }
});


  
export const getReviews = expressAsyncHandler(async (req, res, next) => { 
  try {  
    const reviews = await Review.find({})  
      .populate({  
        path: 'therapist_id',  
        populate: { path: 'user', select: 'name' }  
      })  
      .sort({ createdAt: -1 });  
    res.status(200).json({  
      status: true,  
      message: 'Fetched successfully',  
      data: reviews,  
    });  
  } catch (error) {  
    res.status(400);  
    throw new Error(error.message);  
  }  
}); 

export const deleteReview = expressAsyncHandler(async (req, res, next) => {
  const { id } = req.params;
  try {
    const review = await Review.findByIdAndDelete(id);
    if (!review) {
      res.status(404);
      return next(new Error('Review not found'));
    }
    res.status(200).json({
      status: true,
      message: 'Review deleted successfully',
    });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});