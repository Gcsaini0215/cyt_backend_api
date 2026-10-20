/* How one session's payment is shared: the therapist gets 70% of the session amount (what the client
   paid, less the platform fee and clinical-assessment fees), plus their own share of those assessments;
   CYT keeps the rest. Used by Admin → Payouts and everywhere the therapist dashboard counts earnings,
   so both always show the same numbers. Razorpay split payments are to use the same ratio. */

export const THERAPIST_PCT = 70;

export function payoutSplit({ paid = 0, platformFee = 0, assessmentFee = 0, assessmentShare = 0, base: given }) {
  const base = given != null ? Math.max(0, Number(given) || 0) : Math.max(0, paid - platformFee - assessmentFee);
  const therapist = Math.round((base * THERAPIST_PCT) / 100) + Math.round(assessmentShare || 0);
  // CYT's part: the rest of what was paid — for a session valued on its own (a CYT Noida / package session):
  // the rest of that value, plus the platform fee when one was paid with it
  const platform = given != null ? base - therapist + (paid > 0 ? platformFee : 0) : paid - therapist;
  return { base, therapist, platform: Math.max(0, Math.round(platform)), pct: THERAPIST_PCT };
}

const num = (v) => Number(v?.$numberDecimal ?? v?.toString?.() ?? v) || 0;

/* a Booking (with `transaction` populated, or its amount on b.transaction) → { paid, base, therapist, platform, pct }.
   A CYT Noida session counts what the client paid CYT (its Booking itself carries ₹0). Unpaid → all zero. */
export function bookingSplit(b) {
  if (!b) return { paid: 0, ...payoutSplit({}) };
  // an earlier CYT Noida session kept as a record: settled before payouts — nothing to earn or pay
  if (b.noida_legacy) return { paid: Number(b.noida_amount) || 0, base: 0, therapist: 0, platform: 0, pct: THERAPIST_PCT, legacy: true };
  const noida = b.source === "noida";
  const paidOk = /paid/i.test(b.payment_status || "") || !!b.transaction;
  // online: the payment on record — or, for a booking marked paid without one (e.g. paid by QR and confirmed by hand), its fee
  const tx = b.transaction && typeof b.transaction === "object" && "amount" in b.transaction ? num(b.transaction.amount) : null;
  const paid = !paidOk ? 0 : noida ? Number(b.noida_amount) || 0 : tx != null ? tx : num(b.amount);
  // CYT-funded discounts (a friend's referral code, the client's referral credit) don't cut the therapist's share
  const cytFunded = !noida && paidOk ? (Number(b.referral_discount) || 0) + (Number(b.credit_used) || 0) : 0;
  // a CYT Noida session is split on what the session is worth (a package session was paid for with the package)
  const base = paidOk && noida && b.noida_session_value != null ? Number(b.noida_session_value) || 0
    : cytFunded > 0 ? Math.max(0, paid + cytFunded - (Number(b.assessment_fee) || 0)) : undefined;
  return {
    paid,
    ...payoutSplit({
      paid, base, platformFee: noida ? Number(b.noida_fee) || 0 : 0,
      assessmentFee: paid ? Number(b.assessment_fee) || 0 : 0, assessmentShare: paid ? Number(b.assessment_therapist_share) || 0 : 0,
    }),
  };
}
