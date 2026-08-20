import { Router } from "express";
import { sendCertificateEmail } from "../controllers/CertificateController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/certificate/send-email", hasPermission("certificates"), sendCertificateEmail);

export default router;
