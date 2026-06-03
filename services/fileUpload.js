import multer from "multer";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
// Get root directory
const appRoot = path.resolve(); // If not globally defined, define it here

// Define upload paths
const imagesPath    = path.join(appRoot, "uploads/images");
const resumesPath   = path.join(appRoot, "uploads/resumes");
const resourcesPath = path.join(appRoot, "uploads/resources");

// Ensure folders exist
if (!fs.existsSync(imagesPath))    fs.mkdirSync(imagesPath,    { recursive: true });
if (!fs.existsSync(resumesPath))   fs.mkdirSync(resumesPath,   { recursive: true });
if (!fs.existsSync(resourcesPath)) fs.mkdirSync(resourcesPath, { recursive: true });

// Storage for image files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, imagesPath);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}_${file.originalname}`);
  },
});

// Storage for PDF files
const storageFile = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, resumesPath);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}_${file.originalname}`);
  },
});

// Image filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/jpg", "image/png"];
  if (!allowedTypes.includes(file.mimetype)) {
    return cb(new Error("Only image files are allowed!"), false);
  }
  cb(null, true);
};

// PDF filter
const fileFilterPdf = (req, file, cb) => {
  const allowedTypes = ["application/pdf"];
  if (!allowedTypes.includes(file.mimetype)) {
    return cb(new Error("Only PDF files are allowed!"), false);
  }
  cb(null, true);
};

// Exported single image upload
export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
});

// Exported single PDF upload (resumes)
export const uploadFile = multer({
  storage: storageFile,
  fileFilter: fileFilterPdf,
});

// Storage for resource PDFs
const storageResource = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, resourcesPath); },
  filename:    (req, file, cb) => { cb(null, `${uuidv4()}_${file.originalname}`); },
});

// Exported resource PDF upload (20 MB limit)
export const uploadResource = multer({
  storage: storageResource,
  fileFilter: fileFilterPdf,
  limits: { fileSize: 20 * 1024 * 1024 },
});

// Exported multi-upload (images + PDFs)
export const multiUpload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|pdf/;
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = filetypes.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error("Only images and PDFs are allowed!"), false);
    }
  },
});

// Delete uploaded file
export const deleteFile = (filePath) => {
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error(`Failed to delete file: ${filePath}`, err);
    }
  });
};
