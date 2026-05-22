import { Router } from "express";
import { isSuperAdmin } from "../middlewares/authMiddleware.js";
import { listRoles, createRole, updateRole, deleteRole } from "../controllers/RoleController.js";

const router = Router();

router.get("/roles", isSuperAdmin, listRoles);
router.post("/roles", isSuperAdmin, createRole);
router.put("/roles/:id", isSuperAdmin, updateRole);
router.delete("/roles/:id", isSuperAdmin, deleteRole);

export default router;
