import { Router } from "express";
import { getIntakeClients, createIntakeClient, updateIntakeClient, deleteIntakeClient } from "../controllers/IntakeController.js";
import { isAdmin } from "../middlewares/authMiddleware.js";

const router = Router();

router.get("/intake-clients",     isAdmin, getIntakeClients);
router.post("/intake-clients",    isAdmin, createIntakeClient);
router.put("/intake-clients/:id", isAdmin, updateIntakeClient);
router.delete("/intake-clients/:id", isAdmin, deleteIntakeClient);

export default router;
