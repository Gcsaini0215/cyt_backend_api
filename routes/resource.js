import express from "express";
import { getResources, getAllResources, uploadResourceMeta, deleteResource, toggleResource } from "../controllers/resourceController.js";
import { isAdmin, isTherapist } from "../middlewares/authMiddleware.js";
import { uploadResource } from "../services/fileUpload.js";

const router = express.Router();

router.get("/resources",              isTherapist, getResources);
router.get("/resources/all",          isAdmin,     getAllResources);
router.post("/resources",             isAdmin,     uploadResource.single("pdf"), uploadResourceMeta);
router.delete("/resources/:id",       isAdmin,     deleteResource);
router.patch("/resources/:id/toggle", isAdmin,     toggleResource);

export default router;
