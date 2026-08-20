import { Router } from "express";
import { getIntakeClients, createIntakeClient, updateIntakeClient, deleteIntakeClient } from "../controllers/IntakeController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = Router();

router.get("/intake-clients",     hasPermission("clients"), getIntakeClients);
router.post("/intake-clients",    hasPermission("clients"), createIntakeClient);
router.put("/intake-clients/:id", hasPermission("clients"), updateIntakeClient);
router.delete("/intake-clients/:id", hasPermission("clients"), deleteIntakeClient);

export default router;
