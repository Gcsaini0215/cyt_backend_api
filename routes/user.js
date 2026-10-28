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
import { rebookUnsubToken } from "../services/rebookNudge.js";
import Users from "../models/Users.js";

const router = Router();

router.get("/profile", isAuth, getProfile);
router.get("/get-user", isAuthCommon, getUser);
router.get("/my-referral", isAuth, getMyReferral);
router.get("/my-reviewed-therapists", isAuth, getMyReviewedTherapists);

// the "Stop these reminders" link in the book-your-next-session email (services/rebookNudge.js)
router.get("/rebook-nudge/unsubscribe", async (req, res) => {
  const id = String(req.query.id || "");
  const t = String(req.query.t || "");
  const page = (msg) => `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial,sans-serif;background:#f4f6f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="background:#fff;border-radius:14px;padding:28px 26px;max-width:420px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.08)"><h2 style="color:#0f3d24;margin:0 0 8px">Choose Your Therapist</h2><p style="color:#475569;line-height:1.6">${msg}</p><a href="https://www.chooseyourtherapist.in/my-dashboard" style="color:#166534;font-weight:700">Open My Space</a></div></body>`;
  if (!/^[a-f0-9]{24}$/.test(id) || t !== rebookUnsubToken(id)) return res.status(400).send(page("This link is not valid."));
  await Users.updateOne({ _id: id }, { rebook_nudge_off: true });
  res.send(page("Done — you won't get book-your-next-session reminders any more."));
});

router.post("/update-user", isAuth, upload.single("file"), updateUser);

router.get("/get-all-users",hasPermission("clients"),getAllUserForAdmin)
router.get("/get-chat-users",hasPermission("clients"),getChatUsersWithLeads)
router.post("/send-bulk-user-mail",hasPermission("clients"),sendBulkUserMail)
router.get("/email-logs",hasPermission("clients"),getEmailLogs)
router.post("/contact-meta",hasPermission("clients"),updateContactMeta)

export default router;
