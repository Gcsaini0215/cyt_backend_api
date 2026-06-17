import { Router } from "express";  
import { isAdmin, isTherapist } from "../middlewares/authMiddleware.js";  
  
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
  ShowToPage,
  SetPriority,
  saveReview,
  getReviews,
  deleteReview,
  deleteUser,
  getMyReviews,
} from "../controllers/TherapistController.js";  
import { upload } from "../services/fileUpload.js";  
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
  
router.get("/get-therapists",isAdmin, getTherapists);  
  
router.get("/toggle-to-show-to-page/:therapistId",isAdmin, ShowToPage);  
  
router.post("/set-priority",isAdmin, SetPriority);  
  
router.get("/get-therapists-profile", getFilteredTherapists);  
  
router.get("/get-profile/:userId", getProfile);  
  
router.get("/get-therapist", isTherapist, getTherapist);  
  
router.get("/get-bank-details", isTherapist, getAccountDetails);  
  
router.get("/get-fee-details", isTherapist, getFeeDetails);  
  
router.get("/check-profile-set", isTherapist, checkProfileSet);  
  
router.post("/save-review", saveReview);  
  
router.get("/get-reviews", isAdmin, getReviews);  
  
router.delete("/delete-review/:id", isAdmin, deleteReview);

router.delete("/delete-user", isAdmin, deleteUser);

router.get("/get-my-reviews", isTherapist, getMyReviews);

export default router;
