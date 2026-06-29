import expressAsyncHandler from "express-async-handler";
import FavoriteTherapist from "../models/FavriouteTherapist.js";
import Notify from "../models/Notify.js";
import Booking from "../models/Booking.js";
import WorkshopBooking from "../models/WorkshopBooking.js";
import AppointmentRequest from "../models/AppointmentRequest.js";

export const getDashboardData = expressAsyncHandler(
    async (req, res, next) => {
        const userId = req.user._id;
        const userPhone = req.user.phone || "";
        try {
            const appointments = await Booking.countDocuments({ client: userId, status: "New" });
            const bookings = await Booking.countDocuments({ client: userId });
            const events = await WorkshopBooking.countDocuments({ user: userId });
            const notify = await Notify.findOne();

            // Fetch this user's appointment requests matched by phone
            const appointmentRequests = userPhone
                ? await AppointmentRequest.find({ phone: userPhone })
                    .sort({ createdAt: -1 })
                    .limit(5)
                    .lean()
                : [];

            const data = {
                appointments: appointments || '00',
                bookings: bookings || '00',
                events: events || '00',
                notify,
                appointmentRequests,
            };
            res.status(201).json({
                message: "Success",
                data: data || {},
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
            const favorite = await FavoriteTherapist.findOne({ userId });

            if (!favorite) {
                res.status(201).json({
                    message: "Success",
                    data: {},
                    status: false,
                });
            } else {
                res.status(201).json({
                    message: "Success",
                    data: favorite,
                    status: true,
                });
            }
        } catch (error) {
            res.status(400);
            throw new Error(error);
        }
    }
);
