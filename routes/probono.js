import express from "express";
import {
  getProbonoInterns,
  getAllProbonoInterns,
  createProbonoIntern,
  updateProbonoIntern,
  deleteProbonoIntern,
  toggleProbonoIntern,
} from "../controllers/probonoController.js";
import { isAdmin } from "../middlewares/authMiddleware.js";
import { upload } from "../services/fileUpload.js";

const router = express.Router();

router.get("/probono-interns", getProbonoInterns);
router.get("/probono-interns/all", isAdmin, getAllProbonoInterns);
router.post("/probono-interns", isAdmin, upload.single("photo"), createProbonoIntern);
router.put("/probono-interns/:id", isAdmin, upload.single("photo"), updateProbonoIntern);
router.delete("/probono-interns/:id", isAdmin, deleteProbonoIntern);
router.patch("/probono-interns/:id/toggle", isAdmin, toggleProbonoIntern);

export default router;
