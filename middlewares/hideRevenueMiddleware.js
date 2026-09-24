// Revenue is for the Super Admin only. A team member (an admin who has been given a Role) still
// gets every operational field — who, when, which slot, paid / pending — but the rupee figures are
// removed from the API response itself, so hiding them can't be undone from the browser's dev tools.
// A Super Admin is an admin with no role (see hasPermission in authMiddleware.js).
//
// Use it AFTER hasPermission(...) so req.user is loaded.

const MONEY_KEYS = new Set([
  "amount",              // what a booking was charged
  "platformFee",
  "discountAmount",      // coupon discount, in rupees
  "todayRevenue",        // desk summary strip
  "todayRevenueByMethod",
  "income7",             // "last 7 days collected" on the appointments page
]);

// Rebuilds JSON-safe data without the money keys. Documents/ObjectIds/Dates go through their own
// toJSON first, so only plain objects and arrays are ever walked.
const strip = (value) => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(strip);
  if (typeof value.toJSON === "function") {
    const json = value.toJSON();
    return json !== null && typeof json === "object" ? strip(json) : json;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!MONEY_KEYS.has(k)) out[k] = strip(v);
  }
  return out;
};

export const isSuperAdminReq = (req) => !!req.user && !req.user.roleId;

export const hideRevenueForTeam = (req, res, next) => {
  if (req.user && req.user.roleId) {
    const send = res.json.bind(res);
    res.json = (body) => send(strip(body));
  }
  next();
};
