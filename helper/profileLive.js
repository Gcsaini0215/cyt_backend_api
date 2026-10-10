import Therapists from "../models/Therapists.js";
import Users from "../models/Users.js";
import { sendMail } from "./mailer.js";
import { therapistProfileLiveMail } from "../services/mailTemplates.js";

const SITE = "https://www.chooseyourtherapist.in";

// "You're live — here's your public link": sent the first time a profile shows on the website,
// whichever way it went live (admin toggle, therapist's own toggle, payment, free package).
// The claim is atomic so two triggers at once still send one mail; a failed send is retried next time.
export async function mailProfileLiveOnce(therapistId) {
  try {
    const t = await Therapists.findOneAndUpdate(
      { _id: therapistId, show_to_page: { $in: [1, true] }, profile_live_mailed_at: null },
      { $set: { profile_live_mailed_at: new Date() } },
      { new: true }
    ).select("user").lean();
    if (!t) return;
    const u = await Users.findById(t.user).select("name email").lean();
    if (!u?.email) return;
    const link = `${SITE}/view-profile/${t._id}`; // the site 301s this to the SEO profile URL
    const ok = await sendMail(u.email, "You're live on Choose Your Therapist — your public profile link",
      `Your profile is live: ${link}`, therapistProfileLiveMail({ name: u.name, link }), "Choose Your Therapist");
    if (!ok) await Therapists.updateOne({ _id: t._id }, { $set: { profile_live_mailed_at: null } });
  } catch (err) {
    console.error("profile-live mail failed:", err.message);
  }
}
