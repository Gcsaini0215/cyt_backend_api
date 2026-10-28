import crypto from "crypto";
import Booking from "../models/Booking.js";
import Review from "../models/Review.js";
import TherapistAchievement from "../models/TherapistAchievement.js";

/* Therapist achievements on CYT, earned from real numbers: completed sessions, reviews rated 4★ or more
   (and the average rating), and time on CYT. Once a therapist meets one it is saved (with a public code)
   and stays theirs; its certificate can be downloaded and verified by anyone. */

// metric: sessions | goodReviews | months. `minAvg` = the average rating also needed.
export const ACHIEVEMENTS = [
  { key: "first_session", title: "First Session", tier: "bronze", metric: "sessions", goal: 1, line: "for completing a first session with a client on Choose Your Therapist" },
  { key: "sessions_25", title: "25 Sessions", tier: "silver", metric: "sessions", goal: 25, line: "for completing 25 therapy sessions with clients on Choose Your Therapist" },
  { key: "sessions_100", title: "100 Sessions Milestone", tier: "gold", metric: "sessions", goal: 100, line: "for completing 100 therapy sessions with clients on Choose Your Therapist" },
  { key: "rising_star", title: "Rising Star", tier: "silver", metric: "goodReviews", goal: 10, minAvg: 4, line: "for earning 10 client reviews rated 4 stars or more" },
  { key: "client_favourite", title: "Client Favourite", tier: "gold", metric: "goodReviews", goal: 50, minAvg: 4.3, line: "for earning 50 client reviews rated 4 stars or more, with an average of 4.3 or higher" },
  { key: "excellence_100", title: "CYT Excellence Award", tier: "platinum", metric: "goodReviews", goal: 100, minAvg: 4, line: "for earning 100 client reviews rated 4 stars or more" },
  { key: "one_year", title: "One Year with CYT", tier: "bronze", metric: "months", goal: 12, line: "for a year of practice as a verified psychologist on Choose Your Therapist" },
];
export const byKey = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.key, a]));

export async function statsOf(therapist) {
  const [sessions, reviews] = await Promise.all([
    Booking.countDocuments({ therapist: therapist._id, status: "Completed" }),
    Review.find({ therapist_id: therapist._id }).select("rating").lean(),
  ]);
  const rated = reviews.filter((r) => Number(r.rating) > 0);
  const avgRating = rated.length ? Math.round((rated.reduce((n, r) => n + Number(r.rating), 0) / rated.length) * 10) / 10 : 0;
  const since = new Date(therapist.createdAt || Date.now()).getTime();
  const months = Math.max(0, Math.floor((Date.now() - since) / (30.44 * 86400000)));
  return { sessions, goodReviews: rated.filter((r) => Number(r.rating) >= 4).length, reviews: rated.length, avgRating, months };
}

const met = (a, s) => s[a.metric] >= a.goal && (!a.minAvg || s.avgRating >= a.minAvg);
const newCode = () => `CYT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

// the therapist's achievements: saved ones + any just reached (saved now), with progress for the rest
export async function achievementsFor(therapist) {
  const stats = await statsOf(therapist);
  const saved = await TherapistAchievement.find({ therapist: therapist._id }).lean();
  const have = new Map(saved.map((x) => [x.key, x]));
  for (const a of ACHIEVEMENTS) {
    if (have.has(a.key) || !met(a, stats)) continue;
    for (let i = 0; i < 3; i++) {
      try {
        const doc = await TherapistAchievement.create({ therapist: therapist._id, key: a.key, code: newCode(), stats: { sessions: stats.sessions, goodReviews: stats.goodReviews, avgRating: stats.avgRating, months: stats.months } });
        have.set(a.key, doc.toObject());
        break;
      } catch (e) {
        if (e?.code !== 11000) throw e;
        const again = await TherapistAchievement.findOne({ therapist: therapist._id, key: a.key }).lean(); // saved by a parallel request
        if (again) { have.set(a.key, again); break; }
      }
    }
  }
  const list = ACHIEVEMENTS.map((a) => {
    const got = have.get(a.key);
    const value = stats[a.metric];
    return {
      key: a.key, title: a.title, tier: a.tier, line: a.line, metric: a.metric, goal: a.goal, minAvg: a.minAvg || null,
      value, progress: Math.min(1, value / a.goal),
      unlocked: !!got, code: got?.code || null, unlockedAt: got?.unlockedAt || null,
    };
  });
  return { stats, list };
}
