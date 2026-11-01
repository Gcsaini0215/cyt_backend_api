import crypto from "crypto";
import ProbonoSession from "../models/ProbonoSession.js";
import { isNewClient } from "./referral.js";

// The coupon a client gets after their free session: for the first paid session, with any therapist, for a
// limited time. CYT funds it (booked as referral_discount, so the therapist's share is untouched).
export const PROBONO_COUPON_AMOUNT = 200;
export const PROBONO_COUPON_DAYS = 30;

export const phoneKey = (p) => String(p || "").replace(/\D/g, "").slice(-10);

export const couponActive = (s, now = new Date()) => !!s?.coupon_code && !s.coupon_used_at && new Date(s.coupon_expires_at) > now;

export async function issueCoupon(sessionId) {
  const expires = new Date(Date.now() + PROBONO_COUPON_DAYS * 86400000);
  for (let i = 0; i < 6; i++) {
    const code = `FIRST${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    try {
      return await ProbonoSession.findOneAndUpdate(
        { _id: sessionId, coupon_code: { $exists: false } },
        { $set: { coupon_code: code, coupon_amount: PROBONO_COUPON_AMOUNT, coupon_expires_at: expires } },
        { new: true }
      );
    } catch (e) {
      if (e?.code !== 11000) throw e; // that code exists — try another
    }
  }
  throw new Error("Couldn't create a coupon code");
}

// null → not one of these coupons. { error } → it is, but this person can't use it. Only its owner can.
export async function resolveProbonoCoupon({ code, email }) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  const s = await ProbonoSession.findOne({ coupon_code: c }).lean();
  if (!s) return null;
  const mail = String(email || "").toLowerCase().trim();
  if (!mail) return { error: "Please sign in to use this coupon." };
  if (s.email !== mail) return { error: "This coupon belongs to another account." };
  if (s.coupon_used_at) return { error: "This coupon has already been used." };
  if (new Date(s.coupon_expires_at) <= new Date()) return { error: "This coupon has expired." };
  if (!(await isNewClient(mail))) return { error: "This coupon is for your first paid session." };
  return { session: s, amount: s.coupon_amount };
}

// after the booking is paid; safe to call more than once
export const settleProbonoCoupon = (booking) => ProbonoSession.updateOne(
  { _id: booking.probono_session, coupon_used_at: null },
  { $set: { coupon_used_at: new Date(), coupon_booking: booking._id } }
);
