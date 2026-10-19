import { Router } from "express";
import { outreachPresets, outreachPreview, outreachSend, outreachHistory, outreachDelete } from "../controllers/OutreachEmailController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

// Admin → Outreach Email (permission "outreach"; the Super Admin always has it)
const router = Router();
const can = hasPermission("outreach");

router.get("/outreach/presets", can, outreachPresets);
router.post("/outreach/preview", can, outreachPreview);
router.post("/outreach/send", can, outreachSend);
router.get("/outreach/history", can, outreachHistory);
router.delete("/outreach/:id", can, outreachDelete);

export default router;
