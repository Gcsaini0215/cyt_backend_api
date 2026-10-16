/* Every self-check on /self-assessment, in one place: the exact published items and answer options,
   the published scoring, and the reference + licence terms. Do not reword items — each tool is only
   valid (and, for several, only free to use) in its original wording.

   Only tools that are free to use commercially are included (some ask for a citation / copyright line,
   shown with the test). Copyrighted tools (ISI, PSS-10, BDI-II…) are deliberately left out.

   The same file is copied to the backend (cyt_backend_api/helper/assessmentTests.js), which scores
   clinical assessments on the server — keep the two identical. */

const sum = (a, idx) => idx.reduce((t, i) => t + (Number(a[i]) || 0), 0);
const range = (n) => Array.from({ length: n }, (_, i) => i);

const FREQ_2W = [
  { label: "Not at all", value: 0 },
  { label: "Several days", value: 1 },
  { label: "More than half the days", value: 2 },
  { label: "Nearly every day", value: 3 },
];
const GREEN = "#16a34a", YELLOW = "#eab308", ORANGE = "#f97316", DEEP = "#ea580c", RED = "#dc2626", BLUE = "#0284c7";

// ── IPIP-50 (factor = item index % 5) ────────────────────────────────────────────────────────────
const IPIP_REVERSED = new Set([5, 15, 25, 35, 45, 1, 11, 21, 31, 7, 17, 27, 37, 8, 18, 9, 19, 29]);
const IPIP_DIMS = [
  ["extraversion", "Extraversion", 0, "Sociability and comfort with attention. Higher = more outgoing and talkative."],
  ["agreeableness", "Agreeableness", 1, "Warmth and concern for others. Higher = more empathetic and cooperative."],
  ["conscientiousness", "Conscientiousness", 2, "Being organised, prepared and dependable. Higher = more careful and goal-directed."],
  ["neuroticism", "Emotional sensitivity (Neuroticism)", 3, "How strongly stress, worry and mood changes affect you (the reverse of IPIP Emotional Stability)."],
  ["openness", "Openness (Intellect / Imagination)", 4, "Curiosity, imagination and love of ideas. Higher = more imaginative and idea-loving."],
];

// ── DASS-21 subscales (0-based item numbers) and published severity bands (scores ×2) ─────────
const DASS = {
  depression: { label: "Depression", items: [2, 4, 9, 12, 15, 16, 20], cuts: [9, 13, 20, 27] },
  anxiety: { label: "Anxiety", items: [1, 3, 6, 8, 14, 18, 19], cuts: [7, 9, 14, 19] },
  stress: { label: "Stress", items: [0, 5, 7, 10, 11, 13, 17], cuts: [14, 18, 25, 33] },
};
const DASS_BANDS = [["Normal", GREEN], ["Mild", YELLOW], ["Moderate", ORANGE], ["Severe", DEEP], ["Extremely severe", RED]];
const dassBand = (v, cuts) => DASS_BANDS[cuts.findIndex((c) => v <= c) === -1 ? 4 : cuts.findIndex((c) => v <= c)];

// ── Copenhagen Burnout Inventory answer scales ──────────────────────────────────────────────────
const CBI_FREQ = [
  { label: "Always", value: 100 }, { label: "Often", value: 75 }, { label: "Sometimes", value: 50 },
  { label: "Seldom", value: 25 }, { label: "Never / almost never", value: 0 },
];
const CBI_DEGREE = [
  { label: "To a very high degree", value: 100 }, { label: "To a high degree", value: 75 }, { label: "Somewhat", value: 50 },
  { label: "To a low degree", value: 25 }, { label: "To a very low degree", value: 0 },
];
const CBI_FREQ_REV = CBI_FREQ.map((o) => ({ ...o, value: 100 - o.value }));
const cbiBand = (v) => (v >= 100 ? ["Severe burnout", RED] : v >= 75 ? ["High burnout", DEEP] : v >= 50 ? ["Moderate burnout", ORANGE] : ["No burnout", GREEN]);

// ── AUDIT answer scales ──────────────────────────────────────────────────────────────────────────
const AUDIT_OFTEN = [
  { label: "Never", value: 0 }, { label: "Less than monthly", value: 1 }, { label: "Monthly", value: 2 },
  { label: "Weekly", value: 3 }, { label: "Daily or almost daily", value: 4 },
];
const AUDIT_YESNO = [
  { label: "No", value: 0 }, { label: "Yes, but not in the last year", value: 2 }, { label: "Yes, during the last year", value: 4 },
];

// ── Rosenberg: agreeing with a positive item scores high, with a negative item low ─────────────
const RSES_OPTS = [
  { label: "Strongly agree", value: 3 }, { label: "Agree", value: 2 }, { label: "Disagree", value: 1 }, { label: "Strongly disagree", value: 0 },
];
const RSES_REVERSED = new Set([1, 4, 5, 7, 8]);

export const CATEGORIES = ["All", "Mood", "Anxiety & stress", "Trauma", "Body & habits", "Focus", "Mothers", "Work", "Self & personality"];

export const FREE_TESTS = [
  {
    key: "phq9", id: 1, short: "PHQ-9", title: "Depression Screening", full: "Patient Health Questionnaire (PHQ-9)", name: "Mood",
    category: "Mood", icon: "feather-moon", color: "#3b82f6", time: "2–3 min", age: "Ages 13+", better: "low", max: 27,
    blurb: "The 9-question check doctors and psychologists use worldwide for low mood and depression.",
    by: "Kroenke, Spitzer & Williams, 2001",
    ref: "Kroenke K, Spitzer RL, Williams JBW. The PHQ-9: validity of a brief depression severity measure. J Gen Intern Med. 2001;16(9):606–613.",
    licence: "Developed by Drs Spitzer, Williams, Kroenke and colleagues with an educational grant from Pfizer Inc. No permission required to reproduce, translate, display or distribute.",
    keywords: ["depression", "mood"], match: "low mood & depression",
    intro: "Over the last 2 weeks, how often have you been bothered by any of the following problems?",
    options: FREQ_2W,
    questions: [
      "Little interest or pleasure in doing things",
      "Feeling down, depressed, or hopeless",
      "Trouble falling or staying asleep, or sleeping too much",
      "Feeling tired or having little energy",
      "Poor appetite or overeating",
      "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
      "Trouble concentrating on things, such as reading the newspaper or watching television",
      "Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual",
      "Thoughts that you would be better off dead or of hurting yourself in some way",
    ],
    score(a) {
      const s = sum(a, range(9));
      const flag = (Number(a[8]) || 0) > 0;
      if (s <= 4) return { score: s, flag, level: "Minimal", color: GREEN, text: "Your answers suggest minimal depressive symptoms. Keep up what's helping, and check in again if things change." };
      if (s <= 9) return { score: s, flag, level: "Mild", color: YELLOW, text: "Your answers suggest mild depressive symptoms. Small routines, sleep and support help — and talking to a psychologist is worth considering if it lasts." };
      if (s <= 14) return { score: s, flag, level: "Moderate", color: ORANGE, text: "Your answers suggest moderate depressive symptoms. Speaking with a psychologist is recommended — therapy works well at this level." };
      if (s <= 19) return { score: s, flag, level: "Moderately severe", color: DEEP, text: "Your answers suggest moderately severe depressive symptoms. Please speak with a psychologist or doctor soon." };
      return { score: s, flag, level: "Severe", color: RED, text: "Your answers suggest severe depressive symptoms. Please reach out to a mental-health professional as soon as you can." };
    },
  },
  {
    key: "gad7", id: 2, short: "GAD-7", title: "Anxiety Screening", full: "Generalized Anxiety Disorder scale (GAD-7)", name: "Worry",
    category: "Anxiety & stress", icon: "feather-wind", color: "#f59e0b", time: "2 min", age: "Ages 13+", better: "low", max: 21,
    blurb: "The standard 7-question check for worry, nervousness and restlessness.",
    by: "Spitzer, Kroenke, Williams & Löwe, 2006",
    ref: "Spitzer RL, Kroenke K, Williams JBW, Löwe B. A brief measure for assessing generalized anxiety disorder: the GAD-7. Arch Intern Med. 2006;166(10):1092–1097.",
    licence: "Developed by Drs Spitzer, Williams, Kroenke and colleagues with an educational grant from Pfizer Inc. No permission required to reproduce, translate, display or distribute.",
    keywords: ["anxiety", "panic", "stress"], match: "anxiety",
    intro: "Over the last 2 weeks, how often have you been bothered by the following problems?",
    options: FREQ_2W,
    questions: [
      "Feeling nervous, anxious, or on edge",
      "Not being able to stop or control worrying",
      "Worrying too much about different things",
      "Trouble relaxing",
      "Being so restless that it is hard to sit still",
      "Becoming easily annoyed or irritable",
      "Feeling afraid, as if something awful might happen",
    ],
    score(a) {
      const s = sum(a, range(7));
      if (s <= 4) return { score: s, level: "Minimal", color: GREEN, text: "Your answers suggest minimal anxiety. Keep using what works for you." };
      if (s <= 9) return { score: s, level: "Mild", color: YELLOW, text: "Your answers suggest mild anxiety. Breathing, grounding and regular routines help; a psychologist can teach more tools if it continues." };
      if (s <= 14) return { score: s, level: "Moderate", color: ORANGE, text: "Your answers suggest moderate anxiety. Speaking with a psychologist is recommended." };
      return { score: s, level: "Severe", color: RED, text: "Your answers suggest severe anxiety. Please speak with a mental-health professional soon." };
    },
  },
  {
    key: "dass21", id: 14, short: "DASS-21", title: "Depression, Anxiety & Stress", full: "Depression Anxiety Stress Scales (DASS-21)", name: "Mood, worry & stress",
    category: "Anxiety & stress", icon: "feather-layers", color: "#0d9488", time: "4–5 min", age: "Ages 17+", better: "low", max: null,
    blurb: "One check, three scores: how much low mood, anxiety and stress you've felt in the past week.",
    by: "Lovibond & Lovibond, 1995",
    ref: "Lovibond SH, Lovibond PF. Manual for the Depression Anxiety Stress Scales. 2nd ed. Sydney: Psychology Foundation; 1995.",
    licence: "The DASS is in the public domain (Psychology Foundation of Australia / UNSW) and may be used freely.",
    keywords: ["depression", "anxiety", "stress"], match: "mood, anxiety & stress",
    intro: "Please read each statement and choose how much it applied to you over the past week. There are no right or wrong answers — don't spend too long on any statement.",
    options: [
      { label: "Did not apply to me at all", value: 0 },
      { label: "Applied to me to some degree, or some of the time", value: 1 },
      { label: "Applied to me to a considerable degree, or a good part of time", value: 2 },
      { label: "Applied to me very much, or most of the time", value: 3 },
    ],
    questions: [
      "I found it hard to wind down",
      "I was aware of dryness of my mouth",
      "I couldn't seem to experience any positive feeling at all",
      "I experienced breathing difficulty (e.g. excessively rapid breathing, breathlessness in the absence of physical exertion)",
      "I found it difficult to work up the initiative to do things",
      "I tended to over-react to situations",
      "I experienced trembling (e.g. in the hands)",
      "I felt that I was using a lot of nervous energy",
      "I was worried about situations in which I might panic and make a fool of myself",
      "I felt that I had nothing to look forward to",
      "I found myself getting agitated",
      "I found it difficult to relax",
      "I felt down-hearted and blue",
      "I was intolerant of anything that kept me from getting on with what I was doing",
      "I felt I was close to panic",
      "I was unable to become enthusiastic about anything",
      "I felt I wasn't worth much as a person",
      "I felt that I was rather touchy",
      "I was aware of the action of my heart in the absence of physical exertion (e.g. sense of heart rate increase, heart missing a beat)",
      "I felt scared without any good reason",
      "I felt that life was meaningless",
    ],
    score(a) {
      const dims = {};
      const bars = Object.entries(DASS).map(([k, d]) => {
        const v = sum(a, d.items) * 2;
        dims[k] = v;
        const [band, color] = dassBand(v, d.cuts);
        return { key: k, label: d.label, value: v, max: 42, band, color };
      });
      const worst = bars.reduce((w, b) => (DASS_BANDS.findIndex((x) => x[0] === b.band) > DASS_BANDS.findIndex((x) => x[0] === w.band) ? b : w), bars[0]);
      const level = worst.band === "Normal" ? "All in normal range" : `Highest: ${worst.label} ${worst.band.toLowerCase()}`;
      return {
        score: null, dims, bars, level, color: worst.color,
        text: worst.band === "Normal" ? "All three scores are in the normal range for the past week." : `Your highest score this week is ${worst.label.toLowerCase()} (${worst.band.toLowerCase()}). ${["Moderate", "Severe", "Extremely severe"].includes(worst.band) ? "Speaking with a psychologist is recommended." : "Keep an eye on it and check again in a couple of weeks."}`,
      };
    },
  },
  {
    key: "k10", id: 7, short: "K10", title: "Psychological Distress", full: "Kessler Psychological Distress Scale (K10)", name: "Distress",
    category: "Anxiety & stress", icon: "feather-cloud-drizzle", color: "#6366f1", time: "2–3 min", age: "Ages 18+", better: "low", max: 50,
    blurb: "10 questions on how often you've felt nervous, hopeless, restless or worn out in the last month.",
    by: "Kessler et al., 2002",
    ref: "Kessler RC, Andrews G, Colpe LJ, et al. Short screening scales to monitor population prevalences and trends in non-specific psychological distress. Psychol Med. 2002;32(6):959–976. Kessler RC, Barker PR, Colpe LJ, et al. Screening for serious mental illness in the general population. Arch Gen Psychiatry. 2003;60(2):184–189. Bands: Andrews G, Slade T. Aust N Z J Public Health. 2001;25(6):494–497.",
    licence: "K10 © Ronald C. Kessler, PhD. All rights reserved. Free to use without formal permission when cited.",
    keywords: ["stress", "anxiety", "depression"], match: "stress & distress",
    intro: "These questions concern how you have been feeling over the past 30 days. During the last 30 days, about how often did you feel…",
    options: [
      { label: "None of the time", value: 1 }, { label: "A little of the time", value: 2 }, { label: "Some of the time", value: 3 },
      { label: "Most of the time", value: 4 }, { label: "All of the time", value: 5 },
    ],
    questions: [
      "…tired out for no good reason?",
      "…nervous?",
      "…so nervous that nothing could calm you down?",
      "…hopeless?",
      "…restless or fidgety?",
      "…so restless you could not sit still?",
      "…depressed?",
      "…that everything was an effort?",
      "…so sad that nothing could cheer you up?",
      "…worthless?",
    ],
    score(a) {
      const s = sum(a, range(10));
      if (s <= 15) return { score: s, level: "Low distress", color: GREEN, text: "Your level of psychological distress over the last month is low." };
      if (s <= 21) return { score: s, level: "Moderate distress", color: YELLOW, text: "Moderate distress. Notice what's weighing on you; a psychologist can help if it continues." };
      if (s <= 29) return { score: s, level: "High distress", color: ORANGE, text: "High distress. Speaking with a psychologist is recommended." };
      return { score: s, level: "Very high distress", color: RED, text: "Very high distress. Please speak with a mental-health professional soon." };
    },
  },
  {
    key: "pcl5", id: 4, short: "PCL-5", title: "Trauma & Stress Checklist", full: "PTSD Checklist for DSM-5 (PCL-5)", name: "Stress after a hard event",
    category: "Trauma", icon: "feather-shield", color: "#ef4444", time: "5–7 min", age: "Ages 18+", better: "low", max: 80,
    blurb: "Screens for post-traumatic stress symptoms after a frightening or distressing event.",
    by: "Weathers et al., US National Center for PTSD, 2013",
    ref: "Weathers FW, Litz BT, Keane TM, Palmieri PA, Marx BP, Schnurr PP. The PTSD Checklist for DSM-5 (PCL-5). 2013. National Center for PTSD, www.ptsd.va.gov.",
    licence: "Public domain (US Department of Veterans Affairs, National Center for PTSD).",
    keywords: ["trauma", "ptsd", "abuse"], match: "trauma",
    intro: "Below is a list of problems that people sometimes have in response to a very stressful experience. Keeping your worst event in mind, how much have you been bothered by each problem in the past month?",
    options: [
      { label: "Not at all", value: 0 }, { label: "A little bit", value: 1 }, { label: "Moderately", value: 2 },
      { label: "Quite a bit", value: 3 }, { label: "Extremely", value: 4 },
    ],
    questions: [
      "Repeated, disturbing, and unwanted memories of the stressful experience?",
      "Repeated, disturbing dreams of the stressful experience?",
      "Suddenly feeling or acting as if the stressful experience were actually happening again (as if you were actually back there reliving it)?",
      "Feeling very upset when something reminded you of the stressful experience?",
      "Having strong physical reactions when something reminded you of the stressful experience (for example, heart pounding, trouble breathing, sweating)?",
      "Avoiding memories, thoughts, or feelings related to the stressful experience?",
      "Avoiding external reminders of the stressful experience (for example, people, places, conversations, activities, objects, or situations)?",
      "Trouble remembering important parts of the stressful experience?",
      "Having strong negative beliefs about yourself, other people, or the world (for example, having thoughts such as: I am bad, there is something seriously wrong with me, no one can be trusted, the world is completely dangerous)?",
      "Blaming yourself or someone else for the stressful experience or what happened after it?",
      "Having strong negative feelings such as fear, horror, anger, guilt, or shame?",
      "Loss of interest in activities that you used to enjoy?",
      "Feeling distant or cut off from other people?",
      "Trouble experiencing positive feelings (for example, being unable to feel happiness or have loving feelings for people close to you)?",
      "Irritable behavior, angry outbursts, or acting aggressively?",
      "Taking too many risks or doing things that could cause you harm?",
      "Being \"superalert\" or watchful or on guard?",
      "Feeling jumpy or easily startled?",
      "Having difficulty concentrating?",
      "Trouble falling or staying asleep?",
    ],
    score(a) {
      const s = sum(a, range(20));
      // National Center for PTSD: a cut-point of 31–33 suggests probable PTSD (33 used here)
      if (s < 33) return { score: s, level: "Below PTSD cut-off", color: s >= 20 ? ORANGE : GREEN, text: s >= 20 ? "Your score is below the PTSD screening cut-off, but you are still carrying real stress from what happened. Talking to a psychologist can help you process it." : "Your score is below the PTSD screening cut-off." };
      return { score: s, level: "Probable PTSD", color: RED, text: "Your answers are in the range where PTSD is likely. Please speak with a trauma-informed psychologist — it is very treatable." };
    },
  },
  {
    key: "phq15", id: 8, short: "PHQ-15", title: "Body Symptoms Check", full: "Patient Health Questionnaire-15 (PHQ-15)", name: "Body & stress",
    category: "Body & habits", icon: "feather-activity", color: "#db2777", time: "3 min", age: "Ages 18+", better: "low", max: 30,
    blurb: "Headaches, stomach trouble, tiredness — how much body symptoms (often linked to stress) are bothering you.",
    by: "Kroenke, Spitzer & Williams, 2002",
    ref: "Kroenke K, Spitzer RL, Williams JBW. The PHQ-15: validity of a new measure for evaluating the severity of somatic symptoms. Psychosom Med. 2002;64(2):258–266.",
    licence: "Developed by Drs Spitzer, Williams, Kroenke and colleagues with an educational grant from Pfizer Inc. No permission required to reproduce, translate, display or distribute.",
    keywords: ["stress", "anxiety", "health"], match: "stress & body symptoms",
    intro: "During the past 4 weeks, how much have you been bothered by any of the following problems?",
    options: [
      { label: "Not bothered at all", value: 0 }, { label: "Bothered a little", value: 1 }, { label: "Bothered a lot", value: 2 },
    ],
    questions: [
      "Stomach pain",
      "Back pain",
      "Pain in your arms, legs, or joints (knees, hips, etc.)",
      "Menstrual cramps or other problems with your periods (women only — choose \"Not bothered at all\" if this does not apply)",
      "Headaches",
      "Chest pain",
      "Dizziness",
      "Fainting spells",
      "Feeling your heart pound or race",
      "Shortness of breath",
      "Pain or problems during sexual intercourse",
      "Constipation, loose bowels, or diarrhea",
      "Nausea, gas, or indigestion",
      "Feeling tired or having low energy",
      "Trouble sleeping",
    ],
    score(a) {
      const s = sum(a, range(15));
      const tail = " Body symptoms can have medical causes too — please also check with a doctor.";
      if (s <= 4) return { score: s, level: "Minimal", color: GREEN, text: "Minimal body symptoms right now." };
      if (s <= 9) return { score: s, level: "Low", color: YELLOW, text: `A low level of body symptoms.${tail}` };
      if (s <= 14) return { score: s, level: "Medium", color: ORANGE, text: `A medium level of body symptoms. Stress and anxiety often show up this way — a psychologist can help alongside your doctor.${tail}` };
      return { score: s, level: "High", color: RED, text: `A high level of body symptoms. Please see a doctor, and consider a psychologist for the stress side of it.${tail}` };
    },
  },
  {
    key: "audit", id: 9, short: "AUDIT", title: "Alcohol Use Check", full: "Alcohol Use Disorders Identification Test (AUDIT)", name: "Alcohol",
    category: "Body & habits", icon: "feather-droplet", color: "#b45309", time: "3 min", age: "Ages 18+", better: "low", max: 40,
    blurb: "The World Health Organization's 10-question check on drinking habits and risk.",
    by: "World Health Organization (Babor et al.), 2001",
    ref: "Babor TF, Higgins-Biddle JC, Saunders JB, Monteiro MG. AUDIT: The Alcohol Use Disorders Identification Test — Guidelines for Use in Primary Care. 2nd ed. Geneva: World Health Organization; 2001.",
    licence: "© World Health Organization. WHO makes the AUDIT freely available for use.",
    keywords: ["addiction", "alcohol", "substance"], match: "alcohol & habits",
    intro: "Questions about your use of alcohol during the past year. One \"drink\" = one standard drink (about 10 g of alcohol): a small 30 ml peg of whisky/rum/vodka, a small glass (100 ml) of wine, or a 285 ml glass of regular beer.",
    questions: [
      { q: "How often do you have a drink containing alcohol?", options: [
        { label: "Never", value: 0 }, { label: "Monthly or less", value: 1 }, { label: "2 to 4 times a month", value: 2 },
        { label: "2 to 3 times a week", value: 3 }, { label: "4 or more times a week", value: 4 }] },
      { q: "How many drinks containing alcohol do you have on a typical day when you are drinking?", options: [
        { label: "1 or 2", value: 0 }, { label: "3 or 4", value: 1 }, { label: "5 or 6", value: 2 },
        { label: "7, 8, or 9", value: 3 }, { label: "10 or more", value: 4 }] },
      { q: "How often do you have six or more drinks on one occasion?", options: AUDIT_OFTEN },
      { q: "How often during the last year have you found that you were not able to stop drinking once you had started?", options: AUDIT_OFTEN },
      { q: "How often during the last year have you failed to do what was normally expected from you because of drinking?", options: AUDIT_OFTEN },
      { q: "How often during the last year have you needed a first drink in the morning to get yourself going after a heavy drinking session?", options: AUDIT_OFTEN },
      { q: "How often during the last year have you had a feeling of guilt or remorse after drinking?", options: AUDIT_OFTEN },
      { q: "How often during the last year have you been unable to remember what happened the night before because you had been drinking?", options: AUDIT_OFTEN },
      { q: "Have you or someone else been injured as a result of your drinking?", options: AUDIT_YESNO },
      { q: "Has a relative or friend or a doctor or another health worker been concerned about your drinking or suggested you cut down?", options: AUDIT_YESNO },
    ],
    score(a) {
      const s = sum(a, range(10));
      // WHO risk zones
      if (s <= 7) return { score: s, level: "Low risk", color: GREEN, text: "Zone I — low-risk drinking (or not drinking). Keep it that way." };
      if (s <= 15) return { score: s, level: "Risky drinking", color: YELLOW, text: "Zone II — hazardous drinking. Cutting down now protects your health; simple advice and a plan usually help." };
      if (s <= 19) return { score: s, level: "Harmful drinking", color: ORANGE, text: "Zone III — harmful drinking. Speaking with a psychologist or doctor about cutting down is recommended." };
      return { score: s, level: "Possible dependence", color: RED, text: "Zone IV — possible alcohol dependence. Please see a doctor or addiction specialist; stopping suddenly can be unsafe without medical advice." };
    },
  },
  {
    key: "asrs", id: 10, short: "ASRS v1.1", title: "Adult ADHD Screener", full: "Adult ADHD Self-Report Scale v1.1 Screener (ASRS)", name: "Focus & attention",
    category: "Focus", icon: "feather-target", color: "#7c3aed", time: "1–2 min", age: "Ages 18+", better: "low", max: 6,
    blurb: "The World Health Organization's 6-question screener for adult ADHD symptoms.",
    by: "Kessler et al., WHO, 2005",
    ref: "Kessler RC, Adler L, Ames M, et al. The World Health Organization Adult ADHD Self-Report Scale (ASRS): a short screening scale for use in the general population. Psychol Med. 2005;35(2):245–256.",
    licence: "ASRS v1.1 Screener © World Health Organization. Free to use without formal permission, unaltered and with this citation.",
    keywords: ["adhd", "attention", "focus"], match: "focus & ADHD",
    intro: "Thinking about how you have felt and conducted yourself over the past 6 months, how often…",
    options: [
      { label: "Never", value: 0 }, { label: "Rarely", value: 1 }, { label: "Sometimes", value: 2 },
      { label: "Often", value: 3 }, { label: "Very often", value: 4 },
    ],
    questions: [
      "How often do you have trouble wrapping up the final details of a project, once the challenging parts have been done?",
      "How often do you have difficulty getting things in order when you have to do a task that requires organization?",
      "How often do you have problems remembering appointments or obligations?",
      "When you have a task that requires a lot of thought, how often do you avoid or delay getting started?",
      "How often do you fidget or squirm with your hands or feet when you have to sit down for a long time?",
      "How often do you feel overly active and compelled to do things, like you were driven by a motor?",
    ],
    score(a) {
      // shaded boxes: items 1–3 count from "Sometimes", items 4–6 from "Often"
      const s = range(6).filter((i) => (Number(a[i]) || 0) >= (i < 3 ? 2 : 3)).length;
      if (s >= 4) return { score: s, level: "Consistent with adult ADHD", color: ORANGE, text: "Your answers are highly consistent with adult ADHD symptoms. A screener can't diagnose ADHD — a full assessment with a psychologist or psychiatrist is the next step." };
      return { score: s, level: "Below screening threshold", color: GREEN, text: "Your answers are below the ADHD screening threshold. If focus problems still affect your life, a psychologist can look at other causes." };
    },
  },
  {
    key: "epds", id: 11, short: "EPDS", title: "After Having a Baby", full: "Edinburgh Postnatal Depression Scale (EPDS)", name: "New parent mood",
    category: "Mothers", icon: "feather-heart", color: "#e11d48", time: "2–3 min", age: "Pregnancy & after birth", better: "low", max: 30,
    blurb: "The standard 10-question check for depression during pregnancy and after having a baby.",
    by: "Cox, Holden & Sagovsky, 1987",
    ref: "Cox JL, Holden JM, Sagovsky R. Detection of postnatal depression: development of the 10-item Edinburgh Postnatal Depression Scale. Br J Psychiatry. 1987;150:782–786.",
    licence: "© 1987 The Royal College of Psychiatrists. May be reproduced without further permission provided the authors, title and source are cited.",
    keywords: ["postpartum", "pregnancy", "depression", "women"], match: "pregnancy & new-parent mood",
    intro: "As you are pregnant or have recently had a baby, we would like to know how you are feeling. Please choose the answer that comes closest to how you have felt in the past 7 days, not just how you feel today.",
    questions: [
      { q: "I have been able to laugh and see the funny side of things", options: [
        { label: "As much as I always could", value: 0 }, { label: "Not quite so much now", value: 1 }, { label: "Definitely not so much now", value: 2 }, { label: "Not at all", value: 3 }] },
      { q: "I have looked forward with enjoyment to things", options: [
        { label: "As much as I ever did", value: 0 }, { label: "Rather less than I used to", value: 1 }, { label: "Definitely less than I used to", value: 2 }, { label: "Hardly at all", value: 3 }] },
      { q: "I have blamed myself unnecessarily when things went wrong", options: [
        { label: "Yes, most of the time", value: 3 }, { label: "Yes, some of the time", value: 2 }, { label: "Not very often", value: 1 }, { label: "No, never", value: 0 }] },
      { q: "I have been anxious or worried for no good reason", options: [
        { label: "No, not at all", value: 0 }, { label: "Hardly ever", value: 1 }, { label: "Yes, sometimes", value: 2 }, { label: "Yes, very often", value: 3 }] },
      { q: "I have felt scared or panicky for no very good reason", options: [
        { label: "Yes, quite a lot", value: 3 }, { label: "Yes, sometimes", value: 2 }, { label: "No, not much", value: 1 }, { label: "No, not at all", value: 0 }] },
      { q: "Things have been getting on top of me", options: [
        { label: "Yes, most of the time I haven't been able to cope at all", value: 3 }, { label: "Yes, sometimes I haven't been coping as well as usual", value: 2 },
        { label: "No, most of the time I have coped quite well", value: 1 }, { label: "No, I have been coping as well as ever", value: 0 }] },
      { q: "I have been so unhappy that I have had difficulty sleeping", options: [
        { label: "Yes, most of the time", value: 3 }, { label: "Yes, sometimes", value: 2 }, { label: "Not very often", value: 1 }, { label: "No, not at all", value: 0 }] },
      { q: "I have felt sad or miserable", options: [
        { label: "Yes, most of the time", value: 3 }, { label: "Yes, quite often", value: 2 }, { label: "Not very often", value: 1 }, { label: "No, not at all", value: 0 }] },
      { q: "I have been so unhappy that I have been crying", options: [
        { label: "Yes, most of the time", value: 3 }, { label: "Yes, quite often", value: 2 }, { label: "Only occasionally", value: 1 }, { label: "No, never", value: 0 }] },
      { q: "The thought of harming myself has occurred to me", options: [
        { label: "Yes, quite often", value: 3 }, { label: "Sometimes", value: 2 }, { label: "Hardly ever", value: 1 }, { label: "Never", value: 0 }] },
    ],
    score(a) {
      const s = sum(a, range(10));
      const flag = (Number(a[9]) || 0) > 0;
      if (s >= 13) return { score: s, flag, level: "Probable depression", color: RED, text: "Your score suggests depression is likely. Please speak with a psychologist or your doctor soon — this is common and very treatable." };
      if (s >= 10) return { score: s, flag, level: "Possible depression", color: ORANGE, text: "Your score suggests possible depression. Please talk to a psychologist or your doctor, and check again in two weeks." };
      return { score: s, flag, level: "Below cut-off", color: GREEN, text: "Your score is below the cut-off for depression. Early parenthood is hard — reach out any time it starts to feel like too much." };
    },
  },
  {
    key: "cbi", id: 13, short: "CBI", title: "Burnout Check", full: "Copenhagen Burnout Inventory (CBI) — personal & work", name: "Burnout",
    category: "Work", icon: "feather-battery", color: "#ca8a04", time: "3 min", age: "Working adults", better: "low", max: null,
    blurb: "How worn out you are — in general and because of your work.",
    by: "Kristensen et al., 2005",
    ref: "Kristensen TS, Borritz M, Villadsen E, Christensen KB. The Copenhagen Burnout Inventory: a new tool for the assessment of burnout. Work & Stress. 2005;19(3):192–207. Bands: Borritz M, et al. 2006.",
    licence: "Developed by the National Research Centre for the Working Environment, Denmark; free to use.",
    keywords: ["stress", "burnout", "work"], match: "burnout & work stress",
    intro: "These questions are about how tired and worn out you feel, in general and at work.",
    questions: [
      { q: "How often do you feel tired?", options: CBI_FREQ },
      { q: "How often are you physically exhausted?", options: CBI_FREQ },
      { q: "How often are you emotionally exhausted?", options: CBI_FREQ },
      { q: "How often do you think: \"I can't take it anymore\"?", options: CBI_FREQ },
      { q: "How often do you feel worn out?", options: CBI_FREQ },
      { q: "How often do you feel weak and susceptible to illness?", options: CBI_FREQ },
      { q: "Is your work emotionally exhausting?", options: CBI_DEGREE },
      { q: "Do you feel burnt out because of your work?", options: CBI_DEGREE },
      { q: "Does your work frustrate you?", options: CBI_DEGREE },
      { q: "Do you feel worn out at the end of the working day?", options: CBI_FREQ },
      { q: "Are you exhausted in the morning at the thought of another day at work?", options: CBI_FREQ },
      { q: "Do you feel that every working hour is tiring for you?", options: CBI_FREQ },
      { q: "Do you have enough energy for family and friends during leisure time?", options: CBI_FREQ_REV },
    ],
    score(a) {
      const personal = Math.round(sum(a, range(6)) / 6);
      const work = Math.round(sum(a, [6, 7, 8, 9, 10, 11, 12]) / 7);
      const bars = [["personal", "Personal burnout", personal], ["work", "Work-related burnout", work]].map(([key, label, value]) => {
        const [band, color] = cbiBand(value);
        return { key, label, value, max: 100, band, color };
      });
      const top = personal >= work ? bars[0] : bars[1];
      return {
        score: null, dims: { personal, work }, bars, level: top.band, color: top.color,
        text: top.value >= 50 ? `Your ${top.label.toLowerCase()} score (${top.value}/100) is in the burnout range. Rest alone may not fix it — a psychologist can help you work out what needs to change.` : "Both scores are below the burnout range (50/100).",
      };
    },
  },
  {
    key: "rses", id: 12, short: "RSES", title: "Self-Esteem Scale", full: "Rosenberg Self-Esteem Scale (RSES)", name: "Self-esteem",
    category: "Self & personality", icon: "feather-sun", color: "#0891b2", time: "2 min", age: "Ages 13+", better: "high", max: 30,
    blurb: "The most widely used 10-statement measure of how you feel about yourself.",
    by: "Rosenberg, 1965",
    ref: "Rosenberg M. Society and the Adolescent Self-Image. Princeton, NJ: Princeton University Press; 1965.",
    licence: "Free to use without permission for research and clinical purposes (Rosenberg family / University of Maryland).",
    keywords: ["self esteem", "confidence"], match: "self-esteem",
    intro: "Below is a list of statements dealing with your general feelings about yourself. How much do you agree or disagree with each?",
    options: RSES_OPTS,
    reversed: RSES_REVERSED,
    questions: [
      "On the whole, I am satisfied with myself.",
      "At times I think I am no good at all.",
      "I feel that I have a number of good qualities.",
      "I am able to do things as well as most other people.",
      "I feel I do not have much to be proud of.",
      "I certainly feel useless at times.",
      "I feel that I'm a person of worth, at least on an equal plane with others.",
      "I wish I could have more respect for myself.",
      "All in all, I am inclined to feel that I am a failure.",
      "I take a positive attitude toward myself.",
    ],
    score(a) {
      const s = range(10).reduce((t, i) => t + (RSES_REVERSED.has(i) ? 3 - (Number(a[i]) || 0) : Number(a[i]) || 0), 0);
      if (s < 15) return { score: s, level: "Low self-esteem", color: ORANGE, text: "Your score suggests low self-esteem. That inner critic can be worked with — a psychologist can help." };
      if (s <= 25) return { score: s, level: "Normal range", color: GREEN, text: "Your self-esteem is in the normal range." };
      return { score: s, level: "High self-esteem", color: BLUE, text: "Your score shows high self-esteem." };
    },
  },
  {
    key: "bigfive", id: 5, short: "IPIP-50", title: "Personality Profile", full: "Big Five Personality (IPIP-50)", name: "Personality",
    category: "Self & personality", icon: "feather-user", color: "#16a34a", time: "8–10 min", age: "Ages 14+", better: null, max: null,
    blurb: "See where you sit on openness, conscientiousness, extraversion, agreeableness and emotional sensitivity.",
    by: "IPIP-50, Goldberg 1992",
    ref: "Goldberg LR. The development of markers for the Big-Five factor structure. Psychol Assess. 1992;4(1):26–42. Items: International Personality Item Pool (ipip.ori.org).",
    licence: "IPIP items are in the public domain. Scores are shown 0–100 within the scale, not compared with population norms.",
    keywords: ["self esteem", "personality", "career"], match: "personal growth",
    intro: "Describe yourself as you generally are now, not as you wish to be in the future — as you honestly see yourself compared with other people of your sex and roughly your age. How accurately does each statement describe you?",
    options: [
      { label: "Very inaccurate", value: 1 }, { label: "Moderately inaccurate", value: 2 }, { label: "Neither accurate nor inaccurate", value: 3 },
      { label: "Moderately accurate", value: 4 }, { label: "Very accurate", value: 5 },
    ],
    questions: [
      "Am the life of the party.", "Feel little concern for others.", "Am always prepared.", "Get stressed out easily.", "Have a rich vocabulary.",
      "Don't talk a lot.", "Am interested in people.", "Leave my belongings around.", "Am relaxed most of the time.", "Have difficulty understanding abstract ideas.",
      "Feel comfortable around people.", "Insult people.", "Pay attention to details.", "Worry about things.", "Have a vivid imagination.",
      "Keep in the background.", "Sympathize with others' feelings.", "Make a mess of things.", "Seldom feel blue.", "Am not interested in abstract ideas.",
      "Start conversations.", "Am not interested in other people's problems.", "Get chores done right away.", "Am easily disturbed.", "Have excellent ideas.",
      "Have little to say.", "Have a soft heart.", "Often forget to put things back in their proper place.", "Get upset easily.", "Do not have a good imagination.",
      "Talk to a lot of different people at parties.", "Am not really interested in others.", "Like order.", "Change my mood a lot.", "Am quick to understand things.",
      "Don't like to draw attention to myself.", "Take time out for others.", "Shirk my duties.", "Have frequent mood swings.", "Use difficult words.",
      "Don't mind being the center of attention.", "Feel others' emotions.", "Follow a schedule.", "Get irritated easily.", "Spend time reflecting on things.",
      "Am quiet around strangers.", "Make people feel at ease.", "Am exacting in my work.", "Often feel blue.", "Am full of ideas.",
    ],
    score(a) {
      const dims = {};
      const bars = IPIP_DIMS.map(([key, label, f, def]) => {
        const idx = range(10).map((k) => k * 5 + f);
        const raw = idx.reduce((t, i) => { const v = Number(a[i]) || 3; return t + (IPIP_REVERSED.has(i) ? 6 - v : v); }, 0);
        const value = Math.max(0, Math.min(100, Math.round(((raw - 10) / 40) * 100)));
        dims[key] = value;
        return { key, label, value, max: 100, band: value < 33 ? "Low" : value < 67 ? "Moderate" : "High", color: "#16a34a", def };
      });
      return { score: null, dims, bars, level: "Profile", color: BLUE, text: "There are no good or bad scores in personality — this is simply how you described yourself." };
    },
  },
];

export const TEST_BY_KEY = Object.fromEntries(FREE_TESTS.map((t) => [t.key, t]));
// old links used numbers (?start=1)
export const testFromParam = (p) => {
  const v = String(p || "");
  return TEST_BY_KEY[v] || FREE_TESTS.find((t) => String(t.id) === v) || null;
};
export const optionsFor = (test, i) => (typeof test.questions[i] === "object" ? test.questions[i].options : test.options);
export const questionText = (test, i) => (typeof test.questions[i] === "object" ? test.questions[i].q : test.questions[i]);
export const maxScore = (test) => test.max;

// valid only if every item has one of its own answer values
export const validAnswers = (test, a) => Array.isArray(a) && a.length === test.questions.length
  && a.every((v, i) => optionsFor(test, i).some((o) => o.value === v));

// Clinical assessment (booked with a psychologist): fixed CYT fee per test, split 70% CYT / 30% therapist;
// therapists offer them after buying the yearly add-on.
export const CLINICAL_FEE = 299;
export const CLINICAL_THERAPIST_SHARE = 0.3;
export const ADDON_PRICE = 499;
