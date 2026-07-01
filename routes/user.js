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
} from "../controllers/userController.js";
import { isAdmin, isAuth, isAuthCommon } from "../middlewares/authMiddleware.js";
import { upload } from "../services/fileUpload.js";

const router = Router();

router.get("/profile", isAuth, getProfile);
router.get("/get-user", isAuthCommon, getUser);

router.post("/update-user", isAuth, upload.single("file"), updateUser);

router.get("/get-all-users",isAdmin,getAllUserForAdmin)
router.get("/get-chat-users",isAdmin,getChatUsersWithLeads)
router.post("/send-bulk-user-mail",isAdmin,sendBulkUserMail)
router.get("/email-logs",isAdmin,getEmailLogs)
router.post("/contact-meta",isAdmin,updateContactMeta)

export default router;
