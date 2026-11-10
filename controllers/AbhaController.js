// "My ABHA" for clients (ABDM milestone M1): create an ABHA with Aadhaar OTP, or link the ABHA they
// already have (ABHA number + OTP), then keep it on their CYT account.
//
// Until ABDM_CLIENT_ID / ABDM_CLIENT_SECRET are set, every call answers { configured: false } so the
// site can show "coming soon" instead of failing. Aadhaar numbers and OTPs are only passed through
// (RSA-encrypted for ABDM) — never stored or logged.
import expressAsyncHandler from "express-async-handler";
import AbhaLink from "../models/AbhaLink.js";
import { abdmConfig, abdmConfigured } from "../services/abdm/config.js";
import * as abdm from "../services/abdm/client.js";

// one OTP flow in progress per client (single backend process — fine to keep in memory)
const pending = new Map(); // userId -> { flow, txnId, until, tries }
const sends = new Map(); // userId -> [timestamps] of OTP requests (max 3 in 10 min)
const TXN_MS = 10 * 60 * 1000;

const digits = (v) => String(v || "").replace(/\D/g, "");
const fmtAbha = (n) => { const d = digits(n); return d.length === 14 ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10)}` : d; };
const maskAbha = (n) => { const d = digits(n); return d.length === 14 ? `${d.slice(0, 2)}-XXXX-XXXX-${d.slice(10)}` : ""; };

const view = (l) => (l ? {
  linked: true,
  abhaNumber: maskAbha(l.abhaNumber),
  abhaAddress: l.abhaAddress,
  name: l.name,
  gender: l.gender,
  yearOfBirth: l.yearOfBirth,
  mobileLast4: l.mobileLast4,
  method: l.method,
  env: l.env,
  linkedAt: l.createdAt,
} : { linked: false });

function fail(res, e) {
  if (e instanceof abdm.AbdmError) return res.status(e.status).json({ status: false, code: e.code, message: e.message });
  console.error("abha:", e?.message);
  return res.status(500).json({ status: false, message: "Something went wrong. Please try again." });
}
const notConfigured = (res) => res.status(503).json({ status: false, configured: false, message: "ABHA linking is coming soon." });

// pull the fields we keep out of whichever profile shape ABDM returned (enrol vs login)
function fromProfile(p = {}) {
  const name = p.name || [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ");
  const addr = p.preferredAbhaAddress || p.abhaAddress || (Array.isArray(p.phrAddress) ? p.phrAddress[0] : "") || "";
  return {
    abhaNumber: fmtAbha(p.ABHANumber || p.abhaNumber || p.healthIdNumber),
    abhaAddress: String(addr),
    name: String(name || "").trim(),
    gender: String(p.gender || ""),
    yearOfBirth: String(p.yearOfBirth || (p.dob ? String(p.dob).slice(-4) : "") || ""),
    mobileLast4: digits(p.mobile).slice(-4),
  };
}

async function saveLink(userId, prof, method) {
  if (digits(prof.abhaNumber).length !== 14) throw new abdm.AbdmError("ABDM did not return an ABHA number.", { code: "ABHA_MISSING" });
  // one ABHA can belong to one CYT client
  const other = await AbhaLink.findOne({ abhaNumber: prof.abhaNumber, user: { $ne: userId } }).lean();
  if (other) throw new abdm.AbdmError("This ABHA is already linked to another Choose Your Therapist account.", { status: 409, code: "ABHA_TAKEN" });
  return AbhaLink.findOneAndUpdate(
    { user: userId },
    { $set: { ...prof, method, env: abdmConfig().env } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

// GET /abha/me → { configured, env, ...link }
export const myAbha = expressAsyncHandler(async (req, res) => {
  const link = await AbhaLink.findOne({ user: req.user._id }).lean();
  res.json({ status: true, data: { configured: abdmConfigured(), env: abdmConfig().env, ...view(link) } });
});

// POST /abha/otp { flow: "create", aadhaar } | { flow: "link", abhaNumber }
export const requestOtp = expressAsyncHandler(async (req, res) => {
  if (!abdmConfigured()) return notConfigured(res);
  const uid = String(req.user._id);
  const now = Date.now();
  const recent = (sends.get(uid) || []).filter((t) => now - t < TXN_MS);
  if (recent.length >= 3) return res.status(429).json({ status: false, message: "Too many OTP requests. Please wait 10 minutes and try again." });

  const flow = req.body?.flow === "link" ? "link" : "create";
  try {
    let out;
    if (flow === "create") {
      const aadhaar = digits(req.body?.aadhaar);
      if (aadhaar.length !== 12) return res.status(400).json({ status: false, message: "Enter your 12-digit Aadhaar number." });
      if (req.body?.consent !== true) return res.status(400).json({ status: false, message: "Please accept the consent to continue." });
      out = await abdm.enrolRequestOtp(aadhaar);
    } else {
      const abha = digits(req.body?.abhaNumber);
      if (abha.length !== 14) return res.status(400).json({ status: false, message: "Enter your 14-digit ABHA number." });
      out = await abdm.loginRequestOtp(abha);
    }
    if (!out?.txnId) throw new abdm.AbdmError(out?.message || "ABDM did not start the OTP.", { code: "ABDM_NO_TXN" });
    pending.set(uid, { flow, txnId: out.txnId, until: now + TXN_MS, tries: 0 });
    sends.set(uid, [...recent, now]);
    res.json({ status: true, data: { flow, message: out.message || "OTP sent." } });
  } catch (e) { fail(res, e); }
});

// POST /abha/verify { otp, mobile? }  (mobile = the number to keep on a new ABHA)
export const verifyOtp = expressAsyncHandler(async (req, res) => {
  if (!abdmConfigured()) return notConfigured(res);
  const uid = String(req.user._id);
  const p = pending.get(uid);
  if (!p || Date.now() > p.until) { pending.delete(uid); return res.status(400).json({ status: false, message: "OTP expired. Please request a new one." }); }
  const otp = digits(req.body?.otp);
  if (otp.length !== 6) return res.status(400).json({ status: false, message: "Enter the 6-digit OTP." });
  if (++p.tries > 5) { pending.delete(uid); return res.status(429).json({ status: false, message: "Too many wrong tries. Please request a new OTP." }); }

  try {
    let prof;
    if (p.flow === "create") {
      const mobile = digits(req.body?.mobile).slice(-10);
      if (mobile.length !== 10) return res.status(400).json({ status: false, message: "Enter a 10-digit mobile number." });
      const out = await abdm.enrolByAadhaar({ txnId: p.txnId, otp, mobile });
      prof = fromProfile(out?.ABHAProfile || out?.abhaProfile || {});
    } else {
      const out = await abdm.loginVerify({ txnId: p.txnId, otp });
      const token = out?.token || out?.tokens?.token;
      if (!token) throw new abdm.AbdmError(out?.message || "OTP could not be verified.", { status: 400, code: "ABHA_OTP" });
      prof = fromProfile(await abdm.profile(token));
    }
    const link = await saveLink(req.user._id, prof, p.flow === "create" ? "created-aadhaar" : "linked-abha-number");
    pending.delete(uid);
    res.json({ status: true, data: { configured: true, env: abdmConfig().env, ...view(link.toObject()) } });
  } catch (e) { fail(res, e); }
});

// DELETE /abha/me → unlink (only removes it from CYT; the ABHA itself stays with the client)
export const unlinkAbha = expressAsyncHandler(async (req, res) => {
  await AbhaLink.deleteOne({ user: req.user._id });
  pending.delete(String(req.user._id));
  res.json({ status: true, data: { configured: abdmConfigured(), env: abdmConfig().env, linked: false } });
});
