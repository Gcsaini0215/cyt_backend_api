import { Router } from "express";
import { sendCertificateEmail } from "../controllers/CertificateController.js";
import { isAdmin } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/certificate/send-email", isAdmin, sendCertificateEmail);

export default router;
