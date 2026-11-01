import mongoose from "mongoose";
const { model, Schema } = mongoose;

// One free pro bono session: the details a client shares, then the session the admin team schedules.
// Kept apart from Booking so it never counts in therapist payouts, earnings or paid-session stats.
const ProbonoSessionSchema = new Schema(
  {
    intern: { type: Schema.Types.ObjectId, ref: "ProbonoIntern", default: null }, // set by the team when scheduling
    preferred: { type: Schema.Types.ObjectId, ref: "ProbonoIntern", default: null }, // the guide the client came from
    client: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, default: "" },
    email: { type: String, default: "", lowercase: true, trim: true },
    phone: { type: String, default: "" }, // last 10 digits, so one number can't take a second free session
    concern: { type: String, default: "" },
    age: { type: Number, default: null },
    city: { type: String, default: "" },
    language: { type: String, default: "" },
    consent_at: { type: Date, required: true },
    slot_at: { type: Date, default: null },
    // requested → accepted (scheduled) → completed | no_show; or declined | cancelled (the free session is released)
    status: { type: String, default: "requested" },
    // true while this row holds the client's one free session and the trainee's slot
    holds_free: { type: Boolean, default: true },
    decline_reason: { type: String, default: "" },
    team_note: { type: String, default: "" }, // e.g. why a trainee handed the session back
    meet_link: { type: String, default: "" },
    calendar_event_id: { type: String, default: "" },
    accepted_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    // the first-paid-session coupon, created when the free session is completed (helper/probono.js)
    coupon_code: { type: String, default: undefined },
    coupon_amount: { type: Number, default: 0 },
    coupon_expires_at: { type: Date, default: null },
    coupon_used_at: { type: Date, default: null },
    coupon_booking: { type: Schema.Types.ObjectId, ref: "Booking", default: null },
  },
  { timestamps: true }
);

ProbonoSessionSchema.index({ client: 1 }, { unique: true, partialFilterExpression: { holds_free: true } });
ProbonoSessionSchema.index({ intern: 1, slot_at: 1 }, { unique: true, partialFilterExpression: { holds_free: true, slot_at: { $type: "date" } } });
ProbonoSessionSchema.index({ phone: 1, holds_free: 1 });
ProbonoSessionSchema.index({ intern: 1, createdAt: -1 });
ProbonoSessionSchema.index({ coupon_code: 1 }, { unique: true, sparse: true });

export default model("ProbonoSession", ProbonoSessionSchema);
