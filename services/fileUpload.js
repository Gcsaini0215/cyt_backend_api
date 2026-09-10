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

const MB = 1024 * 1024;

// Strip any path, keep only safe chars, cap length. Never trust file.originalname.
const safeName = (original) => {
  const base = path.basename(String(original || "file"));
  const ext = path.extname(base).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 10);
  const name = path.basename(base, path.extname(base))
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 60) || "file";
  return `${name}${ext}`;
};

const storedName = (file) => `${uuidv4()}_${safeName(file.originalname)}`;

// Accept only when BOTH the extension and the reported mimetype are allowed.
// (mimetype alone is client-controlled and trivially spoofed.)
const checkFile = (exts, mimes) => (req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (exts.includes(ext) && mimes.includes(file.mimetype)) return cb(null, true);
  cb(new Error(`Only ${exts.join(", ")} files are allowed.`), false);
};

const IMAGE_EXT  = [".jpg", ".jpeg", ".png"];
const IMAGE_MIME = ["image/jpeg", "image/jpg", "image/png"];
const PDF_EXT    = [".pdf"];
const PDF_MIME   = ["application/pdf"];
const DOC_EXT    = [".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx"];
const DOC_MIME   = [
  "application/pdf",
  "image/jpeg", "image/jpg", "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const diskStore = (dir) => multer.diskStorage({
  destination: (req, file, cb) => cb(null, dir),
  filename:    (req, file, cb) => cb(null, storedName(file)),
});

// Exported single image upload (5 MB)
export const upload = multer({
  storage: diskStore(imagesPath),
  fileFilter: checkFile(IMAGE_EXT, IMAGE_MIME),
  limits: { fileSize: 5 * MB },
});

// Exported single PDF upload — resumes (10 MB)
export const uploadFile = multer({
  storage: diskStore(resumesPath),
  fileFilter: checkFile(PDF_EXT, PDF_MIME),
  limits: { fileSize: 10 * MB },
});

// Exported resource PDF upload (20 MB)
export const uploadResource = multer({
  storage: diskStore(resourcesPath),
  fileFilter: checkFile(PDF_EXT, PDF_MIME),
  limits: { fileSize: 20 * MB },
});

// Exported multi-upload — images + PDFs (10 MB)
export const multiUpload = multer({
  storage: diskStore(imagesPath),
  fileFilter: checkFile([...IMAGE_EXT, ...PDF_EXT], [...IMAGE_MIME, ...PDF_MIME]),
  limits: { fileSize: 10 * MB },
});

// Exported multi-field document upload — resume / certificate / ID (5 MB per file)
export const uploadTherapistDocuments = multer({
  storage: diskStore(documentsPath),
  fileFilter: checkFile(DOC_EXT, DOC_MIME),
  limits: { fileSize: 5 * MB },
});

// Delete uploaded file
export const deleteFile = (filePath) => {
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error(`Failed to delete file: ${filePath}`, err);
    }
  });
};
