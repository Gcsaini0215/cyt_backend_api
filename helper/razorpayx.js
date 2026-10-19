import axios from "axios";
import Bank from "../models/Bank.js";
import Users from "../models/Users.js";

/* RazorpayX Payouts: sends a therapist's payout straight to their bank account (IMPS / NEFT) or UPI ID —
   the ones they saved in Settings → Payments. Razorpay Checkout can't do this (it only collects money into
   CYT's account), so Admin → Payouts → "Pay" uses this instead.
   Needs RazorpayX activated on the same Razorpay account (same RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET) and
   RAZORPAYX_ACCOUNT_NUMBER = the RazorpayX business account the money goes out from. The result comes back
   on the webhook (payout.processed → paid, with the UTR) or via "Check status". */

const API = "https://api.razorpay.com/v1";
const auth = () => ({ username: process.env.RAZORPAY_KEY_ID || "", password: process.env.RAZORPAY_KEY_SECRET || "" });
export const razorpayxReady = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAYX_ACCOUNT_NUMBER);
const rzpError = (e) => e?.response?.data?.error?.description || e?.response?.data?.error?.reason || e?.message || "RazorpayX request failed";

// where this therapist is paid (Settings → Payments on their dashboard)
export async function payoutDestination(userId) {
  const [u, bank] = await Promise.all([
    Users.findById(userId).select("name email phone").lean(),
    Bank.findById(userId).select("ac_name ac_number ifsc upi").lean(),
  ]);
  const acct = bank?.ac_number != null && bank.ac_number !== "" ? String(bank.ac_number) : "";
  return {
    name: u?.name || "", email: u?.email || "", phone: u?.phone || "",
    bank: acct && bank?.ifsc ? { name: bank.ac_name || u?.name || "", account: acct, ifsc: String(bank.ifsc).toUpperCase() } : null,
    upi: bank?.upi ? String(bank.upi).trim() : "",
  };
}

/* sends one TherapistPayout. to: "bank" | "upi"; mode: IMPS | NEFT | UPI.
   Returns the fields to save on the payout. Throws with Razorpay's message when it refuses. */
export async function sendRazorpayxPayout(payout, { to, mode }) {
  if (!razorpayxReady()) throw new Error("RazorpayX isn't set up yet — add RAZORPAYX_ACCOUNT_NUMBER on the server (and activate RazorpayX).");
  const dest = await payoutDestination(payout.user);
  if (to === "upi" && !dest.upi) throw new Error("This therapist hasn't added a UPI ID.");
  if (to === "bank" && !dest.bank) throw new Error("This therapist hasn't added bank details (account number + IFSC).");
  try {
    let contactId = payout.rzp_contact_id;
    if (!contactId) {
      const { data } = await axios.post(`${API}/contacts`, {
        name: dest.name || "Therapist", email: dest.email || undefined, contact: /^\d{10}$/.test(dest.phone) ? dest.phone : undefined,
        type: "vendor", reference_id: String(payout.user),
      }, { auth: auth(), timeout: 20000 });
      contactId = data.id;
    }
    const fundBody = to === "upi"
      ? { contact_id: contactId, account_type: "vpa", vpa: { address: dest.upi } }
      : { contact_id: contactId, account_type: "bank_account", bank_account: { name: dest.bank.name, ifsc: dest.bank.ifsc, account_number: dest.bank.account } };
    const { data: fund } = await axios.post(`${API}/fund_accounts`, fundBody, { auth: auth(), timeout: 20000 });
    const { data: p } = await axios.post(`${API}/payouts`, {
      account_number: process.env.RAZORPAYX_ACCOUNT_NUMBER, fund_account_id: fund.id,
      amount: Math.round(Number(payout.amount) * 100), currency: "INR",
      mode: to === "upi" ? "UPI" : (mode === "NEFT" ? "NEFT" : "IMPS"), purpose: "payout",
      queue_if_low_balance: true, reference_id: String(payout._id), narration: "CYT therapist payout",
      notes: { therapist: dest.name, payout: String(payout._id) },
    }, { auth: auth(), timeout: 30000, headers: { "X-Payout-Idempotency": `${payout._id}-${(payout.rzp_attempts || 0) + 1}` } }); // a retry after a failed transfer gets a new key
    return {
      rzp_contact_id: contactId, rzp_fund_account_id: fund.id, rzp_payout_id: p.id, rzp_status: p.status || "processing",
      rzp_mode: p.mode || "", rzp_error: "", rzp_attempts: (payout.rzp_attempts || 0) + 1, method: to === "upi" ? "upi" : "bank",
      ...(p.utr ? { reference: p.utr } : {}),
    };
  } catch (e) {
    throw new Error(rzpError(e));
  }
}

export async function fetchRazorpayxPayout(id) {
  const { data } = await axios.get(`${API}/payouts/${id}`, { auth: auth(), timeout: 20000 });
  return data;
}
