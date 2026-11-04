import FestivalGift from "../models/FestivalGift.js";
import { sendMail } from "./mailer.js";
import { festivalGiftBuyerMail, festivalGiftRecipientMail } from "../services/mailTemplates.js";
import { festivalOffer, giftCode, giftLink, istToday, addDays } from "./festivalOffer.js";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (s, n = 80) => String(s || "").trim().slice(0, n);

// What the recipient fields say, tidied; null when there's nothing usable.
export function giftRecipient({ giftFor, giftName, giftPhone, giftEmail }) {
  if (giftFor === "self") return { forSelf: true };
  if (giftFor !== "gift") return null;
  const name = clean(giftName), phone = String(giftPhone || "").replace(/\D/g, "").slice(-10), email = clean(giftEmail, 120).toLowerCase();
  if (!name) return null;
  return { forSelf: false, recipientName: name, recipientPhone: /^\d{10}$/.test(phone) ? phone : "", recipientEmail: EMAIL_RX.test(email) ? email : "" };
}

export async function mailGiftRecipient(gift) {
  if (!gift.recipientEmail) return;
  const offer = festivalOffer(gift.offer);
  try {
    await sendMail(gift.recipientEmail, `${gift.buyerName.split(" ")[0] || "Someone"} sent you a free therapy session 🪔`,
      `${gift.buyerName} has gifted you a free session with Choose Your Therapist. Book it here: ${giftLink(gift.code)} (before ${gift.validTill}).`,
      festivalGiftRecipientMail({ name: gift.recipientName, from: gift.buyerName, link: giftLink(gift.code), validTill: gift.validTill, offerTitle: offer?.title }));
  } catch (e) { console.error("festival gift: recipient mail failed (non-fatal):", e.message); }
}

// A free session booked with a link was cancelled/deleted before it happened: the link works again.
export const releaseFestivalGift = (appointment) =>
  FestivalGift.updateOne({ _id: appointment.festivalGift, redeemedAppointment: appointment._id }, { $set: { redeemedAppointment: null, redeemedAt: null } }).catch(() => {});

// The paid session of an offer was booked: make its free-session link and tell the buyer (and the recipient, if named).
export async function createGiftForAppointment(appointment, { giftFor, giftName, giftPhone, giftEmail } = {}) {
  const offer = festivalOffer(appointment.offer);
  if (!offer) return null;
  const existing = await FestivalGift.findOne({ buyerAppointment: appointment._id });
  if (existing) return existing;
  const purchasedOn = istToday();
  const recipient = giftRecipient({ giftFor, giftName, giftPhone, giftEmail }) || {};
  let gift = null;
  for (let i = 0; i < 5 && !gift; i++) {
    try {
      gift = await FestivalGift.create({
        code: giftCode(), offer: offer.key, buyerAppointment: appointment._id,
        buyerName: appointment.name, buyerPhone: appointment.phone, buyerEmail: String(appointment.email || "").toLowerCase(),
        purchasedOn, validTill: addDays(purchasedOn, offer.validDays),
        ...recipient, giftedAt: recipient.recipientName ? new Date() : null,
      });
    } catch (e) {
      if (e?.code !== 11000) throw e;
      if (await FestivalGift.exists({ buyerAppointment: appointment._id })) return FestivalGift.findOne({ buyerAppointment: appointment._id });
    }
  }
  if (!gift) return null;
  appointment.festivalGift = gift._id;
  await appointment.save().catch(() => {});

  if (gift.buyerEmail) {
    try {
      await sendMail(gift.buyerEmail, `Your free ${offer.title} session link 🪔`,
        `Your session is booked. Your free session link: ${giftLink(gift.code)} — use it yourself or gift it, before ${gift.validTill}.`,
        festivalGiftBuyerMail({ name: gift.buyerName, link: giftLink(gift.code), validTill: gift.validTill, recipientName: gift.recipientName, offerTitle: offer.title }));
    } catch (e) { console.error("festival gift: buyer mail failed (non-fatal):", e.message); }
  }
  await mailGiftRecipient(gift);
  return gift;
}
