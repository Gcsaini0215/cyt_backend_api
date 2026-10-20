import expressAsyncHandler from "express-async-handler";
import Therapists from "../models/Therapists.js";
import Availbility from "../models/Availbility.js";
import Review from "../models/Review.js";
import ProfileStat from "../models/ProfileStat.js";
import { recordProfileEvent, recordImpressions, profileInsights, planState, profileStrength, istDay, dayShift } from "../helper/profileStats.js";

/* POST /api/profile-stats/event — public: { t: therapist profile id, type: view|book|contact|share, vid, src } */
export const postProfileEvent = expressAsyncHandler(async (req, res) => {
  const { t, type, vid, src } = req.body || {};
  try {
    const r = await recordProfileEvent(req, { therapistId: t, type: String(type || ""), vid, src: String(src || "") });
    res.json({ status: true, ...r });
  } catch (e) {
    console.error("[profile-stats] event:", e.message);
    res.json({ status: false });
  }
});

/* POST /api/profile-stats/impressions — public: { ids: [therapist profile ids shown on the page] } */
export const postImpressions = expressAsyncHandler(async (req, res) => {
  try {
    const n = await recordImpressions(req, Array.isArray(req.body?.ids) ? req.body.ids : []);
    res.json({ status: true, n });
  } catch (e) {
    console.error("[profile-stats] impressions:", e.message);
    res.json({ status: false });
  }
});

const hasTimes = (sched) => (Array.isArray(sched) ? sched : []).some((d) => Array.isArray(d?.times) && d.times.length > 0);

/* GET /api/profile-stats/me — the signed-in therapist's insights, profile strength and plan state.
   Expired / not-yet-live therapists get only the headline numbers (locked: true). */
export const myProfileInsights = expressAsyncHandler(async (req, res) => {
  const t = await Therapists.findOne({ user: req.user._id }).populate("user", "profile bio").lean();
  if (!t) return res.json({ status: false, message: "Profile not found" });
  const [ins, reviews, av] = await Promise.all([
    profileInsights(t._id),
    Review.countDocuments({ therapist_id: t._id }),
    Availbility.findOne({ user_id: { $in: [t._id, req.user._id] } }, { schedule: 1 }).lean(),
  ]);
  const plan = planState(t);
  const locked = plan.status === "expired" || plan.status === "none";
  const strength = profileStrength(t, { reviews, hasHours: hasTimes(t.availabilities) || hasTimes(av?.schedule) });
  const c = ins.current;
  const p = ins.previous;
  res.json({
    status: true,
    data: {
      therapistId: String(t._id),
      plan,
      locked,
      strength,
      totals: { views: c.views, visitors: c.visitors, prevViews: p.views, prevVisitors: p.visitors, allTimeViews: ins.allTimeViews },
      ...(locked ? {} : {
        actions: { impressions: c.impressions, book: c.book, contact: c.contact, share: c.share, prevBook: p.book, prevImpressions: p.impressions },
        sources: c.sources,
        daily: ins.daily,
      }),
      trackingSince: ins.since,
    },
  });
});

/* GET /api/admin/profile-stats — every therapist's last-30-day numbers (admin Therapists page) */
export const adminProfileStats = expressAsyncHandler(async (req, res) => {
  const from = dayShift(istDay(), -29);
  const rows = await ProfileStat.aggregate([
    { $match: { day: { $gte: from } } },
    { $group: { _id: "$therapist", views: { $sum: "$views" }, visitors: { $sum: "$visitors" }, impressions: { $sum: "$impressions" }, book: { $sum: "$book" }, contact: { $sum: "$contact" } } },
  ]);
  const data = {};
  for (const r of rows) data[String(r._id)] = { views: r.views, visitors: r.visitors, impressions: r.impressions, book: r.book, contact: r.contact };
  res.json({ status: true, from, data });
});
