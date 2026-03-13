import express from "express";
import { createBlog, getAllBlogs, updateBlog, deleteBlog, getBlogBySlug, getBlogById } from "../controllers/blogController.js";

const router = express.Router();

router.post("/create-blog", createBlog);
router.get("/get-blogs", getAllBlogs);
router.get("/get-blog/:slug", getBlogBySlug);
router.get("/get-blog-by-id/:id", getBlogById);
router.put("/update-blog/:id", updateBlog);
router.delete("/delete-blog/:id", deleteBlog);

export default router;
