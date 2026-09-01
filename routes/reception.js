import { Router } from "express";
import {
  getReceptionClients, createReceptionClient, upsertReceptionClient,
  deleteReceptionClient, getPlanPrices, savePlanPrices,
} from "../controllers/ReceptionController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = Router();

router.get("/reception-clients",        hasPermission("clients"), getReceptionClients);
router.post("/reception-clients",       hasPermission("clients"), createReceptionClient);
router.put("/reception-clients/:id",    hasPermission("clients"), upsertReceptionClient);
router.delete("/reception-clients/:id", hasPermission("clients"), deleteReceptionClient);

router.get("/reception-plan-prices",    hasPermission("clients"), getPlanPrices);
router.put("/reception-plan-prices",    hasPermission("clients"), savePlanPrices);

export default router;
