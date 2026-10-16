import expressAsyncHandler from "express-async-handler";
import Joi from "joi";
import Coupon from "../models/Coupan.js";
import Therapists from "../models/Therapists.js";
import { resolveReferral, applicantEmail, REFERRAL_AMOUNT } from "../helper/referral.js";

export const CreateCoupan = expressAsyncHandler(
    async (req, res, next) => {
        const createCouponSchema = Joi.object({

            code: Joi.string().trim().min(3).max(20).required().messages({
                "string.base": "Coupon code must be a string",
                "string.min": "Coupon code must be at least 3 characters",
                "string.max": "Coupon code must be at most 20 characters",
                "any.required": "Coupon code is required",
            }),

            discount_type: Joi.string()
                .valid("percentage", "flat")
                .required()
                .messages({
                    "any.only": "Discount type must be either 'percentage' or 'flat'",
                    "any.required": "Discount type is required",
                }),

            coupon_for: Joi.string()
                .valid("Therapist", "Workshop")
                .required()
                .messages({
                    "any.only": "Coupon can be only for therapist or workshop",
                }),    

            discount_value: Joi.number().positive().required().messages({
                "number.base": "Discount value must be a number",
                "number.positive": "Discount value must be positive",
                "any.required": "Discount value is required",
            }),

            max_usage: Joi.number().integer().min(1).default(1).messages({
                "number.base": "Max usage must be a number",
                "number.min": "Max usage must be at least 1",
            }),

            valid_from: Joi.date().default(Date.now),

            valid_until: Joi.date().greater("now").required().messages({
                "date.base": "Valid until must be a valid date",
                "date.greater": "Valid until must be a future date",
                "any.required": "Valid until date is required",
            }),
        });

        const { error } = createCouponSchema.validate(req.body, { abortEarly: false });

        if (error) {
            if (error) {
                res.status(400);
                return next(new Error(error.details[0].message));
            }
        }

        try {
            const {
                code,
                discount_type,
                discount_value,
                max_usage,
                valid_from,
                valid_until,
                coupon_for
            } = req.body;

            const existingCoupon = await Coupon.findOne({ code,therapist:req.user._id });
            if (existingCoupon) {
                res.status(400);
                return next(new Error("Coupon code already exists."));
            }

            const coupon = new Coupon({
                therapist: req.user._id,
                code:code.trim().toUpperCase(),
                discount_type,
                discount_value,
                max_usage: max_usage || 1,
                valid_from: valid_from || Date.now(),
                valid_until,
                coupon_for
            });

            await coupon.save();

            res.status(201).json({
                status: true,
                message: "Coupan created successfully.",
                data: coupon,
            });
        } catch (error) {
            return next(new Error(err.message));
        }


    }


);


export const GetCoupans = expressAsyncHandler(
    async (req, res, next) => {
        try {
            const coupans = await Coupon.find({ therapist: req.user._id });
            res.status(201).json({
                status: true,
                message: "Coupons fetched successfully.",
                data: coupans || [],
            });
        } catch (error) {
            return next(new Error(err.message));
        }


    }
);

export const GetCoupan = expressAsyncHandler(
    async (req, res, next) => {
         const couponId = req.params.id;
        try {
            const coupan = await Coupon.findById(couponId);
            res.status(201).json({
                status: true,
                message: "Coupon fetched successfully.",
                data: coupan || [],
            });
        } catch (error) {
            return next(new Error(err.message));
        }


    }


);

export const UpdateCoupan = expressAsyncHandler(
    async (req, res, next) => {

        const createCouponSchema = Joi.object({

            code: Joi.string().trim().min(3).max(20).required().messages({
                "string.base": "Coupon code must be a string",
                "string.min": "Coupon code must be at least 3 characters",
                "string.max": "Coupon code must be at most 20 characters",
                "any.required": "Coupon code is required",
            }),

            discount_type: Joi.string()
                .valid("percentage", "flat")
                .required()
                .messages({
                    "any.only": "Discount type must be either 'percentage' or 'flat'",
                    "any.required": "Discount type is required",
                }),

            discount_value: Joi.number().positive().required().messages({
                "number.base": "Discount value must be a number",
                "number.positive": "Discount value must be positive",
                "any.required": "Discount value is required",
            }),
            coupon_for: Joi.string()
                .valid("Therapist", "Workshop")
                .required()
                .messages({
                    "any.only": "Coupon can be only for therapist or workshop",
                }),    


            max_usage: Joi.number().integer().min(1).default(1).messages({
                "number.base": "Max usage must be a number",
                "number.min": "Max usage must be at least 1",
            }),

            valid_from: Joi.date().default(Date.now),

            valid_until: Joi.date().greater("now").required().messages({
                "date.base": "Valid until must be a valid date",
                "date.greater": "Valid until must be a future date",
                "any.required": "Valid until date is required",
            }),
        });

        const { error } = createCouponSchema.validate(req.body, { abortEarly: false });

        if (error) {
            if (error) {
                res.status(400);
                return next(new Error(error.details[0].message));
            }
        }

        try {

            const { id } = req.params;

            const {
                code,
                discount_type,
                discount_value,
                max_usage,
                valid_from,
                valid_until,
                coupon_for
            } = req.body;

            const existingCoupon = await Coupon.findById(id);
            if (!existingCoupon) {
                return res.status(404).json({ message: "Coupon not found" });
            }
            if (code && code.trim().toUpperCase() !== existingCoupon.code) {
                const duplicate = await Coupon.findOne({
                    code,
                    therapist_id: req.user._id,
                });

                if (duplicate) {
                    res.status(400);
                    return next(new Error("Coupon code already exists for this therapist"));

                }
            }

            existingCoupon.code = code.trim().toUpperCase() || existingCoupon.code;
            existingCoupon.discount_type = discount_type || existingCoupon.discount_type;
            existingCoupon.discount_value = discount_value || existingCoupon.discount_value;
            existingCoupon.max_usage = max_usage || existingCoupon.max_usage;
            existingCoupon.valid_from = valid_from || existingCoupon.valid_from;
            existingCoupon.valid_until = valid_until || existingCoupon.valid_until;
            existingCoupon.coupon_for = coupon_for || existingCoupon.coupon_for;

            await existingCoupon.save();

            res.status(201).json({
                status: true,
                message: "Coupan updated successfully.",
                data: existingCoupon,
            });
        } catch (error) {
            return next(new Error(err.message));
        }
    }

);

export const ToggleSatus = expressAsyncHandler(
    async (req, res, next) => {
        try {

            const { id } = req.params;

            const existingCoupon = await Coupon.findById(id);
            if (!existingCoupon) {
                res.status(400);
                return next(new Error("Coupon not found."));
            }

            existingCoupon.is_active = !existingCoupon.is_active;
            await existingCoupon.save();

            res.status(201).json({
                status: true,
                message: "Coupan status changed!.",
                data: existingCoupon,
            });
        } catch (error) {
            return next(new Error(err.message));
        }
    }

);

export const DeleteCoupon = expressAsyncHandler(async (req, res, next) => {
    try {
        const { id } = req.params;

        const existingCoupon = await Coupon.findById(id);
        if (!existingCoupon) {
            return res.status(404).json({ message: "Coupon code already exists." });
        }

        await existingCoupon.deleteOne();

        return res.status(200).json({
            status: true,
            message: "Coupon deleted successfully",
            data: existingCoupon,
        });
    } catch (error) {
        return next(new Error(error.message));
    }
});

export const ApplyCoupon = expressAsyncHandler(async (req, res, next) => {
    try {
        // the booking page sends { coupon_code, amount }, older checkouts { code } — accept both
        const { therapist_id } = req.body;
        const apply_for = req.body.apply_for || "Therapist";
        const code = String(req.body.code || req.body.coupon_code || "").trim().toUpperCase();
        const amount = Math.max(0, Number(req.body.amount) || 0);
        const discountOf = (type, value) => {
            if (!amount) return 0;
            return Math.min(amount, type === "percentage" ? Math.round((amount * value) / 100) : value);
        };

        // a friend's referral code works on any therapist's session
        if (code && apply_for === "Therapist") {
            const coupon = therapist_id ? await Coupon.exists({ therapist: therapist_id, code }) : null;
            if (!coupon) {
                const ref = await resolveReferral({ code, email: await applicantEmail(req) });
                if (ref?.error) return res.status(400).json({ status: false, message: ref.error });
                if (ref) {
                    return res.status(200).json({
                        status: true,
                        message: `Referral applied — ₹${REFERRAL_AMOUNT} off your first session`,
                        data: { code, referral: true, discount_type: "flat", discount_value: REFERRAL_AMOUNT, discount: discountOf("flat", REFERRAL_AMOUNT) },
                    });
                }
            }
        }

        if (!therapist_id || !code) {
            return res.status(400).json({
                status: false,
                message: "Therapist ID and Coupon code are required",
            });
        }

        const user = Therapists.findById(therapist_id);

        if(!user){
             return res.status(400).json({
                status: false,
                message: "Therapist not found",
            });
        }


        const coupon = await Coupon.findOne({
            therapist: therapist_id,
            code,
        });

        if (!coupon) {
            return res.status(400).json({
                status: false,
                message: "Invalid coupon code",
            });
        }

        if (!coupon.is_active) {
            return res.status(400).json({
                status: false,
                message: "Coupon is not active",
            });
        }

        if (apply_for !== coupon.coupon_for) {
            return res.status(400).json({
                status: false,
                message: "This coupon cannot be used here",
            });
        }

        if (coupon.used_count >= coupon.max_usage) {
            return res.status(400).json({
                status: false,
                message: "Coupon usage limit reached",
            });
        }

        const now = new Date();
        if (now < coupon.valid_from || now > coupon.valid_until) {
            return res.status(400).json({
                status: false,
                message: "Coupon is expired or not yet valid",
            });
        }

        coupon.max_usage = coupon.max_usage+1;
       await coupon.save();

        return res.status(200).json({
            status: true,
            message: "Coupon applied successfully",
            data: {
                _id: coupon._id,
                code,
                discount_type: coupon.discount_type,
                discount_value: coupon.discount_value,
                discount: discountOf(coupon.discount_type, coupon.discount_value),
            },
        });
    } catch (error) {
        // unexpected errors
        return next(error);
    }
});


