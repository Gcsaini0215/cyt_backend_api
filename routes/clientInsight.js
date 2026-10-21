import express from "express";
import { listClients, clientDetail } from "../controllers/ClientInsightController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.get("/admin/client-360", hasPermission("clients"), listClients);
router.get("/admin/client-360/:id", hasPermission("clients"), clientDetail);
export default router;
