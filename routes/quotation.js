import { Router } from "express";
import {
  createQuotation,
  getQuotations,
  getQuotation,
  updateQuotation,
  setQuotationStatus,
  deleteQuotation,
  uploadPdfMiddleware,
  saveQuotationPdf,
  downloadQuotationPdf,
} from "../controllers/QuotationController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = Router();
const can = hasPermission("quotations");

router.get("/quotations", can, getQuotations);
router.post("/quotations", can, createQuotation);
router.get("/quotations/:id", can, getQuotation);
router.put("/quotations/:id", can, updateQuotation);
router.patch("/quotations/:id/status", can, setQuotationStatus);
router.delete("/quotations/:id", can, deleteQuotation);
router.post("/quotations/:id/pdf", can, uploadPdfMiddleware, saveQuotationPdf);
router.get("/quotations/:id/pdf", can, downloadQuotationPdf);

export default router;
