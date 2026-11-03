import { Router } from "express";
import {
  sendCertificateEmail, listCertificates, getCertificate, issueCertificate, updateCertificate, importCertificates, verifyCertificate,
} from "../controllers/CertificateController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = Router();

router.post("/certificate/send-email", hasPermission("certificates"), sendCertificateEmail);

// issued certificates (admin /certificates); verify is public, opened by the QR on the certificate
router.get("/admin/certificates", hasPermission("certificates"), listCertificates);
router.post("/admin/certificates", hasPermission("certificates"), issueCertificate);
router.post("/admin/certificates/import", hasPermission("certificates"), importCertificates);
router.get("/admin/certificates/:id", hasPermission("certificates"), getCertificate);
router.patch("/admin/certificates/:id", hasPermission("certificates"), updateCertificate);
router.get("/certificates/verify/:code", verifyCertificate);

export default router;
