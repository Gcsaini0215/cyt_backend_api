import mongoose from "mongoose";
const Schema = mongoose.Schema;

const ChatMessageSchema = new Schema({
  therapistId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  userId:      { type: Schema.Types.ObjectId, ref: "User", required: true },
  sender:      { type: String, enum: ["user", "therapist"], required: true },
  message:     { type: String, required: true, maxlength: 2000 },
  readAt:      { type: Date, default: null },
}, { timestamps: true });

ChatMessageSchema.index({ therapistId: 1, userId: 1, createdAt: 1 });

export default mongoose.model("ChatMessage", ChatMessageSchema);
