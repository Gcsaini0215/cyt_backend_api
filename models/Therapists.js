import mongoose from "mongoose";
const { model } = mongoose;
const Schema = mongoose.Schema;


const formatSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
  },
  fee: {
    type: Number,
    default: null,
  },
});

const feeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  formats: [formatSchema],
});

export const defaultFees = [
  {
    name: "Individual Counselling",
    formats: [
      { type: "audio", fee: null },
      { type: "video", fee: null },
      { type: "in-person", fee: null },
    ],
  },
  {
    name: "Couple Counselling",
    formats: [
      { type: "audio", fee: null },
      { type: "video", fee: null },
      { type: "in-person", fee: null },
    ],
  },
  {
    name: "Teen Counselling",
    formats: [
      { type: "audio", fee: null },
      { type: "video", fee: null },
      { type: "in-person", fee: null },
    ],
  },
];

const timeSchema = new Schema({
  open: {
    type: String,
    required: true,
  },
  close: {
    type: String,
    required: true,
  },
});

const scheduleSchema = new Schema({
  day: {
    type: String,
    required: true,
  },
  times: [timeSchema],
});

const TherapistSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    serve_type: {
      type: String,
      default: null,
    },
    profile_type: {
      type: String,
      default: null,
    },
    mode: {
      type: String,
      default: null,
    },
    profile_code: { type: String, default: "" },

    resume: { type: String, default: null },
    qualification_certificate: { type: String, default: null },
    id_card: { type: String, default: null },
    id_card_type: { type: String, default: null },

    is_mail_sent: {
      type: Number,
      default: 0,
    },
    license_number: {
      type: String,
      default: "",
    },

    state: {
      type: String,
      default: null,
    },
    office_address: {
      type: String,
      default: null,
    },
    year_of_exp: {
      type: String,
      default: null,
    },
    qualification: {
      type: String,
      default: null,
    },
    language_spoken: {
      type: String,
      default: null,
    },
    session_formats: {
      type: String,
      default: null,
    },
    services: {
      type: String,
      default: null,
    },
    experties: {
      type: String,
      default: null,
    },
    fees: {
      type: [feeSchema],
      default: () => defaultFees,
    },
    availabilities: [scheduleSchema],
    priority: {
      type: Number,
      default: 0,
    },
    show_to_page: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export default model("Therapists", TherapistSchema);
