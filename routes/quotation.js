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
import { sendQuotation, downloadSharedQuotation } from "../controllers/QuotationEmailController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";
import { leadRateLimit } from "../middlewares/rateLimitMiddleware.js";

const router = Router();
const can = hasPermission("quotations");

// The link inside the email — public by design (the token is the secret), so it is rate limited.
router.get("/quotations/download/:token/:name", leadRateLimit, downloadSharedQuotation);

router.get("/quotations", can, getQuotations);
router.post("/quotations", can, createQuotation);
router.get("/quotations/:id", can, getQuotation);
router.put("/quotations/:id", can, updateQuotation);
router.patch("/quotations/:id/status", can, setQuotationStatus);
router.delete("/quotations/:id", can, deleteQuotation);
router.post("/quotations/:id/pdf", can, uploadPdfMiddleware, saveQuotationPdf);
router.get("/quotations/:id/pdf", can, downloadQuotationPdf);
router.post("/quotations/:id/send", can, sendQuotation);

export default router;
