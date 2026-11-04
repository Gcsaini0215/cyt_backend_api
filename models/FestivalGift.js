import mongoose from "mongoose";
const { Schema } = mongoose;

/* The free session from a festival "book 1, get 1" offer. Made when the paid session is booked;
   whoever holds the link (the buyer, or the person they gifted it to) books it at ₹0 before `validTill`. */
const festivalGiftSchema = new Schema({
  code:  { type: String, required: true, unique: true }, // XXXX-XXXX, the link's secret
  offer: { type: String, required: true },               // e.g. "diwali-2026"

  buyerAppointment: { type: Schema.Types.ObjectId, ref: "NoidaAppointment", required: true, unique: true },
  buyerName:  { type: String, default: "" },
  buyerPhone: { type: String, default: "" },
  buyerEmail: { type: String, default: "" },
  purchasedOn: { type: String, required: true }, // "YYYY-MM-DD" (IST)
  validTill:   { type: String, required: true }, // last day the free session can be on

  forSelf: { type: Boolean, default: false },     // the buyer will use it themselves
  recipientName:  { type: String, default: "" },
  recipientPhone: { type: String, default: "" },
  recipientEmail: { type: String, default: "" },
  giftedAt: { type: Date, default: null },        // when the recipient was set (and emailed)

  claiming: { type: Boolean, default: false },    // a booking is being made with it right now
  redeemedAppointment: { type: Schema.Types.ObjectId, ref: "NoidaAppointment", default: null },
  redeemedAt: { type: Date, default: null },
}, { timestamps: true });

festivalGiftSchema.index({ buyerEmail: 1 });
festivalGiftSchema.index({ recipientEmail: 1 });

export default mongoose.model("FestivalGift", festivalGiftSchema);
