import mongoose from "mongoose";
const { model } = mongoose;
const Schema = mongoose.Schema;


//0-User
//1-Therapist

const UserSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      match: [/^\S+@\S+\.\S+$/, "Please use a valid email address."],
    },
    phone: {
      type: String,
      required: true,
      match: [/^\d{10}$/, "Please enter a valid 10-digit phone number."],
    },
    profile: {
      type: String,
      default:
        "https://e7.pngegg.com/pngimages/753/432/png-clipart-user-profile-2018-in-sight-user-conference-expo-business-default-business-angle-service-thumbnail.png",
    },
    bio: {
      type: String,
      default: null,
    },
    resetToken: {
      type: String,
      default: null,
    },

    tokenExpiration: {
      type: Date,
      default: null,
    },
    is_online: {
      type: Number,
      default: 0,
    },
    is_verified: {
      type: Number,
      default: 0,
      enum: [0, 1],
    },
    otp: {
      type: String,
      default: null,
    },
    otp_count: {
      type: Number,
      default: 0,
    },
    role: {
      type: Number,
      default: 0,
      enum: [0, 1,2],
    },
    last_visit: {
      type: Date,
      default: null,
    },
    age: {
      type: Number,
      default: null
    },
    gender: {
      type: String,
      default: null
    },
    dob: {
      type: String,
      default: null
    },
    // "Give ₹200, get ₹200" (helper/referral.js): the client's share code and unspent reward
    referral_code: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
    referral_credit: { type: Number, default: 0 },
    rebook_nudge_off: { type: Boolean, default: false }, // unsubscribed from "book your next session" emails
  },
  { timestamps: true }
);


export default model("User", UserSchema);
