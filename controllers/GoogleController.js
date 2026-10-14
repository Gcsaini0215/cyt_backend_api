import expressAsyncHandler from "express-async-handler";
import TherapistGoogle from "../models/TherapistGoogle.js";
import { googleConfigured, authUrlFor, readState, exchangeCode, encrypt, revoke, SITE_URL } from "../helper/googleMeet.js";

// GET /google/status — is Google set up on the server, and has this therapist connected?
export const googleStatus = expressAsyncHandler(async (req, res) => {
  const conn = await TherapistGoogle.findOne({ user: req.user._id }).select("email connected_at last_error last_error_at").lean();
  res.json({
    status: true,
    data: {
      configured: googleConfigured(),
      connected: !!conn,
      email: conn?.email || "",
      connectedAt: conn?.connected_at || null,
      lastError: conn?.last_error || "",
    },
  });
});

// GET /google/connect — URL of Google's consent screen for this therapist
export const googleConnect = expressAsyncHandler(async (req, res) => {
  if (!googleConfigured()) return res.status(503).json({ status: false, message: "Google connection isn't available yet" });
  res.json({ status: true, data: { url: authUrlFor(req.user._id) } });
});

// GET /google/callback — Google sends the therapist back here (no auth header; identity is in `state`)
export const googleCallback = expressAsyncHandler(async (req, res) => {
  const back = (q) => res.redirect(`${SITE_URL}/settings?tab=account&google=${q}`);
  if (req.query.error) return back(req.query.error === "access_denied" ? "denied" : "error");
  let uid;
  try { uid = readState(String(req.query.state || "")); } catch { return back("expired"); }
  try {
    const t = await exchangeCode(String(req.query.code || ""));
    if (!/calendar\.events/.test(t.scope)) return back("noscope");
    const existing = await TherapistGoogle.findOne({ user: uid });
    if (!t.refreshToken && !existing) return back("error");
    await TherapistGoogle.updateOne(
      { user: uid },
      {
        $set: {
          email: t.email || existing?.email || "",
          ...(t.refreshToken ? { refresh_token: encrypt(t.refreshToken) } : {}),
          connected_at: new Date(), last_error: "", last_error_at: null,
        },
      },
      { upsert: true }
    );
    return back("connected");
  } catch (err) {
    console.error("[google-callback]", err?.response?.data?.error_description || err.message);
    return back("error");
  }
});

// POST /google/disconnect
export const googleDisconnect = expressAsyncHandler(async (req, res) => {
  const conn = await TherapistGoogle.findOne({ user: req.user._id });
  if (conn) {
    await revoke(conn);
    await TherapistGoogle.deleteOne({ _id: conn._id });
  }
  res.json({ status: true, message: "Google disconnected" });
});
