import "dotenv/config";
import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import mongoose from "mongoose";
import app from "./app.js";
import { startAvailabilityReminders } from "./services/availabilityReminder.js";

mongoose.set("strictQuery", true);
mongoose.connect(process.env.MONGODB_URI).then(() => {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log("Server running");
    startAvailabilityReminders();
  });
}).catch((err) => console.log(err));