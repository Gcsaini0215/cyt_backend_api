import expressAsyncHandler from "express-async-handler";
import QRCode from "qrcode";
import Therapists from "../models/Therapists.js";
import "../models/Users.js";
import TherapistAchievement from "../models/TherapistAchievement.js";
import { achievementsFor, byKey } from "../helper/achievements.js";

const SITE = "https://www.chooseyourtherapist.in";

// GET /therapist/achievements — the signed-in therapist's achievements, progress and numbers
export const myAchievements = expressAsyncHandler(async (req, res) => {
  const t = await Therapists.findOne({ user: req.user._id }).select("_id createdAt").lean();
  if (!t) return res.status(404).json({ status: false, message: "Profile not found." });
  res.json({ status: true, data: await achievementsFor(t) });
});

// GET /achievements/verify/:code — public: who earned it, what, when (the certificate and its QR link here)
export const verifyAchievement = expressAsyncHandler(async (req, res) => {
  const code = String(req.params.code || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20);
  const a = code ? await TherapistAchievement.findOne({ code }).lean() : null;
  const def = a && byKey[a.key];
  if (!a || !def) return res.status(404).json({ status: false, message: "No certificate with this code." });
  const t = await Therapists.findById(a.therapist).select("_id profile_type state user").populate("user", "name").lean();
  if (!t) return res.status(404).json({ status: false, message: "No certificate with this code." });
  const verifyUrl = `${SITE}/verify-achievement/${a.code}`;
  res.json({
    status: true,
    data: {
      code: a.code, key: a.key, title: def.title, tier: def.tier, line: def.line, unlockedAt: a.unlockedAt,
      stats: a.stats || {},
      therapist: { _id: String(t._id), name: t.user?.name || "", profile_type: t.profile_type || "", state: t.state || "" },
      verifyUrl,
      qr: await QRCode.toDataURL(verifyUrl, { margin: 1, width: 260, color: { dark: "#14532d", light: "#ffffff" } }),
    },
  });
});
