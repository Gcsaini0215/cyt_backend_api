import { Router } from "express";
import {
  createOfferLetter,
  getOfferLetters,
  getOfferLetter,
  updateOfferLetter,
  setOfferLetterStatus,
  deleteOfferLetter,
  uploadLetterPdfMiddleware,
  saveOfferLetterPdf,
  downloadOfferLetterPdf,
  sendOfferLetter,
} from "../controllers/OfferLetterController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = Router();
const can = hasPermission("offerLetters");

router.get("/offer-letters", can, getOfferLetters);
router.post("/offer-letters", can, createOfferLetter);
router.get("/offer-letters/:id", can, getOfferLetter);
router.put("/offer-letters/:id", can, updateOfferLetter);
router.patch("/offer-letters/:id/status", can, setOfferLetterStatus);
router.delete("/offer-letters/:id", can, deleteOfferLetter);
router.post("/offer-letters/:id/pdf", can, uploadLetterPdfMiddleware, saveOfferLetterPdf);
router.get("/offer-letters/:id/pdf", can, downloadOfferLetterPdf);
router.post("/offer-letters/:id/send", can, sendOfferLetter);

export default router;
