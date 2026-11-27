// API key for the public /api/public/* endpoints (therapist list for other websites).
// Keys live in the env: PUBLIC_API_KEYS=key1,key2 (comma-separated, so a partner's key can be
// replaced without breaking the others). The caller sends it as the header  x-api-key: <key>.
// No keys set = the public API is switched off (503), never open to everyone.
import crypto from "crypto";

const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();

const configuredKeys = () =>
  String(process.env.PUBLIC_API_KEYS || "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length >= 16); // ignore short/placeholder values

export const requirePublicApiKey = (req, res, next) => {
  const keys = configuredKeys();
  if (!keys.length) {
    return res.status(503).json({ status: false, message: "Public API is not enabled." });
  }
  const sent = String(req.get("x-api-key") || "").trim();
  if (!sent) {
    return res.status(401).json({ status: false, message: "Missing x-api-key header." });
  }
  // constant-time compare on fixed-length hashes, so key length/prefix can't be guessed by timing
  const sentHash = digest(sent);
  const ok = keys.some((k) => crypto.timingSafeEqual(digest(k), sentHash));
  if (!ok) {
    return res.status(401).json({ status: false, message: "Invalid API key." });
  }
  return next();
};
