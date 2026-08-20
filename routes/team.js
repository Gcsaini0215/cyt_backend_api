import { Router } from "express";
import { isSuperAdmin, isAdmin } from "../middlewares/authMiddleware.js";
import { listAdmins, createAdmin, updateAdminRole, deleteAdmin, getMyPermissions } from "../controllers/AdminController.js";

const router = Router();

router.get("/team", isSuperAdmin, listAdmins);
router.post("/team", isSuperAdmin, createAdmin);
router.put("/team/:id/role", isSuperAdmin, updateAdminRole);
router.delete("/team/:id", isSuperAdmin, deleteAdmin);

/* Any logged-in admin (super or role-restricted) can read their own permissions */
router.get("/my-permissions", isAdmin, getMyPermissions);

export default router;
