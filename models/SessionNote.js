import mongoose from "mongoose";
const { Schema } = mongoose;

// The client's own notes for a session ("what I want to talk about"). Private to the client: kept apart
// from Booking so no booking API (therapist, admin) ever carries it.
const sessionNoteSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    booking: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    text: { type: String, default: "", maxlength: 2000 },
  },
  { timestamps: true }
);

sessionNoteSchema.index({ user: 1, booking: 1 }, { unique: true });

export default mongoose.model("SessionNote", sessionNoteSchema);
