import { Router } from "express";
import {
  getOpenJobs, applyForJob,
  adminListJobs, adminCreateJob, adminUpdateJob, adminDeleteJob,
  adminListApplications, adminUpdateApplication, adminDeleteApplication, adminGetResume,
} from "../controllers/CareerController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";
import { careerApplyRateLimit } from "../middlewares/rateLimitMiddleware.js";
import { uploadTherapistDocuments } from "../services/fileUpload.js";

const router = Router();

// a wrong file type / too-big resume is the applicant's mistake → 400 with a clear message
const resumeUpload = (req, res, next) => uploadTherapistDocuments.single("resume")(req, res, (err) => {
  if (!err) return next();
  res.status(400);
  next(new Error(err.code === "LIMIT_FILE_SIZE" ? "Your resume is over 5 MB. Please attach a smaller file." : "Please attach your resume as a PDF or Word file."));
});

// public: /careers page
router.get("/careers/jobs", getOpenJobs);
router.post("/careers/apply", careerApplyRateLimit, resumeUpload, applyForJob);

// admin: Settings → Careers (permission "careers"; the super admin always has it)
router.get("/admin/careers/jobs", hasPermission("careers"), adminListJobs);
router.post("/admin/careers/jobs", hasPermission("careers"), adminCreateJob);
router.patch("/admin/careers/jobs/:id", hasPermission("careers"), adminUpdateJob);
router.delete("/admin/careers/jobs/:id", hasPermission("careers"), adminDeleteJob);
router.get("/admin/careers/applications", hasPermission("careers"), adminListApplications);
router.patch("/admin/careers/applications/:id", hasPermission("careers"), adminUpdateApplication);
router.delete("/admin/careers/applications/:id", hasPermission("careers"), adminDeleteApplication);
router.get("/admin/careers/applications/:id/resume", hasPermission("careers"), adminGetResume);

export default router;
