import Blog from "../models/Blog.js";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import expressAsyncHandler from "express-async-handler";

const logAccess = (message) => {
  const logMessage = `[${new Date().toISOString()}] ACCESS: ${message}\n`;
  try {
    fs.appendFileSync(path.join(global.appRoot, "api_access.log"), logMessage);
  } catch (e) {
    console.error("Failed to write to api_access.log", e);
  }
};

const logError = (error) => {
  const logMessage = `[${new Date().toISOString()}] ERROR: ${error.stack || error.message}\n`;
  try {
    fs.appendFileSync(path.join(global.appRoot, "debug.log"), logMessage);
  } catch (e) {
    console.error("Failed to write to debug.log", e);
  }
};

// Create a new Blog
export const createBlog = expressAsyncHandler(async (req, res) => {
  const { title, content, category, author, image, metaDesc, tags } = req.body;
  logAccess("Creating blog: " + title);
  const slug = title.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '') + '-' + Date.now();
  const newBlog = await Blog.create({
    title, content, category, author, image, metaDesc, tags, slug
  });
  res.status(201).json({ status: true, message: "Blog created successfully", data: newBlog });
});

// Get All Blogs
export const getAllBlogs = expressAsyncHandler(async (req, res) => {
  const blogs = await Blog.find().sort({ createdAt: -1 });
  res.status(200).json({ status: true, data: blogs });
});

// Update Blog
export const updateBlog = expressAsyncHandler(async (req, res) => {
  const { id } = req.params;
  logAccess("Updating blog with ID: " + id);
  const updatedBlog = await Blog.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
  if (!updatedBlog) {
    logAccess("Blog not found for update: " + id);
    res.status(404);
    throw new Error("Blog not found");
  }
  logAccess("Blog updated successfully: " + id);
  res.status(200).json({ status: true, message: "Blog updated successfully", data: updatedBlog });
});

// Get Single Blog by Slug
export const getBlogBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const blog = await Blog.findOne({ slug });
    if (!blog) return res.status(404).json({ status: false, message: "Blog not found" });
    res.status(200).json({ status: true, data: blog });
  } catch (error) {
    res.status(500).json({ status: false, message: error.message });
  }
};

// Get Single Blog by ID
export const getBlogById = async (req, res) => {
  try {
    const { id } = req.params;
    const blog = await Blog.findById(id);
    if (!blog) return res.status(404).json({ status: false, message: "Blog not found" });
    res.status(200).json({ status: true, data: blog });
  } catch (error) {
    res.status(500).json({ status: false, message: error.message });
  }
};

// Delete Blog
export const deleteBlog = async (req, res) => {
  try {
    const { id } = req.params;
    await Blog.findByIdAndDelete(id);
    res.status(200).json({ status: true, message: "Blog deleted successfully" });
  } catch (error) {
    res.status(500).json({ status: false, message: error.message });
  }
};
