// Thin ABDM V3 client: gateway session token (cached), RSA encryption of Aadhaar / OTP / ABHA number,
// and the ABHA (M1) calls CYT needs. Every call sends REQUEST-ID + TIMESTAMP as the V3 APIs require.
//
// Endpoints follow the ABDM V3 docs (M1 Postman collection). They are kept in one place so they can be
// corrected quickly once sandbox keys arrive and the first real calls are made.
import crypto from "crypto";
import { abdmConfig } from "./config.js";

export class AbdmError extends Error {
  constructor(message, { status = 502, code = "ABDM_ERROR", details = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const headers = (extra = {}) => ({
  "Content-Type": "application/json",
  "REQUEST-ID": crypto.randomUUID(),
  TIMESTAMP: new Date().toISOString(),
  ...extra,
});

async function call(url, { method = "GET", body, headers: h = {}, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method, headers: headers(h), body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
  } catch (e) {
    throw new AbdmError(e.name === "AbortError" ? "ABDM did not answer in time. Please try again." : "Couldn't reach ABDM. Please try again.", { status: 504, code: "ABDM_UNREACHABLE" });
  } finally {
    clearTimeout(t);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text.slice(0, 500) }; }
  if (!res.ok) {
    // ABDM errors come as { error: { code, message } } or { code, message } — pass a readable message on
    const msg = data?.error?.message || data?.message || data?.errorDetails?.[0]?.message || `ABDM error ${res.status}`;
    throw new AbdmError(msg, { status: res.status === 401 ? 502 : res.status >= 500 ? 502 : 400, code: data?.error?.code || data?.code || "ABDM_ERROR", details: data });
  }
  return data;
}

/* ── gateway session token (client credentials), cached until a minute before it expires ── */
let session = { token: null, until: 0 };
export async function gatewayToken() {
  if (session.token && Date.now() < session.until) return session.token;
  const c = abdmConfig();
  const data = await call(`${c.gateway}/sessions`, {
    method: "POST",
    headers: { "X-CM-ID": c.cmId },
    body: { clientId: c.clientId, clientSecret: c.clientSecret, grantType: "client_credentials" },
  });
  const token = data?.accessToken;
  if (!token) throw new AbdmError("ABDM session failed — check ABDM_CLIENT_ID / ABDM_CLIENT_SECRET.", { code: "ABDM_SESSION" });
  session = { token, until: Date.now() + Math.max(60, Number(data.expiresIn || 600) - 60) * 1000 };
  return token;
}

/* ── RSA public key for encrypting Aadhaar / OTP / ABHA number (RSA/ECB/OAEPWithSHA-1AndMGF1Padding) ── */
let pubKey = { pem: null, until: 0 };
async function publicKey() {
  if (pubKey.pem && Date.now() < pubKey.until) return pubKey.pem;
  const c = abdmConfig();
  const data = await call(`${c.abha}/profile/public/certificate`, { headers: { Authorization: `Bearer ${await gatewayToken()}` } });
  const raw = String(data?.publicKey || "").replace(/\s+/g, "");
  if (!raw) throw new AbdmError("ABDM public key missing.", { code: "ABDM_KEY" });
  const pem = `-----BEGIN PUBLIC KEY-----\n${raw.match(/.{1,64}/g).join("\n")}\n-----END PUBLIC KEY-----`;
  pubKey = { pem, until: Date.now() + 6 * 3600 * 1000 };
  return pem;
}
export async function encrypt(value) {
  const buf = crypto.publicEncrypt(
    { key: await publicKey(), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
    Buffer.from(String(value), "utf8"),
  );
  return buf.toString("base64");
}

const authed = async (extra = {}) => ({ Authorization: `Bearer ${await gatewayToken()}`, ...extra });

/* ── M1: create a new ABHA with Aadhaar OTP ── */
export async function enrolRequestOtp(aadhaar) {
  const c = abdmConfig();
  return call(`${c.abha}/enrollment/request/otp`, {
    method: "POST",
    headers: await authed(),
    body: { txnId: "", scope: ["abha-enrol"], loginHint: "aadhaar", loginId: await encrypt(aadhaar), otpSystem: "aadhaar" },
  }); // → { txnId, message }
}
export async function enrolByAadhaar({ txnId, otp, mobile }) {
  const c = abdmConfig();
  return call(`${c.abha}/enrollment/enrol/byAadhaar`, {
    method: "POST",
    headers: await authed(),
    body: {
      authData: { authMethods: ["otp"], otp: { txnId, otpValue: await encrypt(otp), mobile } },
      consent: { code: "abha-enrollment", version: "1.4" },
    },
  }); // → { message, txnId, tokens: { token, ... }, ABHAProfile: {...}, isNew }
}

/* ── M1: link an ABHA the client already has (ABHA number + OTP on the mobile registered with it) ── */
export async function loginRequestOtp(abhaNumber) {
  const c = abdmConfig();
  return call(`${c.abha}/profile/login/request/otp`, {
    method: "POST",
    headers: await authed(),
    body: { scope: ["abha-login", "mobile-verify"], loginHint: "abha-number", loginId: await encrypt(abhaNumber), otpSystem: "abdm" },
  }); // → { txnId, message }
}
export async function loginVerify({ txnId, otp }) {
  const c = abdmConfig();
  return call(`${c.abha}/profile/login/verify`, {
    method: "POST",
    headers: await authed(),
    body: { scope: ["abha-login", "mobile-verify"], authData: { authMethods: ["otp"], otp: { txnId, otpValue: await encrypt(otp) } } },
  }); // → { token, accounts: [...], ... }
}
export async function profile(xToken) {
  const c = abdmConfig();
  return call(`${c.abha}/profile/account`, { headers: await authed({ "X-token": `Bearer ${xToken}` }) });
}
