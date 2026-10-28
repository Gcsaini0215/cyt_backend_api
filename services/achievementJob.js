import Therapists from "../models/Therapists.js";
import Users from "../models/Users.js";
import { achievementsFor } from "../helper/achievements.js";
import { notifyTherapists } from "./therapistNotify.js";
import { sendMail } from "../helper/mailer.js";
import { achievementUnlockedMail } from "./mailTemplates.js";

/* Achievements are unlocked here too (not only when a therapist opens the page): every 6 hours each listed
   therapist's numbers are checked, and whatever they newly reached is saved and announced once — a portal
   notification per achievement and one email listing them. */
const EVERY_MS = 6 * 3600000;
const SITE = "https://www.chooseyourtherapist.in";
let timer = null;

export async function runAchievementJob() {
  const list = await Therapists.find({}).select("_id user createdAt").lean();
  let announced = 0;
  for (const t of list) {
    try {
      const { fresh } = await achievementsFor(t);
      if (!fresh.length) continue;
      for (const a of fresh) {
        notifyTherapists([t.user], {
          type: "achievement", title: `Achievement unlocked: ${a.title}`,
          body: `Awarded ${a.line}. Your certificate is ready.`, link: "/therapists/achievements", ref: `achievement:${a.code}`,
        });
      }
      const u = await Users.findById(t.user).select("name email").lean();
      if (u?.email) {
        const html = achievementUnlockedMail({ firstName: String(u.name || "").trim().split(/\s+/)[0], items: fresh, link: `${SITE}/therapists/achievements` });
        await sendMail(u.email, fresh.length > 1 ? `You unlocked ${fresh.length} achievements on CYT` : `Achievement unlocked: ${fresh[0].title}`,
          `Congratulations! You earned: ${fresh.map((a) => a.title).join(", ")}. See your certificates: ${SITE}/therapists/achievements`, html);
      }
      announced += fresh.length;
    } catch (e) {
      console.error(`[achievements] ${t._id}: ${e.message}`);
    }
  }
  if (announced) console.log(`[achievements] ${announced} unlocked`);
  return announced;
}

export function startAchievementJob() {
  if (timer) return;
  const tick = async () => { try { await runAchievementJob(); } catch (e) { console.error("[achievements] failed:", e.message); } };
  setTimeout(tick, 4 * 60000);
  timer = setInterval(tick, EVERY_MS);
}
