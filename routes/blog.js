import express from "express";
import { createBlog, getAllBlogs, updateBlog, deleteBlog, getBlogBySlug, getBlogById } from "../controllers/blogController.js";
import { hasPermission } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/create-blog", hasPermission("blogs"), createBlog);
router.get("/get-blogs", getAllBlogs);
router.get("/get-blog/:slug", getBlogBySlug);
router.get("/get-blog-by-id/:id", getBlogById);
router.put("/update-blog/:id", hasPermission("blogs"), updateBlog);
router.delete("/delete-blog/:id", hasPermission("blogs"), deleteBlog);

export default router;
