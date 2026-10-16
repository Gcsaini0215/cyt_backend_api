import expressAsyncHandler from "express-async-handler";
import AssessmentPricing from "../models/AssessmentPricing.js";
import { TEST_BY_KEY, FREE_TESTS } from "../helper/assessmentTests.js";
import { getPricing, clearPricingCache } from "../helper/assessmentPricing.js";

const money = (v) => (v === "" || v == null ? null : Math.round(Number(v)));
const date = (v) => (v ? new Date(v) : null);
const bad = (res, message) => res.status(400).json({ status: false, message });

// GET /assessment-pricing — public: what clients and therapists pay right now
export const publicPricing = expressAsyncHandler(async (req, res) => {
  const p = await getPricing();
  const tests = Object.fromEntries(Object.entries(p.tests).map(([k, t]) => [k, { fee: t.fee, price: t.price, offer: t.offer, offerLabel: t.offerLabel, offerTill: t.offer ? t.offerTill : null, active: t.active }]));
  res.json({ status: true, data: { tests, addon: { fee: p.addon.fee, price: p.addon.price, offer: p.addon.offer, offerLabel: p.addon.offerLabel, offerTill: p.addon.offer ? p.addon.offerTill : null } } });
});

// GET /admin/assessment-pricing — everything, for the admin editor
export const adminPricing = expressAsyncHandler(async (req, res) => {
  const p = await getPricing();
  res.json({ status: true, data: { ...p, catalog: FREE_TESTS.map((t) => ({ key: t.key, short: t.short, title: t.title, full: t.full })) } });
});

// PUT /admin/assessment-pricing { tests: [{tool, fee, offerPrice, offerLabel, offerTill, active}], addonPrice, addonOfferPrice, addonOfferLabel, addonOfferTill, therapistShare }
export const saveAdminPricing = expressAsyncHandler(async (req, res) => {
  const b = req.body || {};
  const tests = [];
  for (const t of Array.isArray(b.tests) ? b.tests : []) {
    if (!TEST_BY_KEY[t.tool]) return bad(res, `Unknown test: ${t.tool}`);
    const fee = money(t.fee), offerPrice = money(t.offerPrice);
    if (fee == null || !Number.isFinite(fee) || fee < 0 || fee > 50000) return bad(res, `Enter a valid fee for ${TEST_BY_KEY[t.tool].short}.`);
    if (offerPrice != null && (!Number.isFinite(offerPrice) || offerPrice < 0 || offerPrice >= fee)) return bad(res, `The offer price for ${TEST_BY_KEY[t.tool].short} must be lower than its fee.`);
    const offerTill = date(t.offerTill);
    if (offerTill && Number.isNaN(offerTill.getTime())) return bad(res, "Invalid offer end date.");
    tests.push({ tool: t.tool, fee, offerPrice, offerLabel: String(t.offerLabel || "").trim().slice(0, 40), offerTill, active: t.active !== false });
  }
  const addonPrice = money(b.addonPrice), addonOfferPrice = money(b.addonOfferPrice);
  if (addonPrice == null || addonPrice < 0 || addonPrice > 100000) return bad(res, "Enter a valid add-on price.");
  if (addonOfferPrice != null && (addonOfferPrice < 1 || addonOfferPrice >= addonPrice)) return bad(res, "The add-on offer must be at least ₹1 and lower than its price.");
  const share = Number(b.therapistShare);
  if (!Number.isFinite(share) || share < 0 || share > 1) return bad(res, "Therapist share must be between 0% and 100%.");

  await AssessmentPricing.updateOne({ key: "default" }, {
    $set: {
      tests, addonPrice, addonOfferPrice, addonOfferLabel: String(b.addonOfferLabel || "").trim().slice(0, 40), addonOfferTill: date(b.addonOfferTill),
      therapistShare: share, updatedBy: req.user?.email || req.user?.name || "",
    },
  }, { upsert: true });
  clearPricingCache();
  res.json({ status: true, message: "Prices saved.", data: await getPricing() });
});
