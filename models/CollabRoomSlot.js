import mongoose from "mongoose";
const { Schema } = mongoose;

/* One hour of the weekly timetable of the single collaboration room at CYT Noida.
   The unique (day, hour) index is what guarantees two professionals can never be given
   the same hour, even if two admins assign at the same moment. */
const collabRoomSlotSchema = new Schema({
  day:         { type: Number, required: true, min: 0, max: 6 },   // 0 = Sunday
  hour:        { type: Number, required: true, min: 0, max: 23 },  // slot start hour
  application: { type: Schema.Types.ObjectId, ref: "CollabApplication", required: true },
  assignedBy:  { type: String, default: "" },
}, { timestamps: true });

collabRoomSlotSchema.index({ day: 1, hour: 1 }, { unique: true });
collabRoomSlotSchema.index({ application: 1 });

export default mongoose.model("CollabRoomSlot", collabRoomSlotSchema);
