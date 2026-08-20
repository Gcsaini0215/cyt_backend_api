import express from "express";
import { getResources, getAllResources, uploadResourceMeta, deleteResource, toggleResource } from "../controllers/resourceController.js";
import { isTherapist, hasPermission } from "../middlewares/authMiddleware.js";
import { uploadResource } from "../services/fileUpload.js";

const router = express.Router();

router.get("/resources",              isTherapist, getResources);
router.get("/resources/all",          hasPermission("resources"), getAllResources);
router.post("/resources",             hasPermission("resources"), uploadResource.single("pdf"), uploadResourceMeta);
router.delete("/resources/:id",       hasPermission("resources"), deleteResource);
router.patch("/resources/:id/toggle", hasPermission("resources"), toggleResource);

export default router;
