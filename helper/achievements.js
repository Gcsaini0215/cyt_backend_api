import crypto from "crypto";
import Booking from "../models/Booking.js";
import Review from "../models/Review.js";
import TherapistAchievement from "../models/TherapistAchievement.js";
import Therapists from "../models/Therapists.js";

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
  const fresh = []; // unlocked by this call
  for (const a of ACHIEVEMENTS) {
    if (have.has(a.key) || !met(a, stats)) continue;
    for (let i = 0; i < 3; i++) {
      try {
        const doc = await TherapistAchievement.create({ therapist: therapist._id, key: a.key, code: newCode(), stats: { sessions: stats.sessions, goodReviews: stats.goodReviews, avgRating: stats.avgRating, months: stats.months } });
        have.set(a.key, doc.toObject());
        fresh.push({ key: a.key, title: a.title, tier: a.tier, line: a.line, code: doc.code });
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
  const level = await splitLevelFor(therapist, { stats, unlocked: new Set([...have.keys()]) });
  return { stats, list, fresh, level };
}

/* The CYT share of each session goes down as a therapist earns achievements (never below 7%):
   30% to start · Rising Star + 25 Sessions → 25% · + 100 Sessions + Client Favourite → 20% ·
   all achievements → 15%, then −2% for every 100 sessions past 100, down to 7%.
   While the average rating is under 4★ the share is back to 30% (the certificates stay). */
export const BASE_PLATFORM_PCT = 30;
export const MIN_PLATFORM_PCT = 7;
const LEVELS = [
  { pct: 25, name: "Level 1", needs: ["rising_star", "sessions_25"] },
  { pct: 20, name: "Level 2", needs: ["rising_star", "sessions_25", "sessions_100", "client_favourite"] },
  { pct: 15, name: "Level 3", needs: ACHIEVEMENTS.map((a) => a.key) },
];

export function platformPctOf(stats, unlocked) {
  const has = (k) => unlocked.has(k);
  if (stats.reviews > 0 && stats.avgRating < 4) return { pct: BASE_PLATFORM_PCT, level: "Base", ratingHold: true };
  let cur = { pct: BASE_PLATFORM_PCT, level: "Base" };
  for (const l of LEVELS) if (l.needs.every(has)) cur = { pct: l.pct, level: l.name };
  if (cur.level === "Level 3") {
    const extra = Math.floor(Math.max(0, stats.sessions - 100) / 100);
    const pct = Math.max(MIN_PLATFORM_PCT, 15 - 2 * extra);
    if (pct < 15) cur = { pct, level: pct === MIN_PLATFORM_PCT ? "Top level" : "Level 3+" };
  }
  return cur;
}

// what the therapist gets now, and what the next step down for CYT needs
export async function splitLevelFor(therapist, known) {
  const stats = known?.stats || (await statsOf(therapist));
  const keys = known?.unlocked || new Set((await TherapistAchievement.find({ therapist: therapist._id }).select("key").lean()).map((x) => x.key));
  const cur = platformPctOf(stats, keys);
  let next = null;
  if (cur.ratingHold) next = { pct: platformPctOf({ ...stats, avgRating: 5 }, keys).pct, needs: ["Bring your average rating back to 4★ or more"] };
  else if (cur.pct > MIN_PLATFORM_PCT) {
    const l = LEVELS.find((x) => x.pct < cur.pct && !x.needs.every((k) => keys.has(k)));
    if (l) next = { pct: l.pct, needs: l.needs.filter((k) => !keys.has(k)).map((k) => byKey[k].title) };
    else {
      const target = (Math.floor(Math.max(0, stats.sessions - 100) / 100) + 1) * 100 + 100;
      next = { pct: Math.max(MIN_PLATFORM_PCT, cur.pct - 2), needs: [`${target} completed sessions (${target - stats.sessions} to go)`] };
    }
  }
  return { platformPct: cur.pct, therapistPct: 100 - cur.pct, level: cur.level, ratingHold: !!cur.ratingHold, next, minPlatformPct: MIN_PLATFORM_PCT };
}

// a session was just completed: keep the therapist's % for it on the booking (once — later changes don't move it)
export async function stampTherapistPct(bookingId, therapistId) {
  try {
    const t = { _id: therapistId };
    const lvl = await splitLevelFor({ ...t, createdAt: (await Therapists.findById(therapistId).select("createdAt").lean())?.createdAt });
    await Booking.updateOne({ _id: bookingId, therapist_pct: null }, { $set: { therapist_pct: lvl.therapistPct } });
  } catch (e) {
    console.error("[split] stamp failed:", e.message);
  }
}

// a therapist's unlocked achievements for the public profile: [{ key, title, tier, code, unlockedAt }]
export async function publicAchievements(therapistId) {
  const rows = await TherapistAchievement.find({ therapist: therapistId }).select("key code unlockedAt").sort({ unlockedAt: 1 }).lean();
  const order = Object.fromEntries(ACHIEVEMENTS.map((a, i) => [a.key, i]));
  return rows.filter((r) => byKey[r.key]).sort((a, b) => order[a.key] - order[b.key])
    .map((r) => ({ key: r.key, title: byKey[r.key].title, tier: byKey[r.key].tier, code: r.code, unlockedAt: r.unlockedAt }));
}
