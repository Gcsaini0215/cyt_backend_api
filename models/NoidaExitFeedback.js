import mongoose from "mongoose";
const { Schema } = mongoose;

/* Why a visitor left the public Noida booking page without booking. Asked in a small
   popup when they press the page's back button, the browser/phone back button, or (on
   desktop) move to close the tab. The reason is one tap; the phone number is optional
   and only given when they want a callback — reception follows those up. */
export const EXIT_REASONS = [
  "price_high",
  "no_suitable_slot",
  "just_exploring",
  "centre_far",
  "unsure_what_to_book",
  "need_more_info",
  "payment_issue",
  "booking_confusing",
  "other",
];

const noidaExitFeedbackSchema = new Schema({
  reason:        { type: String, enum: EXIT_REASONS, required: true },
  otherText:     { type: String, default: "" },
  phone:         { type: String, default: "" },
  wantsCallback: { type: Boolean, default: false },

  // Where they were when they left — helps spot which step loses people.
  stage:       { type: String, enum: ["browsing", "form", "payment"], default: "browsing" },
  bookingType: { type: String, enum: ["new", "followup", "reschedule"], default: "new" },
  trigger:     { type: String, enum: ["back_button", "browser_back", "exit_intent"], default: "back_button" },
  device:      { type: String, enum: ["mobile", "tablet", "desktop"], default: "desktop" },
  slotDate:    { type: String, default: "" },
  slotTime:    { type: String, default: "" },

  status:      { type: String, enum: ["new", "contacted", "closed"], default: "new" },
  note:        { type: String, default: "" },
  handledBy:   { type: Schema.Types.ObjectId, ref: "Admin", default: null },
  handledAt:   { type: Date, default: null },
}, { timestamps: true });

noidaExitFeedbackSchema.index({ createdAt: -1 });
noidaExitFeedbackSchema.index({ status: 1, wantsCallback: 1 });

export default mongoose.model("NoidaExitFeedback", noidaExitFeedbackSchema);
