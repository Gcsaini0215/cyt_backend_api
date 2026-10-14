import mongoose from "mongoose";
const { Schema } = mongoose;

// A therapist's connected Google account (for creating Meet links on their own calendar).
// The refresh token is stored encrypted (helper/googleMeet.js).
const TherapistGoogleSchema = new Schema({
  user:          { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  email:         { type: String, default: "" },
  refresh_token: { type: String, required: true }, // AES-256-GCM, never sent to clients
  connected_at:  { type: Date, default: Date.now },
  last_error:    { type: String, default: "" },
  last_error_at: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.model("TherapistGoogle", TherapistGoogleSchema);
