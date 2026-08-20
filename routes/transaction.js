import { Router } from "express";
import { hasPermission } from "../middlewares/authMiddleware.js";
import { UpdatePaymentStatus } from "../controllers/TransactionController.js";

const router = Router();

router.post("/update-payment-status",hasPermission("bookings"),UpdatePaymentStatus);

export default router;
