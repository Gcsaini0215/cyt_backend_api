// Private documents (therapist ID cards, certificates, CVs; trainee resumes / college IDs) live in
// uploads/documents. Until 2026-11-15 they were served to anyone who knew the file name. Now:
//   - an admin panel session calls POST /api/admin/doc-access (admin JWT + therapists/probono
//     permission) and gets a short-lived, HttpOnly cookie for api.chooseyourtherapist.in;
//   - GET /uploads/documents/<file> is served only with that cookie, or when the file is a
//     trainee's passport photo (those are shown as the trainee's profile picture);
//   - everything else gets a plain 404, so outsiders can't even tell whether a file exists.
import crypto from "crypto";
import path from "path";
import Trainee from "../models/Trainee.js";

const COOKIE = "cyt_doc";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours; the admin panel refreshes it on load and every few hours

const secret = () => `${process.env.JWT_SECRET || ""}|documents`;
const sign = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

export const makeDocToken = (adminId) => {
  const payload = `${adminId}.${Date.now() + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
};

export const validDocToken = (token) => {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return false;
  const [id, exp, sig] = parts;
  if (!id || !(Number(exp) > Date.now())) return false;
  const want = Buffer.from(sign(`${id}.${exp}`));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};

const readCookie = (req, name) => {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
};

// POST /api/admin/doc-access — route adds hasPermission(...) in front of this
export const grantDocAccess = (req, res) => {
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  res.cookie(COOKIE, makeDocToken(String(req.user?._id || "admin")), {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/uploads/documents",
    maxAge: TTL_MS,
  });
  res.json({ status: true, expiresInMs: TTL_MS });
};

// app.use("/uploads", guardDocuments) — must run before express.static("/uploads").
// Mounted on all of /uploads and decided on the decoded, normalised path, so tricks like
// /uploads/images/../documents/x or /uploads/%64ocuments/x can't slip past it.
export const guardDocuments = async (req, res, next) => {
  let rel;
  try {
    rel = path.posix.normalize("/" + decodeURIComponent(req.path || "").split("\\").join("/"));
  } catch (e) {
    return res.status(404).end(); // malformed %-encoding
  }
  if (!/^\/documents(\/|$)/i.test(rel)) return next(); // images, resumes, resources… unchanged
  try {
    if (req.method !== "GET" && req.method !== "HEAD") return res.status(404).end();
    res.setHeader("Cache-Control", "private, no-cache"); // never kept by shared caches
    if (validDocToken(readCookie(req, COOKIE))) return next();
    const name = path.posix.basename(rel);
    if (name && (await Trainee.exists({ passportPhoto: name }))) return next();
  } catch (e) {
    // fall through to 404
  }
  res.setHeader("Cache-Control", "no-store");
  return res.status(404).end();
};
