import expressAsyncHandler from "express-async-handler";
import FestivalGift from "../models/FestivalGift.js";
import NoidaAppointment from "../models/NoidaAppointment.js";
import { getOrCreatePricing } from "./NoidaPricingController.js";
import { finalizeNoidaBooking, slotUnavailableReason } from "./NoidaAppointmentController.js";
import { noPreferenceTherapist } from "../helper/noidaBookingSync.js";
import { festivalOffer, CURRENT_FESTIVAL_OFFER, offerDateProblem, istToday, addDays, giftLink } from "../helper/festivalOffer.js";
import { giftRecipient, mailGiftRecipient } from "../helper/festivalGift.js";

/* Festival "book 1, get 1 free" (/festival-therapy). The paid session goes through the normal Noida
   pay-first flow with `offer` set (NoidaAppointmentController); this file serves the offer's rules and
   everything about the free session's link. */

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE_RX = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const normCode = (c) => String(c || "").trim().toUpperCase();
const CLAIM_STALE_MS = 2 * 60 * 1000;

// Public: the running offer, its rules and today's prices.
export const getFestivalOffer = expressAsyncHandler(async (req, res) => {
  const offer = festivalOffer(req.query.offer || CURRENT_FESTIVAL_OFFER);
  if (!offer) return res.status(404).json({ status: false, message: "No such offer." });
  const p = await getOrCreatePricing();
  const today = istToday();
  return res.json({
    status: true,
    data: {
      key: offer.key, title: offer.title, bookBy: offer.bookBy, blockedDates: offer.blockedDates, validDays: offer.validDays, formats: offer.formats,
      today, open: today <= offer.bookBy, lastSessionDate: addDays(today, offer.validDays),
      prices: { "in-person": Number(p.individual_inperson) || 0, online: Number(p.individual_online) || 0, platformFee: Number(p.platformFee) || 0 },
    },
  });
});

const publicGift = (g, appt) => {
  const offer = festivalOffer(g.offer);
  const today = istToday();
  return {
    code: g.code, link: giftLink(g.code), offer: g.offer, offerTitle: offer?.title || "Festival offer",
    blockedDates: offer?.blockedDates || [], formats: offer?.formats || ["in-person", "online"],
    purchasedOn: g.purchasedOn, validTill: g.validTill, today, expired: today > g.validTill,
    from: g.buyerName, forSelf: g.forSelf,
    // the link holder books with these filled in (the buyer, if it's for them)
    prefill: g.forSelf ? { name: g.buyerName, phone: g.buyerPhone, email: g.buyerEmail } : { name: g.recipientName, phone: g.recipientPhone, email: g.recipientEmail },
    recipientName: g.recipientName, giftedAt: g.giftedAt,
    redeemed: appt ? { date: appt.date, slot: appt.slot, format: appt.format, name: appt.name } : null,
  };
};

// Public (the code is the secret): what this free-session link is.
export const getFestivalGift = expressAsyncHandler(async (req, res) => {
  const code = normCode(req.params.code);
  const g = CODE_RX.test(code) ? await FestivalGift.findOne({ code }).lean() : null;
  if (!g) return res.status(404).json({ status: false, message: "This link isn't valid. Please check it, or WhatsApp us." });
  const appt = g.redeemedAppointment ? await NoidaAppointment.findById(g.redeemedAppointment).select("date slot format name").lean() : null;
  return res.json({ status: true, data: publicGift(g, appt) });
});

// Public: the buyer says who the free session is for (themselves, or someone — who is then emailed).
export const setFestivalGiftRecipient = expressAsyncHandler(async (req, res) => {
  const code = normCode(req.params.code);
  const g = CODE_RX.test(code) ? await FestivalGift.findOne({ code }) : null;
  if (!g) return res.status(404).json({ status: false, message: "This link isn't valid." });
  if (g.redeemedAppointment) return res.status(409).json({ status: false, message: "This free session has already been booked." });
  const r = giftRecipient(req.body || {});
  if (!r) return res.status(400).json({ status: false, message: "Please enter the name of the person you're gifting it to." });
  const emailChanged = !r.forSelf && r.recipientEmail && r.recipientEmail !== g.recipientEmail;
  Object.assign(g, r.forSelf
    ? { forSelf: true, recipientName: "", recipientPhone: "", recipientEmail: "", giftedAt: null }
    : { ...r, giftedAt: new Date() });
  await g.save();
  if (emailChanged) await mailGiftRecipient(g);
  return res.json({ status: true, data: publicGift(g.toObject(), null), emailed: !!emailChanged });
});

// Public: book the free session with the link (₹0, same slots as the Noida page, Deepak Kumar).
export const bookFestivalGift = expressAsyncHandler(async (req, res) => {
  const code = normCode(req.params.code);
  const { name, phone, email, age, concern, date, slot, format } = req.body || {};
  const g0 = CODE_RX.test(code) ? await FestivalGift.findOne({ code }).lean() : null;
  if (!g0) return res.status(404).json({ status: false, message: "This link isn't valid." });
  const offer = festivalOffer(g0.offer);
  if (g0.redeemedAppointment) return res.status(409).json({ status: false, message: "This free session has already been booked." });
  const today = istToday();
  if (today > g0.validTill) return res.status(400).json({ status: false, message: "Sorry, this free session link has expired." });
  if (!String(name || "").trim()) return res.status(400).json({ status: false, message: "Please enter the name of the person attending." });
  if (!/^\d{10}$/.test(String(phone || "").trim())) return res.status(400).json({ status: false, message: "Please enter a valid 10-digit phone number." });
  if (!EMAIL_RX.test(String(email || "").trim())) return res.status(400).json({ status: false, message: "Please enter an email — it's the login to see this booking." });
  if (!offer?.formats.includes(format)) return res.status(400).json({ status: false, message: "Please choose in-person or online." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || !String(slot || "").trim()) return res.status(400).json({ status: false, message: "Please pick a date and time." });
  const dateProblem = date > g0.validTill
    ? `This free session has to be on or before ${g0.validTill}. Please pick an earlier date.`
    : offerDateProblem({ ...offer, validDays: 400 }, date, today);
  if (dateProblem) return res.status(400).json({ status: false, message: dateProblem });

  const therapistId = await noPreferenceTherapist();
  const blocked = await slotUnavailableReason({ date, slot: slot.trim(), type: "new", phone: phone.trim(), therapistId });
  if (blocked) return res.status(blocked.status).json({ status: false, message: blocked.message, slotTaken: blocked.status === 409 });

  // one booking per link, even if it's sent twice at once
  const gift = await FestivalGift.findOneAndUpdate(
    { _id: g0._id, redeemedAppointment: null, $or: [{ claiming: false }, { updatedAt: { $lt: new Date(Date.now() - CLAIM_STALE_MS) } }] },
    { $set: { claiming: true } }, { new: true }
  );
  if (!gift) return res.status(409).json({ status: false, message: "This free session is already being booked. Please refresh in a minute." });
  try {
    const appointment = await finalizeNoidaBooking({
      name, phone: phone.trim(), email: email.trim(), concern, age, date, slot: slot.trim(), type: "new",
      sessionMode: "individual", format, therapistId, gift, paymentMethod: "credit",
    });
    await FestivalGift.updateOne({ _id: gift._id }, { $set: { claiming: false, redeemedAppointment: appointment._id, redeemedAt: new Date() } });
    return res.status(201).json({ status: true, message: "Your free session is booked.", data: { date: appointment.date, slot: appointment.slot, format: appointment.format, name: appointment.name } });
  } catch (err) {
    await FestivalGift.updateOne({ _id: gift._id }, { $set: { claiming: false } });
    return res.status(err.status || 500).json({ status: false, message: err.message || "Could not book. Please try again.", slotTaken: err.status === 409 });
  }
});

// Client (logged in): free-session links they bought or were gifted — for My Space.
export const myFestivalGifts = expressAsyncHandler(async (req, res) => {
  const email = String(req.user.email || "").toLowerCase();
  const phone = String(req.user.phone || "").replace(/\D/g, "").slice(-10);
  const or = [];
  if (email) or.push({ buyerEmail: email }, { recipientEmail: email });
  if (/^\d{10}$/.test(phone)) or.push({ buyerPhone: phone }, { recipientPhone: phone });
  if (!or.length) return res.json({ status: true, data: [] });
  const rows = await FestivalGift.find({ $or: or }).sort({ _id: -1 }).limit(10).lean();
  const appts = await NoidaAppointment.find({ _id: { $in: rows.map((r) => r.redeemedAppointment).filter(Boolean) } }).select("date slot format name").lean();
  const byId = new Map(appts.map((a) => [String(a._id), a]));
  const data = rows.map((g) => {
    const mine = (email && g.buyerEmail === email) || (phone && g.buyerPhone === phone);
    return { ...publicGift(g, g.redeemedAppointment ? byId.get(String(g.redeemedAppointment)) : null), role: mine ? "bought" : "received" };
  });
  return res.json({ status: true, data });
});
