import mongoose from "mongoose";
import "../models/Users.js"; // registers the "User" model that a therapist points at
import Therapists from "../models/Therapists.js";
import NoidaPricing from "../models/NoidaPricing.js";
import Review from "../models/Review.js";

// A therapist is "live" when the admin has switched them on for the website.
const LIVE = { show_to_page: { $gt: 0 } };

// Average star rating and number of reviews per therapist (all reviews left for them).
async function ratingsFor(ids) {
  if (!ids.length) return new Map();
  const rows = await Review.aggregate([
    { $match: { therapist_id: { $in: ids.map((i) => new mongoose.Types.ObjectId(String(i))) } } },
    { $group: { _id: "$therapist_id", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), { rating: Math.round(r.avg * 10) / 10, reviewCount: r.count }]));
}

const publicView = (d, stats) => ({
  _id: d._id,
  rating: stats?.rating || 0,
  reviewCount: stats?.reviewCount || 0,
  name: d.user?.name || "",
  image: d.user?.profile || "",
  profileType: d.profile_type || "",
  qualification: d.qualification || "",
  experience: d.year_of_exp || "",
});

// The therapists the admin picked for CYT Noida, in the admin's order — and only
// those who are still live, so switching someone off on the website also takes
// them off the booking page.
export async function isTherapistChoiceEnabled() {
  const pricing = await NoidaPricing.findOne({}).select("therapistChoice").lean();
  return pricing?.therapistChoice !== false; // on unless the admin switched it off
}

export async function getOfferedTherapists() {
  const pricing = await NoidaPricing.findOne({}).select("therapists therapistChoice").lean();
  if (pricing?.therapistChoice === false) return [];
  const ids = pricing?.therapists || [];
  if (!ids.length) return [];
  const [docs, stats] = await Promise.all([
    Therapists.find({ _id: { $in: ids }, ...LIVE }).populate("user", "name profile").lean(),
    ratingsFor(ids),
  ]);
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean).map((d) => publicView(d, stats.get(String(d._id)))).filter((t) => t.name);
}

export async function resolveOfferedTherapist(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  const list = await getOfferedTherapists();
  return list.find((t) => String(t._id) === String(id)) || null;
}

// Admin: every live therapist, plus any chosen one who has since gone off-air.
export async function getTherapistOptions() {
  const pricing = await NoidaPricing.findOne({}).select("therapists").lean();
  const selected = (pricing?.therapists || []).map(String);
  const docs = await Therapists.find({ $or: [LIVE, { _id: { $in: selected } }] }).populate("user", "name profile").lean();
  const stats = await ratingsFor(docs.map((d) => d._id));
  return docs
    .map((d) => ({ ...publicView(d, stats.get(String(d._id))), live: Number(d.show_to_page) > 0, selected: selected.includes(String(d._id)) }))
    .filter((t) => t.name)
    .sort((a, b) => Number(b.selected) - Number(a.selected) || a.name.localeCompare(b.name));
}

export { LIVE as LIVE_THERAPIST_FILTER };
