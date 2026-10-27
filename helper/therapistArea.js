import axios from "axios";
import Therapists from "../models/Therapists.js";

/* Where an in-person therapist practises, without making their street address public.
   The practice address (office_address / office_city / state — often a home) is geocoded with
   OpenStreetMap Nominatim and stored as office_area: lat/lng rounded to 2 decimals (~1 km) and a
   "City, State" label. The booking page shows a map of that area and the client's distance from it;
   the address itself is left out of the public APIs. A background job fills it in and redoes it when
   the address changes (Nominatim allows 1 request a second — we wait longer between calls). */

const UA = "ChooseYourTherapist/1.0 (chooseyourtherapist@gmail.com)";
const clean = (v) => (v && !/^(null|undefined|n\/a|-)$/i.test(String(v).trim()) ? String(v).replace(/\s+/g, " ").trim() : "");
const round = (n) => Math.round(Number(n) * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CENTRE = { lat: 28.58, lng: 77.37, label: "Sector 51, Noida, Uttar Pradesh", exact: true }; // the CYT centre (a business address)

// "Chandigarh, Chandigarh" → "Chandigarh"
const labelOf = (place, state) => [place, state].map((x) => String(x || "").trim()).filter(Boolean).filter((x, i, a) => a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).join(", ");

export const areaKey = (t) => [clean(t.office_address), clean(t.office_city), clean(t.office_state) || clean(t.state)].join("|").toLowerCase();

async function search(q) {
  const { data } = await axios.get("https://nominatim.openstreetmap.org/search", {
    params: { q, format: "jsonv2", limit: 1, countrycodes: "in", addressdetails: 1 },
    headers: { "User-Agent": UA, "Accept-Language": "en" }, timeout: 15000,
  });
  await sleep(1500);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

// most specific first: the full address, then with leading parts (house no., street) dropped, a
// place named in brackets ("The Catalyst Clinic (Thane)"), the city, and last the state alone
function candidates(t) {
  const address = clean(t.office_address);
  const city = clean(t.office_city);
  const state = (clean(t.office_state) || clean(t.state)).split(",").pop().trim();
  const out = [];
  const add = (s) => { const v = s.replace(/\s*,\s*/g, ", ").replace(/^,\s*|,\s*$/g, "").trim(); if (v && !out.includes(v)) out.push(v); };
  const parts = [address, city].join(",").split(",").map((x) => x.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  for (let i = 0; i < parts.length; i++) add([...parts.slice(i), state].join(", "));
  // "Maan Nagar Road no.3 Jhunjhunu Rajasthan" — one part: try its last words as the town
  parts.forEach((x) => {
    const w = x.split(/\s+/).filter((y) => /[a-z]{3,}/i.test(y) && y.toLowerCase() !== state.toLowerCase());
    if (w.length > 1) { add(`${w.slice(-2).join(" ")}, ${state}`); add(`${w[w.length - 1]}, ${state}`); }
  });
  (address.match(/\(([^)]+)\)/g) || []).forEach((m) => add(`${m.slice(1, -1)}, ${state}`));
  const stateCity = (clean(t.office_state) || clean(t.state)).split(",").map((x) => x.trim()).filter(Boolean);
  if (stateCity.length > 1) add(stateCity.join(", ")); // "Noida, Uttar Pradesh"
  return { list: out, state };
}

export async function geocodeTherapist(t) {
  if (/D-?137|choose your therapist/i.test(clean(t.office_address))) return { ...CENTRE };
  const { list, state } = candidates(t);
  for (const q of list) {
    const r = await search(`${q}, India`);
    if (!r || r.addresstype === "state" || r.addresstype === "country") continue;
    const a = r.address || {};
    const place = String(a.city || a.town || a.village || a.suburb || a.state_district || a.county || "").replace(/\s+(Municipal Corporation|Municipality|Nagar Nigam|Tehsil|District)$/i, "");
    return { lat: round(r.lat), lng: round(r.lon), label: labelOf(place, a.state || state), exact: true };
  }
  if (!state) return null;
  const r = await search(`${state}, India`);
  // Delhi and Chandigarh are cities — "Delhi" alone still tells the client how far it is
  const cityState = /^(delhi|new delhi|chandigarh|puducherry)$/i.test(state);
  return r ? { lat: round(r.lat), lng: round(r.lon), label: state, exact: cityState } : { lat: null, lng: null, label: state, exact: false };
}

const inPerson = (t) => /in[- ]?person|offline/i.test(String(t.session_formats || ""));

// fill in / refresh office_area for in-person therapists whose address changed
export async function refreshTherapistAreas() {
  const list = await Therapists.find({}).select("office_address office_city office_state state session_formats office_area").lean();
  let done = 0;
  for (const t of list) {
    if (!inPerson(t)) continue;
    const key = areaKey(t);
    if (t.office_area?.key === key && t.office_area?.at) continue;
    try {
      const g = await geocodeTherapist(t);
      await Therapists.updateOne({ _id: t._id }, { $set: { office_area: { ...(g || { lat: null, lng: null, label: "", exact: false }), key, at: new Date() } } });
      done++;
    } catch (e) {
      console.error(`[therapist-area] ${t._id}: ${e.message}`);
      await sleep(5000);
    }
  }
  return done;
}

let timer = null;
export function startTherapistAreaJob() {
  if (timer) return;
  const tick = async () => { try { const n = await refreshTherapistAreas(); if (n) console.log(`[therapist-area] ${n} updated`); } catch (e) { console.error("[therapist-area] failed:", e.message); } };
  setTimeout(tick, 90000);
  timer = setInterval(tick, 3600000);
}
