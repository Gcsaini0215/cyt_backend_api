import AssessmentPricing from "../models/AssessmentPricing.js";
import { FREE_TESTS, CLINICAL_FEE, CLINICAL_THERAPIST_SHARE, ADDON_PRICE } from "./assessmentTests.js";

/* Current clinical-assessment prices (admin-set, with defaults), cached for a minute. */

let cache = { at: 0, data: null };
const offerOn = (price, till) => price != null && (!till || new Date(till) > new Date());

export function clearPricingCache() { cache = { at: 0, data: null }; }

export async function getPricing() {
  if (cache.data && Date.now() - cache.at < 60000) return cache.data;
  const doc = await AssessmentPricing.findOne({ key: "default" }).lean();
  const rows = Object.fromEntries((doc?.tests || []).map((t) => [t.tool, t]));
  const tests = {};
  for (const t of FREE_TESTS) {
    const r = rows[t.key] || {};
    const fee = r.fee ?? CLINICAL_FEE;
    const offer = offerOn(r.offerPrice, r.offerTill);
    tests[t.key] = {
      fee, price: offer ? r.offerPrice : fee, offer,
      offerPrice: r.offerPrice ?? null, offerLabel: offer ? r.offerLabel || "" : "", offerTill: r.offerTill || null,
      active: r.active !== false,
    };
  }
  const addonFee = doc?.addonPrice ?? ADDON_PRICE;
  const addonOffer = offerOn(doc?.addonOfferPrice, doc?.addonOfferTill);
  const data = {
    tests,
    addon: { fee: addonFee, price: addonOffer ? doc.addonOfferPrice : addonFee, offer: addonOffer, offerLabel: addonOffer ? doc.addonOfferLabel || "" : "", offerTill: doc?.addonOfferTill || null, offerPrice: doc?.addonOfferPrice ?? null },
    therapistShare: doc?.therapistShare ?? CLINICAL_THERAPIST_SHARE,
    updatedAt: doc?.updatedAt || null,
  };
  cache = { at: Date.now(), data };
  return data;
}
