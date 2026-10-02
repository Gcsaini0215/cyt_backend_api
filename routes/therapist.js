import { Router } from "express";  
import { unsubscribeToken } from "../services/availabilityReminder.js";
import TherapistsModel from "../models/Therapists.js";
import { hasPermission, isTherapist, isAuthCommon } from "../middlewares/authMiddleware.js";
  
import {
  getTherapist,
  getTherapists,
  updateAccountDetails,
  updateServiceExperties,
  updateprofile,
  getAccountDetails,
  getFeeDetails,
  updateFeeDetails,
  updateAvailabilityDetails,
  getAvailabilityDetails,
  getFilteredTherapists,
  getProfile,
  checkProfileSet,
  getDashboardData,
  setDashboardSince,
  ShowToPage,
  ShowToPageSelf,
  SetPriority,
  saveReview,
  getReviews,
  deleteReview,
  deleteUser,
  getMyReviews,
} from "../controllers/TherapistController.js";  
import { upload } from "../services/fileUpload.js";
import { getTherapistStats } from "../controllers/TherapistStatsController.js";  
const router = Router();  
  
router.post(  
  "/update-therapist-profile",  
  isTherapist,  
  upload.single("file"),  
  updateprofile  
);  
  
router.post("/update-service-experties", isTherapist, updateServiceExperties);  
  
router.post("/update-account-details", isTherapist, updateAccountDetails);  
  
router.post("/update-fee-details", isTherapist, updateFeeDetails);  
  
router.post(  
  "/update-availability-details",  
  isTherapist,  
  updateAvailabilityDetails  
);  
  
router.get("/get-availability-details", isTherapist, getAvailabilityDetails);  
  
router.get("/get-therapists",hasPermission(["therapists","bdm"]), getTherapists);
router.get("/therapist-stats", hasPermission("therapists"), getTherapistStats);

router.get("/toggle-to-show-to-page/:therapistId",hasPermission("therapists"), ShowToPage);

router.get("/toggle-my-visibility", isTherapist, ShowToPageSelf);

router.post("/set-priority",hasPermission("therapists"), SetPriority);
  
router.get("/get-therapists-profile", getFilteredTherapists);  
  
router.get("/get-profile/:userId", getProfile);  
  
router.get("/get-therapist", isTherapist, getTherapist);  
  
router.get("/get-bank-details", isTherapist, getAccountDetails);  
  
router.get("/get-fee-details", isTherapist, getFeeDetails);  
  
router.get("/check-profile-set", isTherapist, checkProfileSet);  
  
router.post("/save-review", saveReview);  
  
router.get("/get-reviews", hasPermission(["reviews","bdm"]), getReviews);

router.delete("/delete-review/:id", hasPermission("reviews"), deleteReview);

router.delete("/delete-user", hasPermission(["therapists","clients"]), deleteUser);

router.get("/get-my-reviews", isAuthCommon, getMyReviews);
router.post("/set-dashboard-since", isTherapist, setDashboardSince);

// One-click "stop availability reminders" link from the reminder email
router.get("/availability-reminders/unsubscribe", async (req, res) => {
  const id = String(req.query.id || "");
  const t = String(req.query.t || "");
  const page = (msg) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial,sans-serif;background:#f4f6f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="background:#fff;border-radius:14px;padding:28px 26px;max-width:420px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.08)"><h2 style="color:#0f3d24;margin:0 0 8px">Choose Your Therapist</h2><p style="color:#475569;line-height:1.6">${msg}</p><a href="https://www.chooseyourtherapist.in/my-schedule?tab=availability" style="color:#166534;font-weight:700">Open My Schedule</a></div></body>`;
  if (!/^[a-f0-9]{24}$/.test(id) || t !== unsubscribeToken(id)) return res.status(400).send(page("This link is not valid."));
  await TherapistsModel.updateOne({ _id: id }, { availability_reminders_off: true });
  res.send(page("Done — you won't get availability reminder emails any more."));
});

export default router;
