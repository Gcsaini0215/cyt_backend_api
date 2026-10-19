/* Collaboration / outreach emails sent from the admin panel (Outreach Email page).
   One HTML builder for both the live preview and the real email, so what the admin sees is what goes out.
   Table layout + inline styles only (Gmail, Outlook, Apple Mail); images are absolute URLs on the live site
   (JPG, not WebP — Outlook can't show WebP). Every value typed in the admin is escaped. */

const SITE = "https://www.chooseyourtherapist.in";
export const LOGO_URL = `${SITE}/cyt-emblem.png`;

export const COMPANY = {
  name: "Choose Your Therapist LLP",
  address: "D-137, Block D, Sector 51, Noida, Uttar Pradesh 201301, India",
  phone: "+91 80777 57951",
  email: "hello@chooseyourtherapist.in",
  website: "www.chooseyourtherapist.in",
  llpin: "AAX-8113",
  hfr: "IN0510005384",
};

export const BANNERS = {
  college: { url: `${SITE}/assets/img/email/college.jpg`, label: "Student online session" },
  corporate: { url: `${SITE}/assets/img/email/corporate.jpg`, label: "Consultation" },
  community: { url: `${SITE}/assets/img/email/community.jpg`, label: "Counselling conversation" },
  clinic: { url: `${SITE}/assets/img/email/clinic.jpg`, label: "Therapy session" },
  general: { url: `${SITE}/assets/img/email/general.jpg`, label: "Calm therapy room" },
  none: { url: "", label: "No banner" },
};

/* Ready-made emails. {org} = the organisation's name (or "your organisation"). Everything is editable. */
export const PRESETS = {
  college: {
    label: "College / University",
    banner: "college",
    subject: "Collaboration proposal: mental health support for {org} students",
    headline: "Supporting student wellbeing at {org}",
    intro: "I am writing from Choose Your Therapist, a registered mental health platform with verified psychologists across India. We would love to partner with {org} to make professional, confidential support easy for your students and staff.",
    body: "Students today juggle exams, placements, relationships and life away from home. A small, well-planned programme — awareness talks, a few counselling slots and simple self-screening — can make a real difference to how supported they feel.\n\nWe can shape the programme around your academic calendar and budget, and we are happy to begin with a single workshop so you can see how it works.",
    offerTitle: "What we can offer",
    offers: [
      "Interactive workshops on stress, exam anxiety and emotional wellbeing",
      "Confidential one-to-one counselling with verified psychologists — online or on campus",
      "Screening camps using standard tools, with a clear referral pathway",
      "Training for faculty and mentors on spotting early signs and responding with care",
    ],
    ctaText: "Schedule a 15-minute call",
  },
  corporate: {
    label: "Corporate wellness",
    banner: "corporate",
    subject: "Employee wellbeing partnership with {org}",
    headline: "Healthier, happier teams at {org}",
    intro: "I am writing from Choose Your Therapist, a registered mental health platform. We help organisations give their teams confidential access to qualified psychologists, and we would welcome the chance to support {org}.",
    body: "Workload, deadlines and life outside work all show up at the desk. An employee wellbeing programme gives your people a safe, private place to talk — and gives managers the confidence to support them.\n\nOur programmes are flexible: a single session for a wellness week, or ongoing support for teams across locations.",
    offerTitle: "What we can offer",
    offers: [
      "Confidential counselling sessions for employees, online or in person",
      "Workshops on stress, burnout, work-life balance and resilience",
      "Manager sensitisation on mental health conversations at work",
      "Simple usage summaries for HR — no personal details are ever shared",
    ],
    ctaText: "Book a short call",
  },
  community: {
    label: "NGO / Community",
    banner: "community",
    subject: "Partnering with {org} on community mental health",
    headline: "Bringing mental health support closer to your community",
    intro: "I am writing from Choose Your Therapist, a registered mental health platform with verified psychologists. We admire the work {org} does, and we would like to explore how we could support the people you serve.",
    body: "Many people still find it hard to ask for help, or do not know where to start. Working together, we can make support feel familiar, affordable and close to home.\n\nWe are glad to adapt our sessions to your community's language, schedule and resources.",
    offerTitle: "How we could work together",
    offers: [
      "Awareness sessions in simple, local language",
      "Counselling support for beneficiaries, with options to suit your budget",
      "Support circles for volunteers and caregivers",
      "Referrals to verified psychologists when someone needs more help",
    ],
    ctaText: "Let's talk",
  },
  clinic: {
    label: "Hospital / Clinic",
    banner: "clinic",
    subject: "Psychological care partnership with {org}",
    headline: "Psychological care that works alongside your practice",
    intro: "I am writing from Choose Your Therapist, an HFR-registered mental health platform with verified counselling and clinical psychologists. We would like to explore a referral and care partnership with {org}.",
    body: "Many patients benefit from psychological support alongside medical care — for anxiety, low mood, chronic illness, sleep or recovery. A simple partnership lets your team refer them with confidence and keep care connected.\n\nWe would be glad to share how the referral process works and adapt it to your clinic.",
    offerTitle: "What we can offer",
    offers: [
      "A referral pathway to verified counselling and clinical psychologists",
      "Standard screening tools (PHQ-9, GAD-7 and more) with clear reports",
      "In-person sessions at our Noida centre, and online sessions across India",
      "Joint awareness camps and patient education talks",
    ],
    ctaText: "Schedule a call",
  },
  general: {
    label: "General partnership",
    banner: "general",
    subject: "Exploring a collaboration with {org}",
    headline: "Let's work together on mental wellbeing",
    intro: "I am writing from Choose Your Therapist, a registered mental health platform with verified psychologists across India. I believe there is a meaningful way for us to work together with {org}.",
    body: "We partner with colleges, workplaces, community groups and healthcare providers to make professional mental health support simple to reach.\n\nI would be glad to hear about your plans and share a few ideas that could fit.",
    offerTitle: "Ways we can help",
    offers: [
      "Workshops and awareness sessions",
      "Confidential counselling with verified psychologists",
      "Screening with standard tools and clear next steps",
      "Programmes shaped around your people, schedule and budget",
    ],
    ctaText: "Reply to start a conversation",
  },
};

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fillOrg = (s, org) => String(s ?? "").replace(/\{org\}/g, org);
const paras = (s) => String(s || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const safeUrl = (u) => {
  const v = String(u || "").trim();
  if (/^mailto:[^\s<>"]+$/i.test(v) || /^https?:\/\/[^\s<>"]+$/i.test(v)) return v;
  return "";
};

/* all fields after defaults and {org}; `data` is what the admin form sends */
export function resolveOutreach(data = {}) {
  const preset = PRESETS[data.preset] || PRESETS.general;
  const org = String(data.organisation || "").trim();
  const orgText = org || "your organisation";
  const pick = (k) => (data[k] != null && String(data[k]).trim() !== "" ? data[k] : preset[k]);
  const offers = (Array.isArray(data.offers) ? data.offers : preset.offers).map((o) => String(o || "").trim()).filter(Boolean).slice(0, 8);
  const subject = fillOrg(pick("subject"), orgText).trim().slice(0, 200);
  const replyTo = COMPANY.email;
  const ctaUrl = safeUrl(data.ctaUrl) || `mailto:${replyTo}?subject=${encodeURIComponent(`Re: ${subject}`)}`;
  return {
    subject,
    preheader: fillOrg(pick("intro"), orgText).slice(0, 140),
    banner: BANNERS[data.banner] ? data.banner : preset.banner,
    greeting: String(data.recipientName || "").trim() ? `Dear ${String(data.recipientName).trim()},` : "Dear Sir/Madam,",
    headline: fillOrg(pick("headline"), orgText),
    intro: fillOrg(pick("intro"), orgText),
    body: paras(fillOrg(pick("body"), orgText)),
    offerTitle: fillOrg(pick("offerTitle"), orgText),
    offers: offers.map((o) => fillOrg(o, orgText)),
    ctaText: fillOrg(pick("ctaText"), orgText),
    ctaUrl,
    closing: String(data.closing || "").trim() || "Warm regards,",
    senderName: String(data.senderName || "").trim() || "Deepak Kumar",
    senderTitle: String(data.senderTitle || "").trim() || "Founder & Director",
    senderPhone: String(data.senderPhone || "").trim() || COMPANY.phone,
    org: orgText,
  };
}

const G = "#14532d", G2 = "#166534", GOLD = "#c9962c", INK = "#1e293b", MUT = "#64748b", BG = "#eef3ef";

export function buildOutreachHtml(data) {
  const r = resolveOutreach(data);
  const banner = BANNERS[r.banner];
  const P = (t, extra = "") => `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:${INK};${extra}">${esc(t)}</p>`;
  const offers = r.offers.map((o) => `
          <tr>
            <td width="30" valign="top" style="padding:5px 0;">
              <div style="width:20px;height:20px;border-radius:10px;background:${G2};color:#ffffff;font-size:12px;font-weight:bold;line-height:20px;text-align:center;">&#10003;</div>
            </td>
            <td valign="top" style="padding:5px 0;font-size:14.5px;line-height:1.55;color:${INK};">${esc(o)}</td>
          </tr>`).join("");
  const facts = ["Verified psychologists", "Online &amp; in-person", "HFR registered (ABDM)"]
    .map((f) => `<td align="center" style="padding:10px 6px;font-size:12.5px;font-weight:bold;color:${G};">${f}</td>`).join(`<td width="1" style="background:#d9e8de;"></td>`);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<title>${esc(r.subject)}</title>
<style>
  @media (max-width:620px){ .wrap{width:100%!important} .px{padding-left:20px!important;padding-right:20px!important} .h1{font-size:23px!important} .stack td{display:block!important;width:100%!important} .facts td[width="1"]{display:none!important} .hide-m{display:none!important} }
  a{color:${G2}}
</style></head>
<body style="margin:0;padding:0;background:${BG};font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG};">${esc(r.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(20,83,45,.10);">

    <!-- top bar -->
    <tr><td class="px" style="padding:18px 32px;border-bottom:3px solid ${GOLD};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle" width="48"><img src="${LOGO_URL}" width="42" height="42" alt="Choose Your Therapist" style="display:block;border:0;"></td>
        <td valign="middle" style="padding-left:10px;">
          <div style="font-size:16px;font-weight:bold;letter-spacing:.6px;color:${G};">CHOOSE YOUR THERAPIST</div>
          <div style="font-size:11.5px;color:${MUT};margin-top:2px;">Your Mental Health, Our Priority</div>
        </td>
        <td valign="middle" align="right" class="hide-m" style="font-size:11.5px;color:${MUT};"><a href="https://${COMPANY.website}" style="color:${G2};text-decoration:none;font-weight:bold;">${COMPANY.website}</a></td>
      </tr></table>
    </td></tr>

    ${banner.url ? `<!-- banner -->
    <tr><td style="padding:0;line-height:0;"><img src="${banner.url}" width="600" alt="${esc(banner.label)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;"></td></tr>` : ""}

    <!-- headline band -->
    <tr><td class="px" style="padding:26px 32px 6px;">
      <div style="font-size:11.5px;font-weight:bold;letter-spacing:1.4px;color:${GOLD};text-transform:uppercase;margin-bottom:6px;">Collaboration proposal</div>
      <h1 class="h1" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1.25;color:${G};font-weight:bold;">${esc(r.headline)}</h1>
    </td></tr>

    <!-- message -->
    <tr><td class="px" style="padding:18px 32px 4px;">
      ${P(r.greeting, "font-weight:bold;")}
      ${P(r.intro)}
      ${r.body.map((b) => P(b)).join("")}
    </td></tr>

    ${r.offers.length ? `<!-- offer card -->
    <tr><td class="px" style="padding:6px 32px 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f9f5;border:1px solid #d6eadc;border-left:4px solid ${GOLD};border-radius:12px;">
        <tr><td style="padding:18px 20px 12px;">
          <div style="font-size:16px;font-weight:bold;color:${G};margin-bottom:8px;">${esc(r.offerTitle)}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${offers}
          </table>
        </td></tr>
      </table>
    </td></tr>` : ""}

    <!-- facts -->
    <tr><td class="px" style="padding:14px 32px 4px;">
      <table role="presentation" class="facts" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #d9e8de;border-radius:10px;"><tr class="stack">${facts}</tr></table>
    </td></tr>

    <!-- call to action -->
    <tr><td align="center" class="px" style="padding:24px 32px 10px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td align="center" bgcolor="${G}" style="border-radius:10px;">
          <a href="${esc(r.ctaUrl)}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(r.ctaText)} &rarr;</a>
        </td>
      </tr></table>
      <div style="font-size:12.5px;color:${MUT};margin-top:10px;">or simply reply to this email</div>
    </td></tr>

    <!-- signature -->
    <tr><td class="px" style="padding:20px 32px 28px;">
      ${P(r.closing, "margin-bottom:6px;")}
      <div style="font-size:16px;font-weight:bold;color:${INK};">${esc(r.senderName)}</div>
      <div style="font-size:13.5px;color:${MUT};margin-top:2px;">${esc(r.senderTitle)}, ${COMPANY.name}</div>
      <div style="font-size:13.5px;color:${MUT};margin-top:6px;">
        <a href="tel:${esc(r.senderPhone.replace(/[^\d+]/g, ""))}" style="color:${G2};text-decoration:none;">${esc(r.senderPhone)}</a>
        &nbsp;&middot;&nbsp; <a href="mailto:${COMPANY.email}" style="color:${G2};text-decoration:none;">${COMPANY.email}</a>
      </div>
    </td></tr>

    <!-- footer -->
    <tr><td style="background:${G};padding:0;">
      <div style="height:3px;background:${GOLD};line-height:3px;font-size:0;">&nbsp;</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="px" align="center" style="padding:22px 32px 20px;">
        <img src="${LOGO_URL}" width="34" height="34" alt="" style="display:block;margin:0 auto 8px;border:0;background:#ffffff;border-radius:17px;padding:3px;">
        <div style="font-size:14px;font-weight:bold;letter-spacing:.6px;color:#ffffff;">CHOOSE YOUR THERAPIST LLP</div>
        <div style="font-size:12px;line-height:1.6;color:#cfe5d6;margin-top:6px;">${esc(COMPANY.address)}</div>
        <div style="font-size:12px;line-height:1.6;margin-top:4px;">
          <a href="tel:+918077757951" style="color:#ffffff;text-decoration:none;">${COMPANY.phone}</a>
          <span style="color:#86b597;">&nbsp;&middot;&nbsp;</span><a href="mailto:${COMPANY.email}" style="color:#ffffff;text-decoration:none;">${COMPANY.email}</a>
          <span style="color:#86b597;">&nbsp;&middot;&nbsp;</span><a href="https://${COMPANY.website}" style="color:#ffffff;text-decoration:none;">${COMPANY.website}</a>
        </div>
        <div style="font-size:11px;color:#9fc7ad;margin-top:10px;">LLPIN: ${COMPANY.llpin} &nbsp;&middot;&nbsp; HFR ID: ${COMPANY.hfr}</div>
      </td></tr></table>
    </td></tr>
  </table>

  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;"><tr><td class="px" align="center" style="padding:14px 32px 0;font-size:11px;line-height:1.6;color:#8a978f;">
    You are receiving this one-time email because we would like to work with ${esc(r.org)}.
    If you would rather not hear from us, just reply &ldquo;No thanks&rdquo; and we will not write again.
  </td></tr></table>
</td></tr>
</table>
</body></html>`;
}

// plain-text version for clients that do not show HTML (also helps deliverability)
export function buildOutreachText(data) {
  const r = resolveOutreach(data);
  return [
    r.greeting, "", r.intro, "", ...r.body.flatMap((b) => [b, ""]),
    r.offers.length ? `${r.offerTitle}:` : "", ...r.offers.map((o) => `- ${o}`), "",
    `${r.ctaText}: reply to this email or write to ${COMPANY.email}`, "",
    r.closing, r.senderName, `${r.senderTitle}, ${COMPANY.name}`, `${r.senderPhone} | ${COMPANY.email}`, "",
    `${COMPANY.name} · ${COMPANY.address}`, `${COMPANY.website} · LLPIN ${COMPANY.llpin} · HFR ID ${COMPANY.hfr}`,
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}
