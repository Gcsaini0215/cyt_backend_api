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
import { isAdmin } from "../middlewares/authMiddleware.js";
import { upload } from "../services/fileUpload.js";
import { leadRateLimit } from "../middlewares/rateLimitMiddleware.js";

const router = express.Router();

router.get("/probono-interns", getProbonoInterns);
router.get("/probono-interns/all", isAdmin, getAllProbonoInterns);
router.post("/probono-interns", isAdmin, upload.single("photo"), createProbonoIntern);
router.put("/probono-interns/:id", isAdmin, upload.single("photo"), updateProbonoIntern);
router.delete("/probono-interns/:id", isAdmin, deleteProbonoIntern);
router.patch("/probono-interns/:id/toggle", isAdmin, toggleProbonoIntern);
router.patch("/probono-interns/:id/request-sent", leadRateLimit, incrementRequestSent);
router.post("/probono-interns/:id/review", leadRateLimit, saveProbonoReview);
router.get("/probono-interns/:id/reviews", getProbonoReviews);
router.get("/probono-reviews", isAdmin, getAllProbonoReviews);
router.delete("/probono-reviews/:id", isAdmin, deleteProbonoReview);

export default router;
