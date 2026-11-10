// "Ask a psychologist" — clients ask anonymously from their dashboard, verified CYT therapists answer,
// admins review and publish the good ones to /ask-a-psychologist (with the therapist credited).
import expressAsyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Question from "../models/Question.js";
import Therapists from "../models/Therapists.js";
import Users from "../models/Users.js";
import { notifyClient } from "../services/clientNotify.js";
import { sendMail } from "../helper/mailer.js";
import { questionAnsweredMail } from "../services/mailTemplates.js";

export const CATEGORIES = ["anxiety", "depression", "relationships", "stress", "sleep", "anger", "self-esteem", "family", "parenting", "work", "grief", "other"];
const AGE = ["", "18-24", "25-34", "35-44", "45-54", "55+"];
const GENDER = ["", "Female", "Male", "Non-binary", "Prefer not to say"];
const CLAIM_MS = 45 * 60 * 1000; // a therapist holds a question for 45 min while writing

// words that mean someone may be in danger — show helplines straight away, never publish
const CRISIS = /\b(suicid\w*|kill (my ?self|me)|end (my|this) life|want to die|wanna die|self[- ]?harm\w*|cut(ting)? my(self)?|hang my ?self|no reason to live|khud ?kushi|aatmahatya|atmhatya|marna chaht[aie]|mar jaan[aeu]|jeena nahi)\b/i;

const clean = (s, max) => String(s || "").replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, max);
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70) || "question";
// default public title: the first sentence that is a question, else the first sentence (admin can edit it)
const titleFrom = (body) => {
  const parts = String(body).split(/(?<=[?.!])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const pick = parts.find((s) => s.endsWith("?")) || parts[0] || "";
  const t = pick.length > 110 ? `${pick.slice(0, 107).replace(/\s+\S*$/, "")}…` : pick.replace(/[.!]+$/, "");
  return t;
};
const site = () => (process.env.SITE_URL || "https://www.chooseyourtherapist.in").replace(/\/+$/, "");

async function therapistOf(userId) {
  return Therapists.findOne({ user: userId }).select("_id user profile_type verification_status").lean();
}
async function therapistCard(tid) {
  if (!tid) return null;
  const t = await Therapists.findById(tid).select("_id user profile_type").populate("user", "name profile").lean();
  if (!t) return null;
  return { _id: String(t._id), name: t.user?.name || "", profile: t.user?.profile || "", profile_type: t.profile_type || "Psychologist" };
}
const mine = (q) => ({
  _id: String(q._id), category: q.category, body: q.body, status: q.status, urgent: q.urgent, allowPublish: q.allowPublish,
  createdAt: q.createdAt, answer: q.answer?.text ? { text: q.answer.text, at: q.answer.at } : null,
  published: q.published, slug: q.published ? q.slug : null,
});

/* ───────────── client ───────────── */

// POST /ask/questions { body, category, ageRange?, gender?, allowPublish }
export const askQuestion = expressAsyncHandler(async (req, res) => {
  const body = clean(req.body?.body, 1500);
  if (body.length < 30) return res.status(400).json({ status: false, message: "Please write a little more (at least 30 characters) so a psychologist can help." });
  const category = CATEGORIES.includes(req.body?.category) ? req.body.category : "other";
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  if (await Question.countDocuments({ user: req.user._id, createdAt: { $gte: since } }) >= 3) {
    return res.status(429).json({ status: false, message: "You can ask up to 3 questions a day. Please try again tomorrow." });
  }
  const urgent = CRISIS.test(body);
  const q = await Question.create({
    user: req.user._id, category, body, urgent,
    allowPublish: urgent ? false : req.body?.allowPublish === true,
    context: { ageRange: AGE.includes(req.body?.ageRange) ? req.body.ageRange : "", gender: GENDER.includes(req.body?.gender) ? req.body.gender : "" },
  });
  res.status(201).json({ status: true, data: { ...mine(q.toObject()), urgent } });
});

// GET /ask/questions/mine
export const myQuestions = expressAsyncHandler(async (req, res) => {
  const rows = await Question.find({ user: req.user._id, hidden: { $ne: true } }).sort({ createdAt: -1 }).limit(50).lean();
  const tids = [...new Set(rows.map((r) => String(r.answer?.therapist || "")).filter(Boolean))];
  const cards = Object.fromEntries(await Promise.all(tids.map(async (id) => [id, await therapistCard(id)])));
  res.json({ status: true, data: rows.map((r) => ({ ...mine(r), therapist: r.answer?.therapist ? cards[String(r.answer.therapist)] : null })) });
});

/* ───────────── public ───────────── */

const publicRow = (q, card) => ({
  slug: q.slug, category: q.category, title: q.publicTitle, body: q.publicBody, answer: q.publicAnswer,
  context: q.context, publishedAt: q.publishedAt, answeredAt: q.answer?.at, helpful: q.helpful || 0, therapist: card,
});

// GET /ask/public?category=&page=
export const publicList = expressAsyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const per = 12;
  const filter = { published: true, hidden: { $ne: true } };
  if (CATEGORIES.includes(req.query.category)) filter.category = req.query.category;
  const [rows, total, counts] = await Promise.all([
    Question.find(filter).sort({ publishedAt: -1 }).skip((page - 1) * per).limit(per).lean(),
    Question.countDocuments(filter),
    Question.aggregate([{ $match: { published: true, hidden: { $ne: true } } }, { $group: { _id: "$category", n: { $sum: 1 } } }]),
  ]);
  const cards = {};
  for (const r of rows) { const k = String(r.answer?.therapist || ""); if (k && !cards[k]) cards[k] = await therapistCard(k); }
  res.json({ status: true, data: {
    items: rows.map((r) => publicRow(r, cards[String(r.answer?.therapist || "")] || null)),
    total, page, pages: Math.max(1, Math.ceil(total / per)),
    categories: Object.fromEntries(counts.map((c) => [c._id, c.n])),
  } });
});

// GET /ask/public/:slug   (also counts a view)
export const publicOne = expressAsyncHandler(async (req, res) => {
  const q = await Question.findOneAndUpdate({ slug: String(req.params.slug), published: true, hidden: { $ne: true } }, { $inc: { views: 1 } }, { new: true }).lean();
  if (!q) return res.status(404).json({ status: false, message: "Not found" });
  const related = await Question.find({ published: true, hidden: { $ne: true }, category: q.category, _id: { $ne: q._id } }).sort({ publishedAt: -1 }).limit(4).select("slug publicTitle category").lean();
  res.json({ status: true, data: { ...publicRow(q, await therapistCard(q.answer?.therapist)), related: related.map((r) => ({ slug: r.slug, title: r.publicTitle, category: r.category })) } });
});

// GET /ask/public-slugs (sitemap)
export const publicSlugs = expressAsyncHandler(async (req, res) => {
  const rows = await Question.find({ published: true, hidden: { $ne: true } }).select("slug publishedAt updatedAt").sort({ publishedAt: -1 }).lean();
  res.json({ status: true, data: rows.map((r) => ({ slug: r.slug, at: r.updatedAt || r.publishedAt })) });
});

// POST /ask/public/:slug/helpful — one per visitor per question (best effort, in memory)
const helpfulSeen = new Map();
export const markHelpful = expressAsyncHandler(async (req, res) => {
  const key = `${req.ip}|${req.params.slug}`;
  if (helpfulSeen.has(key)) return res.json({ status: true, data: { counted: false } });
  helpfulSeen.set(key, Date.now());
  if (helpfulSeen.size > 20000) helpfulSeen.clear();
  const q = await Question.findOneAndUpdate({ slug: String(req.params.slug), published: true }, { $inc: { helpful: 1 } }, { new: true }).select("helpful").lean();
  res.json({ status: true, data: { counted: !!q, helpful: q?.helpful || 0 } });
});

/* ───────────── therapist ───────────── */

const forTherapist = (q, me) => ({
  _id: String(q._id), category: q.category, body: q.body, context: q.context, urgent: q.urgent, allowPublish: q.allowPublish,
  createdAt: q.createdAt, status: q.status,
  claimedByMe: !!(q.claimedBy && String(q.claimedBy) === me && q.claimedAt && Date.now() - new Date(q.claimedAt) < CLAIM_MS),
  answer: q.answer?.text ? { text: q.answer.text, at: q.answer.at } : null,
  published: q.published, slug: q.published ? q.slug : null, helpful: q.helpful || 0, views: q.views || 0,
});

// GET /ask/therapist?tab=open|mine
export const therapistList = expressAsyncHandler(async (req, res) => {
  const t = await therapistOf(req.user._id);
  if (!t) return res.status(403).json({ status: false, message: "Therapist profile not found." });
  const me = String(t._id);
  const approved = t.verification_status === "approved";
  if (req.query.tab === "mine") {
    const rows = await Question.find({ "answer.therapist": t._id }).sort({ "answer.at": -1 }).limit(100).lean();
    return res.json({ status: true, data: { approved, items: rows.map((q) => forTherapist(q, me)) } });
  }
  const free = { $or: [{ claimedBy: null }, { claimedAt: { $lt: new Date(Date.now() - CLAIM_MS) } }, { claimedBy: t._id }] };
  const rows = await Question.find({ status: "open", hidden: { $ne: true }, ...free }).sort({ urgent: -1, createdAt: 1 }).limit(60).lean();
  res.json({ status: true, data: { approved, items: rows.map((q) => forTherapist(q, me)) } });
});

// POST /ask/therapist/:id/claim — hold it while writing so two therapists don't answer the same one
export const claimQuestion = expressAsyncHandler(async (req, res) => {
  const t = await therapistOf(req.user._id);
  if (!t || t.verification_status !== "approved") return res.status(403).json({ status: false, message: "Only verified therapists can answer." });
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ status: false, message: "Not found" });
  const q = await Question.findOneAndUpdate(
    { _id: req.params.id, status: "open", $or: [{ claimedBy: null }, { claimedAt: { $lt: new Date(Date.now() - CLAIM_MS) } }, { claimedBy: t._id }] },
    { claimedBy: t._id, claimedAt: new Date() },
    { new: true }
  ).lean();
  if (!q) return res.status(409).json({ status: false, message: "Another psychologist is answering this one." });
  res.json({ status: true, data: forTherapist(q, String(t._id)) });
});

// POST /ask/therapist/:id/answer { text }
export const answerQuestion = expressAsyncHandler(async (req, res) => {
  const t = await therapistOf(req.user._id);
  if (!t || t.verification_status !== "approved") return res.status(403).json({ status: false, message: "Only verified therapists can answer." });
  const text = clean(req.body?.text, 4000);
  if (text.length < 150) return res.status(400).json({ status: false, message: "Please write a fuller answer (at least 150 characters)." });
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ status: false, message: "Not found" });
  const q = await Question.findOneAndUpdate(
    { _id: req.params.id, status: "open", $or: [{ claimedBy: null }, { claimedAt: { $lt: new Date(Date.now() - CLAIM_MS) } }, { claimedBy: t._id }] },
    { status: "answered", answer: { text, therapist: t._id, at: new Date() }, claimedBy: t._id, publicAnswer: text },
    { new: true }
  ).lean();
  if (!q) return res.status(409).json({ status: false, message: "This question was already answered." });

  // tell the asker (bell + email); never blocks the answer
  const card = await therapistCard(t._id);
  notifyClient(q.user, { type: "question", title: "Your question has an answer", body: `${card?.name || "A psychologist"} answered your question.`, link: "/client/ask", ref: `question:${q._id}` });
  try {
    const u = await Users.findById(q.user).select("name email").lean();
    if (u?.email) {
      await sendMail(u.email, "A psychologist answered your question", `${card?.name || "A psychologist"} has answered your question on Choose Your Therapist.`,
        questionAnsweredMail({ name: u.name, therapistName: card?.name, therapistRole: card?.profile_type, question: q.body, answer: text, link: `${site()}/client/ask` }));
    }
  } catch (e) { console.error("question answered mail:", e.message); }
  res.json({ status: true, data: forTherapist(q, String(t._id)) });
});

/* ───────────── admin ───────────── */

// GET /ask/admin?tab=waiting|review|published|hidden|urgent
export const adminList = expressAsyncHandler(async (req, res) => {
  const tab = String(req.query.tab || "all");
  const f = {
    all: {},
    waiting: { status: "open", hidden: { $ne: true } },
    review: { status: "answered", allowPublish: true, published: false, hidden: { $ne: true }, urgent: { $ne: true } },
    published: { published: true, hidden: { $ne: true } },
    hidden: { hidden: true },
    urgent: { urgent: true },
    answered: { status: "answered", hidden: { $ne: true } },
  }[tab] || {};
  const rows = await Question.find(f).sort({ createdAt: -1 }).limit(200).populate("user", "name email phone").lean();
  const cards = {};
  for (const r of rows) { const k = String(r.answer?.therapist || ""); if (k && !cards[k]) cards[k] = await therapistCard(k); }
  const counts = {};
  await Promise.all(Object.entries({
    all: {},
    waiting: { status: "open", hidden: { $ne: true } },
    review: { status: "answered", allowPublish: true, published: false, hidden: { $ne: true }, urgent: { $ne: true } },
    published: { published: true, hidden: { $ne: true } },
    urgent: { urgent: true, status: "open" },
  }).map(async ([k, v]) => { counts[k] = await Question.countDocuments(v); }));
  res.json({ status: true, data: { counts, items: rows.map((q) => ({
    _id: String(q._id), category: q.category, body: q.body, context: q.context, urgent: q.urgent, allowPublish: q.allowPublish,
    asker: q.user ? { name: q.user.name || "", email: q.user.email || "", phone: q.user.phone || "" } : null, // admin only — never public
    status: q.status, createdAt: q.createdAt, answer: q.answer?.text ? { text: q.answer.text, at: q.answer.at } : null,
    therapist: cards[String(q.answer?.therapist || "")] || null,
    published: q.published, publishedAt: q.publishedAt, slug: q.slug || null, hidden: q.hidden,
    publicTitle: q.publicTitle || titleFrom(q.body), publicBody: q.publicBody || q.body, publicAnswer: q.publicAnswer || q.answer?.text || "",
    helpful: q.helpful || 0, views: q.views || 0,
  })) } });
});

// PATCH /ask/admin/:id { publicTitle?, publicBody?, publicAnswer?, category?, published?, hidden? }
export const adminUpdate = expressAsyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ status: false, message: "Not found" });
  const q = await Question.findById(req.params.id);
  if (!q) return res.status(404).json({ status: false, message: "Not found" });
  const b = req.body || {};
  if (b.publicTitle !== undefined) q.publicTitle = clean(b.publicTitle, 160);
  if (b.publicBody !== undefined) q.publicBody = clean(b.publicBody, 1500);
  if (b.publicAnswer !== undefined) q.publicAnswer = clean(b.publicAnswer, 4000);
  if (b.category !== undefined && CATEGORIES.includes(b.category)) q.category = b.category;
  if (b.hidden !== undefined) { q.hidden = !!b.hidden; if (q.hidden) q.published = false; }
  if (b.published === true) {
    if (q.urgent) return res.status(400).json({ status: false, message: "Questions with crisis words are never published." });
    if (!q.allowPublish) return res.status(400).json({ status: false, message: "The person who asked did not allow publishing." });
    if (q.status !== "answered") return res.status(400).json({ status: false, message: "Only answered questions can be published." });
    if (!q.publicTitle) q.publicTitle = titleFrom(q.body);
    if (!q.publicBody) q.publicBody = q.body;
    if (!q.publicAnswer) q.publicAnswer = q.answer.text;
    if (!q.slug) {
      const base = slugify(q.publicTitle);
      q.slug = (await Question.exists({ slug: base })) ? `${base}-${String(q._id).slice(-5)}` : base;
    }
    q.published = true;
    q.publishedAt = q.publishedAt || new Date();
  } else if (b.published === false) {
    q.published = false;
  }
  await q.save();
  res.json({ status: true, data: { _id: String(q._id), published: q.published, slug: q.slug || null, hidden: q.hidden } });
});

// DELETE /ask/admin/:id
export const adminDelete = expressAsyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ status: false, message: "Not found" });
  await Question.deleteOne({ _id: req.params.id });
  res.json({ status: true });
});
