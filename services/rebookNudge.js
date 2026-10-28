import crypto from "crypto";
import Booking from "../models/Booking.js";
import Users from "../models/Users.js";
import "../models/Therapists.js";
import { sendMail } from "../helper/mailer.js";
import { rebookNudgeMail } from "../services/mailTemplates.js";
import { notifyClient } from "../services/clientNotify.js";

/* "Book your next session" — one email + one portal notification to a client whose latest session
   was completed 8–30 days ago and who hasn't booked anything since. The client's newest such session
   is marked "sent"; older ones (and any where a later booking exists) are marked "skip", so each
   session is looked at once. Sent only in the day (10 am – 8 pm IST). */
const MIN_DAYS = 8;
const MAX_DAYS = 30;
const EVERY_MS = 30 * 60000;
const PER_RUN = 40;
const DAY = 86400000;
const SITE = "https://www.chooseyourtherapist.in";
const API = (process.env.API_PUBLIC_URL || "https://api.chooseyourtherapist.in/api").replace(/\/$/, "");
let timer = null;

export const rebookUnsubToken = (userId) =>
  crypto.createHmac("sha256", process.env.JWT_SECRET || "cyt").update(`rebook-nudge:${userId}`).digest("hex").slice(0, 32);

const fmt = (d, o) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...o });
const istHour = (now) => Number(fmt(now, { hour: "numeric", hour12: false })) % 24;

// same weekday and time as the last session, the first such slot at least a day away (as on the dashboard)
const nextSameSlot = (d, now) => {
  let n = new Date(d).getTime() + 7 * DAY;
  while (n < now + DAY) n += 7 * DAY;
  return new Date(n);
};

const bookLink = (b, at) => {
  const p = new URLSearchParams();
  if (b.service) p.set("svc", b.service);
  if (b.format) p.set("fmt", b.format);
  if (at) p.set("at", at.toISOString());
  p.set("utm_source", "rebook_email");
  return `${SITE}/book/${b.therapist?._id || b.therapist}?${p}`; // /book/<id> 301s to the therapist's slug, keeping the query
};

// a later booking that counts: paid (or a Noida session), not cancelled
const laterBooking = (client, after) => Booking.exists({
  client, booking_date: { $gt: after }, status: { $ne: "Cancelled" },
  $or: [{ payment_status: "Paid" }, { transaction: { $ne: null } }, { source: "noida" }],
});

const mark = (ids, state) => Booking.updateMany({ _id: { $in: ids }, rebook_nudge: "" }, { $set: { rebook_nudge: state, rebook_nudge_at: new Date() } });

export async function runRebookNudges(now = Date.now()) {
  if (istHour(now) < 10 || istHour(now) >= 20) return 0;
  const due = await Booking.find({
    status: "Completed", rebook_nudge: "", source: { $ne: "noida" }, client: { $ne: null },
    booking_date: { $gte: new Date(now - MAX_DAYS * DAY), $lte: new Date(now - MIN_DAYS * DAY) },
  }).select("_id client therapist booking_date service format").sort({ booking_date: -1 }).limit(300).lean();

  // newest completed session per client
  const byClient = new Map();
  for (const b of due) {
    const k = String(b.client);
    if (!byClient.has(k)) byClient.set(k, { latest: b, older: [] });
    else byClient.get(k).older.push(b._id);
  }

  let sent = 0;
  for (const [clientId, { latest: b, older }] of byClient) {
    if (sent >= PER_RUN) break;
    if (older.length) await mark(older, "skip");
    const [user, later] = await Promise.all([
      Users.findById(clientId).select("name email role rebook_nudge_off referral_credit").lean(),
      laterBooking(b.client, b.booking_date),
    ]);
    if (!user?.email || user.role !== 0 || user.rebook_nudge_off || later) { await mark([b._id], "skip"); continue; }
    // claim it first so two runs never send twice
    const claimed = await Booking.findOneAndUpdate({ _id: b._id, rebook_nudge: "" }, { $set: { rebook_nudge: "sent", rebook_nudge_at: new Date() } })
      .populate({ path: "therapist", select: "user", populate: { path: "user", select: "name" } }).lean();
    if (!claimed) continue;
    const therapistName = claimed.therapist?.user?.name || "your therapist";
    const at = nextSameSlot(b.booking_date, now);
    const slotText = fmt(at, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
    const html = rebookNudgeMail({
      firstName: String(user.name || "").trim().split(/\s+/)[0],
      therapistName,
      lastDate: fmt(b.booking_date, { weekday: "short", day: "numeric", month: "short" }),
      slotText,
      bookHref: bookLink(claimed, at),
      otherHref: bookLink(claimed),
      credit: Number(user.referral_credit) || 0,
      unsubscribe: `${API}/rebook-nudge/unsubscribe?id=${clientId}&t=${rebookUnsubToken(clientId)}`,
    });
    const ok = await sendMail(user.email, `Your next session with ${therapistName}`,
      `Hi ${user.name || "there"}, ready for your next session with ${therapistName}? Book here: ${bookLink(claimed, at)}`, html);
    notifyClient(clientId, {
      type: "rebook", ref: String(b._id),
      title: `Ready for your next session with ${therapistName}?`,
      body: `Same time next week — ${slotText} — is a good habit.`,
      link: "/my-dashboard",
    });
    if (ok) sent++;
  }
  if (sent) console.log(`[rebook-nudge] sent ${sent}`);
  return sent;
}

export function startRebookNudges() {
  if (timer) return;
  const tick = async () => { try { await runRebookNudges(); } catch (e) { console.error("[rebook-nudge] failed:", e.message); } };
  setTimeout(tick, 5 * 60000);
  timer = setInterval(tick, EVERY_MS);
}
