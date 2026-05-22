import { Router } from "express";
import { isSuperAdmin } from "../middlewares/authMiddleware.js";
import { listAdmins, createAdmin, updateAdminRole, deleteAdmin } from "../controllers/AdminController.js";

const router = Router();

router.get("/team", isSuperAdmin, listAdmins);
router.post("/team", isSuperAdmin, createAdmin);
router.put("/team/:id/role", isSuperAdmin, updateAdminRole);
router.delete("/team/:id", isSuperAdmin, deleteAdmin);

export default router;
