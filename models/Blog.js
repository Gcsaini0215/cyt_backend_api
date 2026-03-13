import mongoose from "mongoose";

const { model, Schema } = mongoose;

const BlogSchema = new Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    category: { type: String, default: "Uncategorized" },
    author: { type: String, default: "Admin" },
    image: { type: String, default: null }, // Featured Image URL
    metaDesc: { type: String, default: "" },
    tags: { type: String, default: "" },
    slug: { type: String, unique: true, required: true }
  },
  { timestamps: true }
);

export default model("Blog", BlogSchema);
