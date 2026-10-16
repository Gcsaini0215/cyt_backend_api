import { Router } from "express";
import {
  getAllUserForAdmin,
  getChatUsersWithLeads,
  getProfile,
  getUser,
  updateUser,
  sendBulkUserMail,
  getEmailLogs,
  updateContactMeta,
  getMyReferral,
  getMyReviewedTherapists,
} from "../controllers/userController.js";
import { isAuth, isAuthCommon, hasPermission } from "../middlewares/authMiddleware.js";
import { upload } from "../services/fileUpload.js";

const router = Router();

router.get("/profile", isAuth, getProfile);
router.get("/get-user", isAuthCommon, getUser);
router.get("/my-referral", isAuth, getMyReferral);
router.get("/my-reviewed-therapists", isAuth, getMyReviewedTherapists);

router.post("/update-user", isAuth, upload.single("file"), updateUser);

router.get("/get-all-users",hasPermission("clients"),getAllUserForAdmin)
router.get("/get-chat-users",hasPermission("clients"),getChatUsersWithLeads)
router.post("/send-bulk-user-mail",hasPermission("clients"),sendBulkUserMail)
router.get("/email-logs",hasPermission("clients"),getEmailLogs)
router.post("/contact-meta",hasPermission("clients"),updateContactMeta)

export default router;
