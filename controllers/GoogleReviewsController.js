import expressAsyncHandler from "express-async-handler";

/* Google Business Profile reviews for the About Us page of the quotation PDF.

   Read straight from Google's Places API (New) — nothing is stored or edited here, so the rating, the review count and
   the review texts are exactly what Google shows. Needs two env values on the server:
     GOOGLE_PLACES_API_KEY  – a Google Cloud API key with "Places API (New)" enabled
     GOOGLE_PLACE_ID        – the Place ID of the Choose Your Therapist business listing
   Without them the endpoint answers { configured: false } and the PDF simply leaves the reviews block out. */

const TTL_MS = 12 * 3600 * 1000; // Google's terms allow short-lived caching; reviews change slowly
const MAX_REVIEWS = 3;
const MIN_TEXT = 40; // skip one-word reviews on a printed page

let cache = null; // { at, data }

const clean = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

const fetchFromGoogle = async (key, placeId) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "displayName,rating,userRatingCount,googleMapsUri,reviews",
        "Accept-Language": "en",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Places API ${res.status}: ${body.slice(0, 200)}`);
    }
    const p = await res.json();
    const reviews = (p.reviews || [])
      .map((r) => ({
        author: clean(r.authorAttribution?.displayName, 60),
        rating: Number(r.rating) || 0,
        text: clean(r.originalText?.text || r.text?.text, 600),
        when: clean(r.relativePublishTimeDescription, 40),
      }))
      .filter((r) => r.rating >= 4 && r.text.length >= MIN_TEXT)
      .slice(0, MAX_REVIEWS);
    return {
      name: clean(p.displayName?.text, 120),
      rating: Number(p.rating) || 0,
      count: Number(p.userRatingCount) || 0,
      url: clean(p.googleMapsUri, 300),
      reviews,
    };
  } finally {
    clearTimeout(timer);
  }
};

/* GET /api/google-reviews  (admin, "quotations" permission) */
export const getGoogleReviews = expressAsyncHandler(async (req, res) => {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;
  if (!key || !placeId) return res.json({ status: true, configured: false, data: null });

  if (cache && Date.now() - cache.at < TTL_MS) return res.json({ status: true, configured: true, data: cache.data });
  try {
    const data = await fetchFromGoogle(key, placeId);
    cache = { at: Date.now(), data };
    return res.json({ status: true, configured: true, data });
  } catch (e) {
    console.error("Google reviews fetch failed:", e.message);
    // an older copy is better than none
    if (cache) return res.json({ status: true, configured: true, stale: true, data: cache.data });
    return res.json({ status: true, configured: true, data: null, error: "Google reviews are unavailable right now" });
  }
});
