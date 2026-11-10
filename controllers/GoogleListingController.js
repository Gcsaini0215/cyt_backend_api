// "Get found on Google Maps" — help therapists with a real clinic set up their own Google Business
// Profile ("psychologist near me"), with the Website / Book buttons pointing at their CYT booking link.
// Google only allows a listing at a place clients actually visit, so online-only therapists aren't eligible.
import expressAsyncHandler from "express-async-handler";
import Therapists from "../models/Therapists.js";
import GoogleListing from "../models/GoogleListing.js";

const STATUSES = ["not-started", "in-progress", "submitted", "verified", "live"];
const isMapsUrl = (u) => /^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps|g\.page|g\.co\/kgs|share\.google)\//i.test(String(u || ""));
const listOf = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const inPerson = (t) => /in[- ]?person|offline|clinic|both/i.test(`${t.session_formats || ""} ${t.mode || ""} ${t.serve_type || ""}`);

function eligibility(t) {
  const reasons = [];
  const clinic = !!(t.office_is_clinic || t.office_area?.clinic);
  if (!clinic) reasons.push("Mark your practice as a clinic / centre in Settings → Practice location (Google only lists places clients visit).");
  if (!String(t.office_address || "").trim()) reasons.push("Add your full clinic address in Settings → Practice location.");
  if (!inPerson(t)) reasons.push("Turn on in-person sessions in your profile.");
  return { eligible: reasons.length === 0, reasons, clinic };
}

// GET /therapist/google-listing
export const myGoogleListing = expressAsyncHandler(async (req, res) => {
  const t = await Therapists.findOne({ user: req.user._id })
    .select("_id profile_type office_address office_city office_state office_pincode office_location office_is_clinic office_area session_formats mode serve_type language_spoken experties year_of_exp qualification show_to_page")
    .lean();
  if (!t) return res.status(404).json({ status: false, message: "Therapist profile not found." });
  const listing = await GoogleListing.findOne({ therapist: t._id }).lean();
  const el = eligibility(t);
  res.json({ status: true, data: {
    ...el,
    live: Number(t.show_to_page) === 1 || t.show_to_page === true,
    prefill: {
      name: req.user.name || "",
      phone: req.user.phone || "",
      role: t.profile_type || "Psychologist",
      address: t.office_address || "",
      city: t.office_city || "",
      state: t.office_state || "",
      pincode: t.office_pincode || "",
      pin: t.office_location?.lat ? { lat: t.office_location.lat, lng: t.office_location.lng } : null,
      languages: listOf(t.language_spoken),
      specialities: listOf(t.experties).slice(0, 8),
      experience: t.year_of_exp || "",
      qualification: t.qualification || "",
    },
    listing: listing ? { status: listing.status, mapsUrl: listing.mapsUrl, updatedAt: listing.updatedAt } : { status: "not-started", mapsUrl: "" },
  } });
});

// PUT /therapist/google-listing { status, mapsUrl }
export const saveMyGoogleListing = expressAsyncHandler(async (req, res) => {
  const t = await Therapists.findOne({ user: req.user._id }).select("_id").lean();
  if (!t) return res.status(404).json({ status: false, message: "Therapist profile not found." });
  const status = STATUSES.includes(req.body?.status) ? req.body.status : undefined;
  const mapsUrl = String(req.body?.mapsUrl || "").trim().slice(0, 500);
  if (mapsUrl && !isMapsUrl(mapsUrl)) return res.status(400).json({ status: false, message: "Paste the link of your listing from Google Maps (Share → Copy link)." });
  const set = { ...(status ? { status } : {}), ...(req.body?.mapsUrl !== undefined ? { mapsUrl } : {}) };
  if (mapsUrl && !status) set.status = "live";
  const row = await GoogleListing.findOneAndUpdate({ therapist: t._id }, { $set: set }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  res.json({ status: true, data: { status: row.status, mapsUrl: row.mapsUrl, updatedAt: row.updatedAt } });
});

// GET /admin/google-listings — every therapist with a clinic, plus anyone who started a listing
export const adminGoogleListings = expressAsyncHandler(async (req, res) => {
  const [listings, clinics] = await Promise.all([
    GoogleListing.find({}).lean(),
    Therapists.find({ $or: [{ office_is_clinic: true }, { "office_area.clinic": true }] })
      .select("_id user profile_type office_address office_city office_state office_is_clinic office_area session_formats mode serve_type show_to_page")
      .populate("user", "name email phone").lean(),
  ]);
  const byT = new Map(listings.map((l) => [String(l.therapist), l]));
  const extraIds = listings.map((l) => l.therapist).filter((id) => !clinics.some((c) => String(c._id) === String(id)));
  const extra = extraIds.length ? await Therapists.find({ _id: { $in: extraIds } })
    .select("_id user profile_type office_address office_city office_state office_is_clinic office_area session_formats mode serve_type show_to_page")
    .populate("user", "name email phone").lean() : [];
  const order = { live: 0, verified: 1, submitted: 2, "in-progress": 3, "not-started": 4 };
  const rows = [...clinics, ...extra].map((t) => {
    const l = byT.get(String(t._id));
    return {
      therapistId: String(t._id), name: t.user?.name || "", email: t.user?.email || "", phone: t.user?.phone || "",
      role: t.profile_type || "", city: [t.office_city, t.office_state].filter(Boolean).join(", "), address: t.office_address || "",
      live: Number(t.show_to_page) === 1 || t.show_to_page === true, ...eligibility(t),
      status: l?.status || "not-started", mapsUrl: l?.mapsUrl || "", updatedAt: l?.updatedAt || null,
    };
  }).sort((a, b) => (order[a.status] - order[b.status]) || a.name.localeCompare(b.name));
  res.json({ status: true, data: rows });
});
