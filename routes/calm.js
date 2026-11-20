import express from "express";
import { calmStatus, createCalmOrder, verifyCalmPayment } from "../controllers/CalmPassController.js";
import { isAuth } from "../middlewares/authMiddleware.js";

// Calm corner pass (controllers/CalmPassController.js)
const router = express.Router();
router.get("/calm/status", isAuth, calmStatus);
router.post("/calm/order", isAuth, createCalmOrder);
router.post("/calm/verify", isAuth, verifyCalmPayment);
export default router;
