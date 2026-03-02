import expressAsyncHandler from "express-async-handler";
import NewsLetter from "../models/Newsletter.js";
import Joi from "joi";
import { generate6DigitOTP } from "../helper/generate.js";
import { sendMail } from "../helper/mailer.js";
import { getTimeDifferenceInSeconds } from "../helper/time.js";
import { newsletterSubscriptionOtpEmail } from "../services/mailTemplates.js";

export const subscribeNewsletter = expressAsyncHandler(
  async (req, res, next) => {
    const registerSchema = Joi.object({
      email: Joi.string().email().required(),
    });

    const { error } = registerSchema.validate(req.body);

    if (error) {
      return next(error);
    }

    let email = req.body.email;

    try {
      email = email.toLowerCase();

      const isExists = await NewsLetter.findOne({ email });
      let otp = generate6DigitOTP();
      const subject = "Newsletter Subscription | CYT";
      const text = `Thank you for subscribing to CYT. Your verification code is ${otp}.`;

      const html = newsletterSubscriptionOtpEmail(email, otp);

      if (isExists && isExists.is_verified === 1) {
        res.status(400);
        return next(new Error("This email is already subscribed us"));
      } else if (isExists && isExists.is_verified === 0) {
        if (
          isExists.otp_count >= 5 &&
          getTimeDifferenceInSeconds(isExists.updatedAt) < 3600
        ) {
          res.status(400);
          throw new Error(
            `Can't send otp! Maximum limit exceeded.Please try after ${parseInt(
              getTimeDifferenceInSeconds(isExists.updatedAt) / 3600
            )} hour.`
          );
        } else if (
          isExists.otp_count <= 5 &&
          getTimeDifferenceInSeconds(isExists.updatedAt) < 30
        ) {
          res.status(400);
          throw new Error("Unable to send OTP");
        } else {
          isExists.otp = otp;
          isExists.otp_count = isExists.otp_count + 1;
          await isExists.save();
          await sendMail(email, subject, text, html);
          res.status(201).json({
            message: "Otp has been sent to your mail id",
            data: {},
            status: true,
          });
        }
      } else {
        let otp_count = 1;
        await sendMail(email, subject, text, html);
        const newsletter = await NewsLetter.create({
          email,
          otp,
          otp_count,
        });
        if (newsletter) {
          res.status(201).json({
            message: "Otp has been sent to your mail id",
            data: {},
            status: true,
          });
        } else {
          res.status(400);
          throw new Error("Failed to send otp");
        }
      }
    } catch (error) {
      res.status(400);
      throw new Error(error.message);
    }
  }
);

export const VerifyOtp = expressAsyncHandler(async (req, res, next) => {
  const registerSchema = Joi.object({
    email: Joi.string().email().required(),
    otp: Joi.string()
      .length(6)
      .pattern(/^[0-9]+$/)
      .required()
      .messages({
        "string.pattern.base": "Please enter valid otp.",
      }),
  });

  const { error } = registerSchema.validate(req.body);

  if (error) {
    return next(error);
  }

  const { otp } = req.body;
  let email = req.body.email;

  try {
    email = email.toLowerCase();

    const isExists = await NewsLetter.findOne({ email });

    if (isExists && isExists.is_verified === 1) {
      res.status(400);
      return next(new Error("This email is already subscribed us."));
    } else if (isExists && isExists.otp === otp) {
      isExists.otp = "";
      isExists.otp_count = 0;
      isExists.is_verified = 1;
      await isExists.save();
      res.status(201).json({
        message: "Thankyou for subscribing",
        data: {},
        status: true,
      });
    } else if (isExists && isExists.otp !== otp) {
      res.status(400);
      return next(new Error("Invalid OTP."));
    } else {
      res.status(400);
      return next(new Error("This email id is not exists."));
    }
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});
