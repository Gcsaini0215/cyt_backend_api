import express from "express";
import { isAuthCommon, isTherapist } from "../middlewares/authMiddleware.js";
import {
  therapistWorksheets, createWorksheetLink, therapistEntry, reviewEntry, startSelf,
  publicLink, linkBookClick,
  startFromLink, myWorksheets, myWorksheet, saveMyWorksheet, deleteMyWorksheet,
} from "../controllers/WorksheetController.js";

// Therapist Toolkit worksheets (controllers/WorksheetController.js)
const router = express.Router();
router.get("/therapist/worksheets", isTherapist, therapistWorksheets);
router.post("/therapist/worksheets/link", isTherapist, createWorksheetLink);
router.post("/therapist/worksheets/self", isTherapist, startSelf);
router.get("/therapist/worksheets/entries/:id", isTherapist, therapistEntry);
router.put("/therapist/worksheets/entries/:id/review", isTherapist, reviewEntry);

router.get("/worksheet-link/:code", publicLink);
router.post("/worksheet-link/:code/book", linkBookClick);

router.post("/my-worksheets/start", isAuthCommon, startFromLink);
router.get("/my-worksheets", isAuthCommon, myWorksheets);
router.get("/my-worksheets/:id", isAuthCommon, myWorksheet);
router.put("/my-worksheets/:id", isAuthCommon, saveMyWorksheet);
router.delete("/my-worksheets/:id", isAuthCommon, deleteMyWorksheet);
export default router;
