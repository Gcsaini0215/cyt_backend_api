import mongoose from "mongoose";
import "../models/Users.js"; // registers the "User" model that a therapist points at
import Therapists from "../models/Therapists.js";
import NoidaPricing from "../models/NoidaPricing.js";

// A therapist is "live" when the admin has switched them on for the website.
const LIVE = { show_to_page: { $gt: 0 } };

const publicView = (d) => ({
  _id: d._id,
  name: d.user?.name || "",
  image: d.user?.profile || "",
  profileType: d.profile_type || "",
  qualification: d.qualification || "",
  experience: d.year_of_exp || "",
});

// The therapists the admin picked for CYT Noida, in the admin's order — and only
// those who are still live, so switching someone off on the website also takes
// them off the booking page.
export async function getOfferedTherapists() {
  const pricing = await NoidaPricing.findOne({}).select("therapists").lean();
  const ids = pricing?.therapists || [];
  if (!ids.length) return [];
  const docs = await Therapists.find({ _id: { $in: ids }, ...LIVE }).populate("user", "name profile").lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean).map(publicView).filter((t) => t.name);
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
  return docs
    .map((d) => ({ ...publicView(d), live: Number(d.show_to_page) > 0, selected: selected.includes(String(d._id)) }))
    .filter((t) => t.name)
    .sort((a, b) => Number(b.selected) - Number(a.selected) || a.name.localeCompare(b.name));
}

export { LIVE as LIVE_THERAPIST_FILTER };
