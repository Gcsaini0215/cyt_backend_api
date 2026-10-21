import mongoose from "mongoose";
const { model, Schema } = mongoose;

// One row per alert in the trainee portal's bell (new task, notes shared, certificate ready, plan given …).
// Written by services/traineeNotify.js, which also pushes it live to the trainee's open portal tabs.
const TraineeNotificationSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    type: { type: String, required: true }, // task | task-update | note | certificate | plan | attendance
    title: { type: String, required: true },
    body: { type: String, default: "" },
    link: { type: String, default: "" },
    read_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
TraineeNotificationSchema.index({ email: 1, createdAt: -1 });

export default model("TraineeNotification", TraineeNotificationSchema);
