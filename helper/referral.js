import Jwt from "jsonwebtoken";
import Users from "../models/Users.js";
import Booking from "../models/Booking.js";
import Coupon from "../models/Coupan.js";
import Referral from "../models/Referral.js";
import { notifyClient } from "../services/clientNotify.js";

// "Give ₹200, get ₹200": a friend's first session is REFERRAL_AMOUNT cheaper, and once they pay
// the client who referred them gets the same amount as credit for their next session.
export const REFERRAL_AMOUNT = 200;

const namePart = (name) => String(name || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) || "CYT";

// The client's own code, e.g. "DEEPAK482" — made on first use, never clashing with a coupon code.
export async function ensureReferralCode(user) {
  if (user.referral_code) return user.referral_code;
  for (let i = 0; i < 8; i++) {
    const code = `${namePart(user.name)}${Math.floor(100 + Math.random() * 900)}`;
    if (await Coupon.exists({ code })) continue;
    try {
      const r = await Users.updateOne({ _id: user._id, referral_code: { $exists: false } }, { $set: { referral_code: code } });
      if (r.modifiedCount) return code;
      const fresh = await Users.findById(user._id).select("referral_code").lean(); // set by a parallel request
      if (fresh?.referral_code) return fresh.referral_code;
    } catch (e) {
      if (e?.code !== 11000) throw e; // taken by someone else — try another number
    }
  }
  throw new Error("Couldn't create a referral code");
}

// No paid session with us yet (a guest who has never booked counts as new).
export async function isNewClient(email) {
  if (!email) return true;
  const u = await Users.findOne({ email: String(email).toLowerCase().trim() }).select("_id").lean();
  if (!u) return true;
  return !(await Booking.exists({ client: u._id, payment_status: "Paid" }));
}

// null → not a referral code. { error } → a referral code that can't be used by this person.
export async function resolveReferral({ code, email }) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  const referrer = await Users.findOne({ referral_code: c, role: 0 }).select("_id name email referral_code").lean();
  if (!referrer) return null;
  const mail = String(email || "").toLowerCase().trim();
  if (mail && referrer.email?.toLowerCase() === mail) return { error: "You can't use your own referral code — share it with a friend instead." };
  if (mail && !(await isNewClient(mail))) return { error: "Referral codes are for a first session with us." };
  return { referrer };
}

// The person applying a code: the signed-in account if there is one, else the email they typed.
export async function applicantEmail(req) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) {
    try {
      const d = Jwt.verify(h.slice(7), process.env.JWT_SECRET, { algorithms: ["HS256"] });
      const u = await Users.findById(d.userId).select("email").lean();
      if (u?.email) return u.email;
    } catch { /* fall through to the typed email */ }
  }
  return req.body?.email || "";
}

// After a booking is paid: take the credit the client spent, and reward whoever referred them.
// Safe to call more than once for the same booking.
export async function settleBookingRewards(booking) {
  const clientId = booking.client?._id || booking.client;
  if (booking.credit_used > 0) {
    const claimed = await Booking.findOneAndUpdate({ _id: booking._id, credit_settled: { $ne: true } }, { $set: { credit_settled: true } });
    if (claimed) {
      await Users.updateOne({ _id: clientId }, [
        { $set: { referral_credit: { $max: [0, { $subtract: [{ $ifNull: ["$referral_credit", 0] }, booking.credit_used] }] } } },
      ]);
    }
  }
  if (booking.referral_code) {
    const referrer = await Users.findOne({ referral_code: booking.referral_code }).select("_id").lean();
    if (!referrer || String(referrer._id) === String(clientId)) return;
    try {
      await Referral.create({ referrer: referrer._id, friend: clientId, booking: booking._id, code: booking.referral_code, amount: REFERRAL_AMOUNT });
      await Users.updateOne({ _id: referrer._id }, { $inc: { referral_credit: REFERRAL_AMOUNT } });
      notifyClient(referrer._id, {
        type: "referral", title: `Your friend booked — ₹${REFERRAL_AMOUNT} credit added`,
        body: "It comes off your next session automatically.", link: "/my-dashboard", ref: `referral:${booking._id}`,
      });
    } catch (e) {
      if (e?.code !== 11000) throw e; // already rewarded for this friend / booking
    }
  }
}
