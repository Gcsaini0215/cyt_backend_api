import Blog from "../models/Blog.js";

// Create a new Blog
export const createBlog = async (req, res) => {
  try {
    const { title, content, category, author, image, metaDesc, tags } = req.body;
    const slug = title.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '') + '-' + Date.now();
    const newBlog = await Blog.create({
      title, content, category, author, image, metaDesc, tags, slug
    });
    res.status(201).json({ status: true, message: "Blog created successfully", data: newBlog });
  } catch (error) {
    res.status(500).json({ status: false, message: error.message });
  }
};

// Get All Blogs
export const getAllBlogs = async (req, res) => {
  try {
    const blogs = await Blog.find().sort({ createdAt: -1 });
    res.status(200).json({ status: true, data: blogs });
  } catch (error) {
    res.status(500).json({ status: false, message: error.message });
  }
};

// Update Blog
export const updateBlog = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedBlog = await Blog.findByIdAndUpdate(id, req.body, { new: true });
    res.status(200).json({ status: true, message: "Blog updated successfully", data: updatedBlog });
  } catch (error) {
    res.status(500).json({ status: false, message: error.message });
  }
};

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
