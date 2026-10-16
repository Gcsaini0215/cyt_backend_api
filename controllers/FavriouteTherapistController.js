import expressAsyncHandler from "express-async-handler";
import FavoriteTherapist from "../models/FavriouteTherapist.js";
import mongoose from "mongoose";

export const insertFavriouteTherapist = expressAsyncHandler(
  async (req, res, next) => {
    const { therapistId } = req.body;
    const userId = req.user._id;

    try {
      if (!mongoose.Types.ObjectId.isValid(therapistId)) {
        res.status(400);
        return next(new Error("Invalid ID provided"));
      }
      let favorite = await FavoriteTherapist.findOne({ user: userId, therapist: therapistId });
      if (favorite) {
        // already saved — answer once (falling through used to create a duplicate and then fail)
        return res.status(201).json({
          message: "Saved successfully.",
          data: favorite,
          status: true,
        });
      }
      let result = await FavoriteTherapist.create({
        user: userId,
        therapist: therapistId
      })


      res.status(201).json({
        message: "Saved successfully.",
        data: result,
        status: true,
      });
    } catch (error) {
      res.status(400);
      throw new Error("Failed to add favorite therapist.");
    }
  }
);

export const removeFavriouteTherapist = expressAsyncHandler(
  async (req, res, next) => {
    const { therapistId } = req.body;
    const userId = req.user._id;

    try {
      if (!mongoose.Types.ObjectId.isValid(therapistId)) {
        res.status(400);
        return next(new Error("Invalid ID provided"));
      }
      console.log("userss",userId,  therapistId);
      let favorite = await FavoriteTherapist.findOne({ user: userId, therapist: therapistId });
      console.log("favvv",favorite);
      if (!favorite) {
        res.status(400);
        return next(new Error("Favorite Therapist not found."));

      }
      await favorite.deleteOne()
      res.status(201).json({
        message: "Removed successfully",
        data: {},
        status: true,
      });
    } catch (error) {
      res.status(400);
      throw new Error("Failed to remove favorite therapist.");
    }
  }
);

export const getFavriouteTherapists = expressAsyncHandler(
  async (req, res, next) => {
    const userId = req.user._id;
    const {
      profile_type,
      services,
      year_of_exp,
      language_spoken,
      qualification,
      search,
      page = 1,
      limit = 10,
    } = req.body;

    const query = {};

    if (profile_type) {
      query.profile_type = profile_type;
    }

    if (services) {
      query.services = { $regex: services, $options: "i" }; // Partial match, case-insensitive
    }

    if (year_of_exp) {
      query.year_of_exp = year_of_exp;
    }

    if (language_spoken) {
      query.language_spoken = { $regex: language_spoken, $options: "i" }; // Partial match, case-insensitive
    }

    if (qualification) {
      query.qualification = { $regex: qualification, $options: "i" }; // Partial match, case-insensitive
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { profile_type: { $regex: search, $options: "i" } },
        { services: { $regex: search, $options: "i" } },
      ];
    }
    const skip = (page - 1) * limit;
    try {
      const favorite = await FavoriteTherapist.find({ user:userId }).populate({
        path: "therapist",
        select:
          "_id profile_type services year_of_exp language_spoken qualification serve_type session_formats experties fees state",
        populate: {
          path: "user",
          select: "_id name email profile"
        }
      });

      res.status(201).json({
        message: "Success",
        // a therapist who has since been removed populates as null — leave those out
        data: (favorite || []).filter((f) => f.therapist && f.therapist.user),
        status: true,
      });
    } catch (error) {
      res.status(400);
      throw new Error(error);
    }
  }
);

export const getFavriouteTherapistsList = expressAsyncHandler(
  async (req, res, next) => {
    const userId = req.user._id;

    try {
      // ids of the therapists this client saved — profile cards use it to fill in the heart
      const ids = await FavoriteTherapist.find({ user: userId }).distinct("therapist");
      res.status(201).json({
        message: "Success",
        data: { therapists: ids.map(String) },
        status: true,
      });
    } catch (error) {
      res.status(400);
      throw new Error(error);
    }
  }
);
