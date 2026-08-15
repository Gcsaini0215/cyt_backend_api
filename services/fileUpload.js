import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
// Always resolve relative to this file's location (../  = project root)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const appRoot    = path.resolve(__dirname, "..");

// Define upload paths
const imagesPath    = path.join(appRoot, "uploads/images");
const resumesPath   = path.join(appRoot, "uploads/resumes");
const resourcesPath = path.join(appRoot, "uploads/resources");
const documentsPath = path.join(appRoot, "uploads/documents");

// Ensure folders exist
if (!fs.existsSync(imagesPath))    fs.mkdirSync(imagesPath,    { recursive: true });
if (!fs.existsSync(resumesPath))   fs.mkdirSync(resumesPath,   { recursive: true });
if (!fs.existsSync(resourcesPath)) fs.mkdirSync(resourcesPath, { recursive: true });
if (!fs.existsSync(documentsPath)) fs.mkdirSync(documentsPath, { recursive: true });

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

// Storage for therapist verification documents (resume, qualification
// certificate, ID card) — accepts PDF, DOC/DOCX, or scanned images
const storageDocuments = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, documentsPath); },
  filename:    (req, file, cb) => { cb(null, `${uuidv4()}_${file.originalname}`); },
});

const fileFilterDocuments = (req, file, cb) => {
  const allowedTypes = [
    "application/pdf",
    "image/jpeg", "image/jpg", "image/png",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  if (!allowedTypes.includes(file.mimetype)) {
    return cb(new Error("Only PDF, DOC, DOCX, JPG or PNG files are allowed!"), false);
  }
  cb(null, true);
};

// Exported multi-field document upload (5 MB per file)
export const uploadTherapistDocuments = multer({
  storage: storageDocuments,
  fileFilter: fileFilterDocuments,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Delete uploaded file
export const deleteFile = (filePath) => {
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error(`Failed to delete file: ${filePath}`, err);
    }
  });
};
