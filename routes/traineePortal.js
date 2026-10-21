import express from "express";
import {
  traineeAuth, myNotifications, readMyNotifications, traineeStream, myOverview, myAttendance, traineeCheckIn, traineeCheckOut, myTasks, updateMyTask, myNotes, myCertificates,
  myProfile, saveMyProfile, upgradeInfo, upgradeOrder, upgradeVerify,
  adminPeople, adminAttendance, adminFixAttendance, adminSetAttendance, adminDeleteAttendance, adminTasks, adminCreateTask, adminUpdateTask, adminDeleteTask,
  adminGrantPlan, adminGrants, adminRemoveGrant, publicTracks, adminTracks, adminSaveTracks, adminNotes, adminCreateNote, adminDeleteNote, adminCertificates, adminSendCertificate, adminDeleteCertificate,
} from "../controllers/traineePortalController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";
import { upload, uploadResource, uploadTraineeMaterial } from "../services/fileUpload.js";

const router = express.Router();

// a bad / too-big file answers with a message instead of a 500
const one = (mw, field) => (req, res, next) => mw.single(field)(req, res, (err) => (err
  ? res.status(400).json({ status: false, message: err.code === "LIMIT_FILE_SIZE" ? "That file is too big." : err.message })
  : next()));

// trainee portal (trainee token)
router.get("/trainee-portal/stream", traineeStream); // SSE, token in ?token=
router.get("/trainee-portal/tracks", publicTracks); // public: tracks open for applications
router.get("/trainee-portal/notifications", traineeAuth, myNotifications);
router.post("/trainee-portal/notifications/read", traineeAuth, readMyNotifications);
router.get("/trainee-portal/overview", traineeAuth, myOverview);
router.get("/trainee-portal/attendance", traineeAuth, myAttendance);
router.post("/trainee-portal/attendance/check-in", traineeAuth, traineeCheckIn);
router.post("/trainee-portal/attendance/check-out", traineeAuth, traineeCheckOut);
router.get("/trainee-portal/tasks", traineeAuth, myTasks);
router.patch("/trainee-portal/tasks/:id", traineeAuth, updateMyTask);
router.get("/trainee-portal/notes", traineeAuth, myNotes);
router.get("/trainee-portal/certificates", traineeAuth, myCertificates);
router.get("/trainee-portal/profile", traineeAuth, myProfile);
router.put("/trainee-portal/profile", traineeAuth, one(upload, "photo"), saveMyProfile);
router.get("/trainee-portal/upgrade", traineeAuth, upgradeInfo);
router.post("/trainee-portal/upgrade/order", traineeAuth, upgradeOrder);
router.post("/trainee-portal/upgrade/verify", traineeAuth, upgradeVerify);

// admin
const adm = hasPermission("probono");
router.get("/admin/trainee-portal/people", adm, adminPeople);
router.get("/admin/trainee-portal/attendance", adm, adminAttendance);
router.patch("/admin/trainee-portal/attendance/:id", adm, adminFixAttendance);
router.post("/admin/trainee-portal/attendance", adm, adminSetAttendance);
router.delete("/admin/trainee-portal/attendance/:id", adm, adminDeleteAttendance);
router.get("/admin/trainee-portal/tasks", adm, adminTasks);
router.post("/admin/trainee-portal/tasks", adm, adminCreateTask);
router.patch("/admin/trainee-portal/tasks/:id", adm, adminUpdateTask);
router.delete("/admin/trainee-portal/tasks/:id", adm, adminDeleteTask);
router.post("/admin/trainee-portal/grant", adm, adminGrantPlan);
router.get("/admin/trainee-portal/grants", adm, adminGrants);
router.get("/admin/trainee-portal/tracks", adm, adminTracks);
router.put("/admin/trainee-portal/tracks", adm, adminSaveTracks);
router.post("/admin/trainee-portal/grants/remove", adm, adminRemoveGrant);
router.get("/admin/trainee-portal/notes", adm, adminNotes);
router.post("/admin/trainee-portal/notes", adm, one(uploadTraineeMaterial, "file"), adminCreateNote);
router.delete("/admin/trainee-portal/notes/:id", adm, adminDeleteNote);
router.get("/admin/trainee-portal/certificates", adm, adminCertificates);
router.post("/admin/trainee-portal/certificates", adm, one(uploadResource, "file"), adminSendCertificate);
router.delete("/admin/trainee-portal/certificates/:id", adm, adminDeleteCertificate);

export default router;
