import express from "express";
import { createBlog, getAllBlogs, updateBlog, deleteBlog, getBlogBySlug, getBlogById } from "../controllers/blogController.js";
import { isAdmin } from "../middlewares/authMiddleware.js";

const router = express.Router();

router.post("/create-blog", isAdmin, createBlog);
router.get("/get-blogs", getAllBlogs);
router.get("/get-blog/:slug", getBlogBySlug);
router.get("/get-blog-by-id/:id", getBlogById);
router.put("/update-blog/:id", isAdmin, updateBlog);
router.delete("/delete-blog/:id", isAdmin, deleteBlog);

export default router;
