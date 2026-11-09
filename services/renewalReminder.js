import Therapists from "../models/Therapists.js";
import "../models/Users.js";
import { sendMail } from "../helper/mailer.js";
import { therapistRenewalMail } from "./mailTemplates.js";
import { profileInsights } from "../helper/profileStats.js";

/* Paid listing plan ending / ended — automatic emails to the therapist (never to free listings).
     7, 3 and 1 day(s) before the end date  -> one email each
     after it has ended                     -> one email every day until they renew (at most AFTER_DAYS days)
   Their profile is NOT hidden: it stays in the directory; the site only leaves it off the home page.
   Each email carries a PNG advert drawn by the site (/api/renew-card/<id>-<state>.png), put inline.
   Sent in the day only (10 am - 8 pm IST); renewal_mails remembers what went, so nothing repeats. */
export const PAID_PLANS = ["1_month", "3_month", "6_month", "annual"];
const PLAN_LABEL = { "1_month": "monthly", "3_month": "3-month", "6_month": "6-month", annual: "12-month" };
const DAY = 86400000;
export const AFTER_DAYS = 30;
const EVERY_MS = 30 * 60000;
const PER_RUN = 30;
const SITE = (process.env.SITE_URL || "https://www.chooseyourtherapist.in").replace(/\/$/, "");
const CID = "cyt-renew@chooseyourtherapist";
let timer = null;

const fmt = (d, o) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...o });
const istHour = (now) => Number(fmt(now, { hour: "numeric", hour12: false })) % 24;
const istDate = (now) => new Date(new Date(now).getTime() + 330 * 60000).toISOString().slice(0, 10);

// which email (if any) is due for this end date right now
export function renewalStage(expiresAt, now = Date.now()) {
  const exp = new Date(expiresAt).getTime();
  if (!Number.isFinite(exp)) return null;
  const left = exp - now;
  const id = new Date(exp).toISOString();
  if (left > 0) {
    const daysLeft = Math.ceil(left / DAY);
    const stage = daysLeft <= 1 ? "d1" : daysLeft <= 3 ? "d3" : daysLeft <= 7 ? "d7" : null;
    return stage ? { stage, daysLeft, key: `${id}|${stage}` } : null;
  }
  const daysSince = Math.floor(-left / DAY) + 1;
  if (daysSince > AFTER_DAYS) return null;
  return { stage: "after", daysSince, key: `${id}|after|${istDate(now)}` };
}

// the site draws the advert; if it can't, the email still goes without it (overridable in tests)
export const imageSource = {
  async fetch(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`renew-card ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  },
};
export const mailSender = { send: (...a) => sendMail(...a) }; // overridable in tests

export async function runRenewalReminders(now = Date.now(), { ignoreHours = false } = {}) {
  if (!ignoreHours && (istHour(now) < 10 || istHour(now) >= 20)) return 0;
  const list = await Therapists.find({
    subscription_plan: { $in: PAID_PLANS },
    subscription_expires_at: { $gte: new Date(now - AFTER_DAYS * DAY), $lte: new Date(now + 7 * DAY) },
  }).select("_id user subscription_plan subscription_expires_at renewal_mails").populate("user", "name email is_verified").lean();

  let sent = 0;
  for (const t of list) {
    if (sent >= PER_RUN) break;
    const email = t.user?.email;
    if (!email || t.user?.is_verified !== 1) continue;
    const due = renewalStage(t.subscription_expires_at, now);
    if (!due) continue;
    if ((t.renewal_mails || []).some((m) => m.key === due.key)) continue;

    // claim it first so two runs never send the same email
    const claimed = await Therapists.updateOne(
      { _id: t._id, "renewal_mails.key": { $ne: due.key } },
      { $push: { renewal_mails: { $each: [{ key: due.key, at: new Date(now) }], $slice: -60 } } },
    );
    if (!claimed.modifiedCount) continue;

    let stats = null;
    try { stats = (await profileInsights(t._id)).current; } catch { /* stats are a nice-to-have */ }
    const state = due.stage === "after" ? "ended" : "soon";
    const attachments = [];
    try {
      const png = await imageSource.fetch(`${SITE}/api/renew-card/${t._id}-${state}${state === "soon" ? `-${due.daysLeft}` : ""}.png`);
      attachments.push({ filename: "cyt-renew.png", content: png, contentType: "image/png", cid: CID });
    } catch (e) { console.error("[renewal] image:", e.message); }

    const endsOn = fmt(t.subscription_expires_at, { day: "numeric", month: "short", year: "numeric" });
    const html = therapistRenewalMail({
      name: t.user.name, email, stage: due.stage, daysLeft: due.daysLeft, daysSince: due.daysSince, endsOn,
      planLabel: PLAN_LABEL[t.subscription_plan], stats, imageCid: attachments.length ? CID : "",
    });
    const subject = due.stage === "after"
      ? "Your CYT plan has ended - you're off the home page"
      : due.daysLeft <= 1 ? "Your CYT plan ends tomorrow" : `Your CYT plan ends in ${due.daysLeft} days`;
    const text = `${subject}. Your profile stays in the CYT directory, but only therapists with an active plan are shown on the home page. Renew: ${SITE}/therapist-registration?packages=1&email=${encodeURIComponent(email)}`;
    const ok = await mailSender.send(email, subject, text, html, "CYT Team", attachments);
    if (ok) {
      sent++;
      await Therapists.updateOne({ _id: t._id }, {
        $set: { subscription_reminded_at: new Date(now) },
        $push: { subscription_reminders: { $each: [{ template: `auto-renewal-${due.stage}`, at: new Date(now), by: "auto" }], $slice: -50 } },
      });
    } else {
      // not sent: release the claim so the next run tries again
      await Therapists.updateOne({ _id: t._id }, { $pull: { renewal_mails: { key: due.key } } });
    }
  }
  if (sent) console.log(`[renewal] sent ${sent}`);
  return sent;
}

export function startRenewalReminders() {
  if (timer) return;
  const tick = async () => { try { await runRenewalReminders(); } catch (e) { console.error("[renewal] failed:", e.message); } };
  setTimeout(tick, 4 * 60000);
  timer = setInterval(tick, EVERY_MS);
}
