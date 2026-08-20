import express from "express";
import {
  getProbonoInterns,
  getAllProbonoInterns,
  createProbonoIntern,
  updateProbonoIntern,
  deleteProbonoIntern,
  toggleProbonoIntern,
  incrementRequestSent,
  saveProbonoReview,
  getProbonoReviews,
  getAllProbonoReviews,
  deleteProbonoReview,
} from "../controllers/probonoController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";
import { upload } from "../services/fileUpload.js";
import { leadRateLimit } from "../middlewares/rateLimitMiddleware.js";

const router = express.Router();

router.get("/probono-interns", getProbonoInterns);
router.get("/probono-interns/all", hasPermission("probono"), getAllProbonoInterns);
router.post("/probono-interns", hasPermission("probono"), upload.single("photo"), createProbonoIntern);
router.put("/probono-interns/:id", hasPermission("probono"), upload.single("photo"), updateProbonoIntern);
router.delete("/probono-interns/:id", hasPermission("probono"), deleteProbonoIntern);
router.patch("/probono-interns/:id/toggle", hasPermission("probono"), toggleProbonoIntern);
router.patch("/probono-interns/:id/request-sent", leadRateLimit, incrementRequestSent);
router.post("/probono-interns/:id/review", leadRateLimit, saveProbonoReview);
router.get("/probono-interns/:id/reviews", getProbonoReviews);
router.get("/probono-reviews", hasPermission("probono"), getAllProbonoReviews);
router.delete("/probono-reviews/:id", hasPermission("probono"), deleteProbonoReview);

export default router;
