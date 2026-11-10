import express from "express";
import { isTherapist, hasPermission } from "../middlewares/authMiddleware.js";
import { myGoogleListing, saveMyGoogleListing, adminGoogleListings } from "../controllers/GoogleListingController.js";

// "Get found on Google Maps" — therapist guide + admin tracker
const router = express.Router();

router.get("/therapist/google-listing", isTherapist, myGoogleListing);
router.put("/therapist/google-listing", isTherapist, saveMyGoogleListing);
router.get("/admin/google-listings", hasPermission("therapists"), adminGoogleListings);

export default router;
