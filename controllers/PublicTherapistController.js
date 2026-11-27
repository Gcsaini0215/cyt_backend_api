// Public, read-only therapist data for showing CYT therapists on other websites (partner pages,
// the blog, landing pages). Only what a profile shows; never contact details, documents,
// street addresses, plan/payment info or reviewers' full names.
// Every call needs the header  x-api-key: <one of PUBLIC_API_KEYS>  (see middlewares/publicApiKey.js).
//
//   GET /api/public/therapists              all therapists live on the site (cards)
//     ?type=clinical|counselling|...         profile type contains this text
//     ?city=noida                            location contains this text
//     ?limit=12                              at most this many (1–100)
//   GET /api/public/therapists/:idOrSlug    one therapist's full profile (id, or the slug from the list)
import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Therapists from "../models/Therapists.js";

const SITE = "https://www.chooseyourtherapist.in";
const API = process.env.API_PUBLIC_URL || "https://api.chooseyourtherapist.in";
const CACHE_MS = 5 * 60 * 1000;
let cache = { at: 0, list: null };

const split = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const photoUrl = (p) => {
  const f = String(p || "").trim();
  if (!f) return null;
  if (/^https?:\/\//i.test(f)) return f;
  return `${API}/uploads/images/${f.replace(/^\/+/, "")}`;
};
// Lowest fee the therapist has set for any service/format.
const feeFrom = (fees) => {
  const all = [];
  for (const s of fees || []) for (const f of s?.formats || []) { const n = Number(f?.fee); if (n > 0) all.push(n); }
  return all.length ? Math.min(...all) : null;
};
// same shape as the site's profile URLs: "counselling-psychologist-teesta-joshi-uttar-pradesh"
const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const slugOf = (t) => [slugify(t.profile_type), slugify(t.user?.name), slugify(String(t.state || "").split(",")[0])]
  .filter(Boolean).join("-");
// "siddharth goyal" -> "Siddharth G." (reviews show a first name only)
const shortName = (n) => {
  const p = String(n || "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "Client";
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  return p.length > 1 ? `${cap(p[0])} ${p[p.length - 1][0].toUpperCase()}.` : cap(p[0]);
};

const PIPELINE = (match) => [
  { $match: match },
  { $lookup: { from: "users", localField: "user", foreignField: "_id", as: "user" } },
  { $unwind: "$user" },
  { $lookup: { from: "reviews", localField: "_id", foreignField: "therapist_id", as: "reviews" } },
  {
    $project: {
      profile_type: 1, qualification: 1, year_of_exp: 1, language_spoken: 1, experties: 1, services: 1,
      serve_type: 1, session_formats: 1, state: 1, fees: 1, availabilities: 1, top_therapist: 1, profile_code: 1,
      license_number: 1, office_is_clinic: 1, createdAt: 1, "office_area.label": 1,
      "user.name": 1, "user.profile": 1, "user.bio": 1, "user.gender": 1, "user.is_verified": 1, "user.is_online": 1,
      "reviews.rating": 1, "reviews.name": 1, "reviews.description": 1, "reviews.createdAt": 1,
    },
  },
];

// The card used by the list (and as the top of the full profile).
const card = (t) => {
  const ratings = (t.reviews || []).map((r) => Number(r.rating)).filter((n) => n > 0);
  const rating = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;
  const bio = String(t.user.bio || "").replace(/\s+/g, " ").trim();
  return {
    id: String(t._id),
    slug: slugOf(t),
    name: t.user.name.trim(),
    photo: photoUrl(t.user.profile),
    profile_type: t.profile_type || "",
    qualification: t.qualification || "",
    experience: t.year_of_exp || "",
    gender: t.user.gender || "",
    location: t.office_area?.label || t.state || "",
    languages: split(t.language_spoken),
    expertise: split(t.experties),
    services: split(t.services),
    session_formats: split(t.session_formats),
    fee_from: feeFrom(t.fees),
    currency: "INR",
    rating,
    reviews_count: ratings.length,
    top_therapist: !!t.top_therapist,
    verified: String(t.user.is_verified) === "1",
    bio: bio.length > 240 ? `${bio.slice(0, 237).trim()}…` : bio,
    // the site 301-redirects these _id links to the SEO profile / booking URLs
    profile_url: `${SITE}/view-profile/${t._id}`,
    book_url: `${SITE}/book/${t._id}`,
  };
};

const loadList = async () => {
  if (cache.list && Date.now() - cache.at < CACHE_MS) return cache.list;
  const rows = await Therapists.aggregate(PIPELINE({ show_to_page: 1 }));
  const list = rows
    .filter((t) => t.user?.name)
    .map((t) => ({ ...card(t), _created: t.createdAt }))
    // top therapists first, then most reviewed, then oldest on the site
    .sort((a, b) => (b.top_therapist - a.top_therapist) || (b.reviews_count - a.reviews_count) || (new Date(a._created) - new Date(b._created)))
    .map(({ _created, ...t }) => t);
  cache = { at: Date.now(), list };
  return list;
};

export const publicTherapists = expressAsyncHandler(async (req, res) => {
  // CORS for /api/public/* is set in app.js; private = shared caches never store a keyed response
  res.setHeader("Cache-Control", "private, max-age=300");
  let list = await loadList();
  const type = String(req.query.type || "").trim().toLowerCase().slice(0, 40);
  const city = String(req.query.city || "").trim().toLowerCase().slice(0, 40);
  if (type) list = list.filter((t) => t.profile_type.toLowerCase().includes(type));
  if (city) list = list.filter((t) => t.location.toLowerCase().includes(city));
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 100);
  const total = list.length;
  if (limit) list = list.slice(0, limit);
  res.json({ status: true, total, count: list.length, data: list });
});

// One therapist's full profile — what the site's view-profile page shows.
export const publicTherapistProfile = expressAsyncHandler(async (req, res) => {
  res.setHeader("Cache-Control", "private, max-age=300");
  const key = String(req.params.idOrSlug || "").trim().toLowerCase().slice(0, 160);
  let id = /^[a-f0-9]{24}$/.test(key) ? key : null;
  if (!id && /^[a-z0-9-]+$/.test(key)) id = (await loadList()).find((t) => t.slug === key)?.id || null;
  if (!id) return res.status(404).json({ status: false, message: "Therapist not found." });

  // only therapists who are live on the site
  const [t] = await Therapists.aggregate(PIPELINE({ _id: new mongoose.Types.ObjectId(id), show_to_page: 1 }));
  if (!t || !t.user?.name) return res.status(404).json({ status: false, message: "Therapist not found." });

  const fees = (t.fees || [])
    .map((s) => ({
      service: s?.name || "",
      formats: (s?.formats || []).filter((f) => Number(f?.fee) > 0).map((f) => ({ type: f.type, fee: Number(f.fee) })),
    }))
    .filter((s) => s.service && s.formats.length);
  const availability = (t.availabilities || [])
    .map((d) => ({ day: d?.day, times: (d?.times || []).filter((x) => x?.open && x?.close).map((x) => ({ open: x.open, close: x.close })) }))
    .filter((d) => d.day && d.times.length);
  const reviews = (t.reviews || [])
    .filter((r) => Number(r.rating) > 0)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 20)
    .map((r) => ({ name: shortName(r.name), rating: Number(r.rating), comment: String(r.description || "").trim(), date: r.createdAt || null }));

  res.json({
    status: true,
    data: {
      ...card(t),
      bio: String(t.user.bio || "").trim(), // full bio here
      profile_code: t.profile_code || "",
      license_number: t.license_number || "",
      serve_type: split(t.serve_type),
      online_now: String(t.user.is_online) === "1",
      in_person: { available: split(t.session_formats).some((f) => /in.?person/i.test(f)), area: t.office_area?.label || "", clinic: !!t.office_is_clinic },
      fees,
      availability,
      reviews,
    },
  });
});
