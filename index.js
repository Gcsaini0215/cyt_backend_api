import "dotenv/config";
import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import mongoose from "mongoose";
import app from "./app.js";
import { startAvailabilityReminders } from "./services/availabilityReminder.js";
import { startSubscriptionReconcile } from "./helper/therapistSubscription.js";
import { startSessionAutoComplete } from "./services/sessionAutoComplete.js";
import { startPendingPaymentMails } from "./services/pendingPaymentMail.js";
import { startSessionReminders } from "./services/sessionReminderMail.js";
import { startTopBadgeJob } from "./helper/therapistGrowth.js";
import { startTherapistAreaJob } from "./helper/therapistArea.js";
import { startRebookNudges } from "./services/rebookNudge.js";
import { startAchievementJob } from "./services/achievementJob.js";

mongoose.set("strictQuery", true);
mongoose.connect(process.env.MONGODB_URI).then(() => {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log("Server running");
    startAvailabilityReminders();
    startSubscriptionReconcile();
    startSessionAutoComplete();
    startPendingPaymentMails();
    startSessionReminders();
    startTopBadgeJob();
    startTherapistAreaJob();
    startRebookNudges();
    startAchievementJob();
  });
}).catch((err) => console.log(err));