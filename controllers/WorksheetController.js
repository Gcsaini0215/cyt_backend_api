import expressAsyncHandler from "express-async-handler";
import crypto from "crypto";
import mongoose from "mongoose";
import { WorksheetLink, WorksheetEntry } from "../models/Worksheet.js";
import Therapists from "../models/Therapists.js";
import Booking from "../models/Booking.js";
import User from "../models/Users.js";
import { notifyClient } from "../services/clientNotify.js";
import { notifyTherapists } from "../services/therapistNotify.js";

/* Therapist Toolkit → worksheets (CBT ABCD thought log).
   Therapist: makes a share link (anyone → their booking) or sends it to one of their clients.
   Public: /worksheet/<code> shows it with the therapist's name + Book button.
   Client: starts it from the link (after signing in), fills it in My Space, sends it to the therapist.
   Answers are private: the therapist sees them only after "Send to my therapist"; admin routes never read them. */

export const TOOLS = { abcd: "ABCD Thought Log", activity: "Activity Diary", whatif: "What-If Flip" };
// Activity Diary: 7 days × these 2-hour blocks (start hour)
const SLOTS = ["6", "8", "10", "12", "14", "16", "18", "20", "22"];
const n10 = (v) => (v === null || v === undefined || v === "" ? null : Math.max(0, Math.min(10, Math.round(Number(v) || 0))));
const TRAPS = new Set(["all-or-nothing", "mind-reading", "fortune-telling", "catastrophising", "should", "labelling", "personalising", "overgeneralising", "filtering", "emotional-reasoning"]);
const CRISIS = /suicid|kill (my ?self|me)|end (my|this) life|want to die|wanna die|self[- ]?harm|hurt myself|cut myself|no reason to live|marna (chahta|chahti|hai)|khud ko (khatam|maar)|jeena nahi|zindagi khatam/i;
const isId = (x) => mongoose.Types.ObjectId.isValid(String(x || ""));
const str = (v, n = 1000) => String(v ?? "").slice(0, n);
const pct = (v) => (v === null || v === undefined || v === "" ? null : Math.max(0, Math.min(100, Math.round(Number(v) || 0))));
const newCode = () => crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "").slice(0, 7) || crypto.randomBytes(4).toString("hex");

/* keep only known fields, with sane lengths */
function cleanActivity(d = {}) {
  const days = (Array.isArray(d.days) ? d.days : []).slice(0, 7).map((day) => {
    const out = {};
    for (const s of SLOTS) {
      const c = day?.[s];
      if (!c) continue;
      const cell = { did: str(c.did, 200), mood: str(c.mood, 30), mp: pct(c.mp), a: n10(c.a), c: n10(c.c), e: n10(c.e) };
      if (cell.did || cell.mood) out[s] = cell;
    }
    return out;
  });
  while (days.length < 7) days.push({});
  return { start: /^\d{4}-\d{2}-\d{2}$/.test(String(d.start || "")) ? d.start : "", days };
}
function cleanWhatIf(d = {}) {
  const pairs = (Array.isArray(d.pairs) ? d.pairs : []).slice(0, 8).map((p) => ({ bad: str(p?.bad, 500), good: str(p?.good, 500), likely: str(p?.likely, 500) }));
  return { worry: str(d.worry, 500), before: pct(d.before), pairs: pairs.length ? pairs : [{ bad: "", good: "", likely: "" }], cope: str(d.cope, 800), after: pct(d.after) };
}
const cleanFor = (tool, d, max) => (tool === "activity" ? cleanActivity(d) : tool === "whatif" ? cleanWhatIf(d) : cleanData(d, max));
const filledCells = (d) => (d?.days || []).reduce((n, day) => n + Object.keys(day || {}).length, 0);
const previewOf = (e, n = 90) => {
  if (e.tool === "activity") return filledCells(e.data) ? `${filledCells(e.data)} entries` : "";
  if (e.tool === "whatif") return str(e.data?.worry, n) ? `What if ${str(e.data.worry, n)}` : "";
  const logs = logsOf(e.data).filter((l) => String(l?.a?.what || "").trim());
  return logs.length ? `${logs.length > 1 ? `${logs.length} situations · ` : ""}${str(logs[logs.length - 1].a.what, n)}` : "";
};

/* Who can log many situations / start again: an ongoing client of that therapist (a paid session in the last
   120 days or one coming up, or the therapist sent it to them). Anyone else who came from a shared link gets
   ONE situation (one diary week) — more unlocks once they book. */
const ONGOING_DAYS = 120;
async function isOngoing(userId, therapistId, link) {
  if (link?.forClient && String(link.forClient) === String(userId)) return true;
  if (!therapistId) return false;
  return !!(await Booking.exists({
    client: userId, therapist: therapistId, status: { $ne: "Cancelled" },
    $or: [{ payment_status: "Paid" }, { source: "noida" }],
    booking_date: { $gte: new Date(Date.now() - ONGOING_DAYS * 864e5) },
  }));
}
const MAX_LOGS = 30;
const logsOf = (d) => (Array.isArray(d?.logs) ? d.logs : d?.a ? [d] : []);
function cleanData(d = {}, max = MAX_LOGS) {
  const logs = logsOf(d).slice(0, max).map(cleanLog);
  return { logs: logs.length ? logs : [cleanLog({})] };
}
function cleanLog(d = {}) {
  const a = d.a || {}, b = d.b || {}, c = d.c || {}, x = d.d || {};
  return {
    a: { what: str(a.what), when: str(a.when, 80) },
    b: { thought: str(b.thought), traps: (Array.isArray(b.traps) ? b.traps : []).filter((t) => TRAPS.has(t)).slice(0, 10), strength: pct(b.strength) },
    c: {
      feelings: (Array.isArray(c.feelings) ? c.feelings : []).slice(0, 8).map((f) => ({ k: str(f?.k, 30), v: pct(f?.v) })).filter((f) => f.k),
      body: str(c.body, 400), did: str(c.did),
    },
    d: {
      evidenceFor: str(x.evidenceFor), evidenceAgainst: str(x.evidenceAgainst), friend: str(x.friend), balanced: str(x.balanced),
      strengthAfter: pct(x.strengthAfter), feelAfter: pct(x.feelAfter), next: str(x.next, 400),
    },
  };
}
const textOf = (d) => JSON.stringify(d || {});

async function myTherapist(req) {
  return Therapists.findOne({ user: req.user._id }).populate({ path: "user", select: "name profile" }).lean();
}
const publicTherapist = (t) => (t ? {
  _id: String(t._id), name: t.user?.name || "Psychologist", photo: t.user?.profile || "", profile_type: t.profile_type || "", state: t.state || "",
  user: { name: t.user?.name || "" }, live: (t.show_to_page || 0) > 0,
} : null);
const entryRow = (e, withData) => ({
  _id: String(e._id), tool: e.tool, title: TOOLS[e.tool] || e.tool, status: e.status, step: e.step || 0, note: e.note || "",
  submittedAt: e.submittedAt, reviewedAt: e.reviewedAt, feedback: e.feedback || "", flag: !!e.flag, updatedAt: e.updatedAt, createdAt: e.createdAt,
  ...(withData ? { data: e.data || {} } : { preview: previewOf(e) }),
});

/* ── therapist ── */

// GET /api/therapist/worksheets — my links, worksheets clients sent me, my clients (for "Send to a client")
export const therapistWorksheets = expressAsyncHandler(async (req, res) => {
  const t = await myTherapist(req);
  if (!t) return res.status(404).json({ status: false, message: "Therapist profile not found" });
  const [links, entries, clientIds] = await Promise.all([
    WorksheetLink.find({ therapistUser: req.user._id }).populate({ path: "forClient", select: "name" }).sort({ createdAt: -1 }).limit(100).lean(),
    WorksheetEntry.find({ therapistUser: req.user._id }).populate({ path: "user", select: "name profile" }).sort({ updatedAt: -1 }).limit(200).lean(),
    Booking.distinct("client", { therapist: t._id, $or: [{ payment_status: "Paid" }, { source: "noida" }] }),
  ]);
  const clients = await User.find({ _id: { $in: clientIds.filter(Boolean) }, role: 0 }, { name: 1, profile: 1 }).sort({ name: 1 }).limit(300).lean();
  res.json({
    status: true,
    data: {
      therapist: publicTherapist(t),
      links: links.map((l) => ({ _id: String(l._id), code: l.code, tool: l.tool, note: l.note, forClient: l.forClient ? { id: String(l.forClient._id), name: l.forClient.name } : null, opens: l.opens, starts: l.starts, bookClicks: l.bookClicks, createdAt: l.createdAt })),
      // a client's answers show only after they send it; until then the therapist sees that it was started
      entries: entries.map((e) => ({ ...entryRow(e, false), preview: ["submitted", "reviewed"].includes(e.status) ? previewOf(e) : "", client: { id: String(e.user?._id || ""), name: e.user?.name || "Client", photo: e.user?.profile || "" } })),
      clients: clients.map((c) => ({ id: String(c._id), name: c.name, photo: c.profile || "" })),
    },
  });
});

// POST /api/therapist/worksheets/link { tool, note, client } — a share link; with client: sent straight to them
export const createWorksheetLink = expressAsyncHandler(async (req, res) => {
  const tool = TOOLS[req.body?.tool] ? req.body.tool : "abcd";
  const t = await myTherapist(req);
  if (!t) return res.status(404).json({ status: false, message: "Therapist profile not found" });
  let client = null;
  if (req.body?.client) {
    if (!isId(req.body.client)) return res.status(400).json({ status: false, message: "Choose a client" });
    const ok = await Booking.exists({ therapist: t._id, client: req.body.client });
    if (!ok) return res.status(403).json({ status: false, message: "You can send worksheets only to your own clients" });
    client = await User.findById(req.body.client, { name: 1 }).lean();
  }
  let link = null;
  for (let i = 0; i < 5 && !link; i++) {
    try { link = await WorksheetLink.create({ code: newCode(), tool, therapist: t._id, therapistUser: req.user._id, note: str(req.body?.note, 300), forClient: client?._id || null }); }
    catch (e) { if (e?.code !== 11000) throw e; }
  }
  if (!link) return res.status(500).json({ status: false, message: "Couldn't make a link, try again" });
  if (client) {
    // it waits in the client's My Space, ready to fill
    await WorksheetEntry.create({ user: client._id, tool, link: link._id, therapist: t._id, therapistUser: req.user._id, note: link.note, status: "assigned" });
    await notifyClient(client._id, { type: "worksheet", title: `${t.user?.name || "Your therapist"} sent you a worksheet`, body: `${TOOLS[tool]}${link.note ? ` — “${link.note}”` : ""}`, link: "/client/worksheets", ref: `worksheet:${link._id}` });
  }
  res.json({ status: true, data: { code: link.code, path: `/worksheet/${link.code}`, client: client ? { id: String(client._id), name: client.name } : null } });
});

// GET /api/therapist/worksheets/entries/:id — a client's worksheet (answers only once sent)
export const therapistEntry = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid worksheet" });
  const e = await WorksheetEntry.findOne({ _id: req.params.id, therapistUser: req.user._id }).populate({ path: "user", select: "name profile" }).lean();
  if (!e) return res.status(404).json({ status: false, message: "Worksheet not found" });
  const shared = ["submitted", "reviewed"].includes(e.status);
  res.json({ status: true, data: { ...entryRow(e, shared), shared, client: { id: String(e.user?._id || ""), name: e.user?.name || "Client", photo: e.user?.profile || "" } } });
});

// PUT /api/therapist/worksheets/entries/:id/review { feedback }
export const reviewEntry = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid worksheet" });
  const e = await WorksheetEntry.findOne({ _id: req.params.id, therapistUser: req.user._id, status: { $in: ["submitted", "reviewed"] } });
  if (!e) return res.status(404).json({ status: false, message: "Worksheet not found" });
  e.feedback = str(req.body?.feedback, 2000).trim();
  e.status = "reviewed"; e.reviewedAt = new Date();
  await e.save();
  await notifyClient(e.user, { type: "worksheet", title: `${req.user.name || "Your therapist"} reviewed your worksheet`, body: e.feedback.slice(0, 160), link: `/client/worksheets/${e._id}`, ref: `worksheet-review:${e._id}:${e.reviewedAt.getTime()}` });
  res.json({ status: true, message: "Feedback sent", data: entryRow(e.toObject(), true) });
});

/* ── public ── */

// GET /api/worksheet-link/:code — what the shared link shows
export const publicLink = expressAsyncHandler(async (req, res) => {
  const code = String(req.params.code || "").slice(0, 20);
  const l = await WorksheetLink.findOneAndUpdate({ code }, req.query.count === "0" ? {} : { $inc: { opens: 1 } }, { new: true })
    .populate({ path: "therapist", select: "user profile_type state show_to_page", populate: { path: "user", select: "name profile" } }).lean();
  if (!l) return res.status(404).json({ status: false, message: "This worksheet link isn't valid any more" });
  res.json({ status: true, data: { code: l.code, tool: l.tool, title: TOOLS[l.tool], note: l.note, therapist: publicTherapist(l.therapist), forClient: !!l.forClient } });
});

// POST /api/worksheet-link/:code/book — counts a Book click from the worksheet
export const linkBookClick = expressAsyncHandler(async (req, res) => {
  await WorksheetLink.updateOne({ code: String(req.params.code || "").slice(0, 20) }, { $inc: { bookClicks: 1 } });
  res.json({ status: true });
});

/* ── client (any signed-in user) ── */

// POST /api/my-worksheets/start { code } — open the worksheet from a link in my dashboard (reuses my unfinished one)
export const startFromLink = expressAsyncHandler(async (req, res) => {
  const l = await WorksheetLink.findOne({ code: String(req.body?.code || "").slice(0, 20) }).lean();
  if (!l) return res.status(404).json({ status: false, message: "This worksheet link isn't valid any more" });
  if (String(l.therapistUser) === String(req.user._id)) return res.status(400).json({ status: false, message: "This is your own worksheet link — share it with a client" });
  let e = await WorksheetEntry.findOne({ user: req.user._id, link: l._id, status: { $in: ["assigned", "draft"] } });
  if (!e && !(await isOngoing(req.user._id, l.therapist, l))) {
    // free use is once per therapist and worksheet — the same one opens again
    const used = await WorksheetEntry.findOne({ user: req.user._id, therapistUser: l.therapistUser, tool: l.tool }).sort({ updatedAt: -1 });
    if (used) return res.json({ status: true, data: { id: String(used._id), limited: true } });
  }
  if (!e) {
    e = await WorksheetEntry.create({ user: req.user._id, tool: l.tool, link: l._id, therapist: l.therapist, therapistUser: l.therapistUser, note: l.note, status: "draft" });
    await WorksheetLink.updateOne({ _id: l._id }, { $inc: { starts: 1 } });
  }
  res.json({ status: true, data: { id: String(e._id) } });
});

// GET /api/my-worksheets
export const myWorksheets = expressAsyncHandler(async (req, res) => {
  const rows = await WorksheetEntry.find({ user: req.user._id })
    .populate({ path: "therapist", select: "user profile_type state show_to_page", populate: { path: "user", select: "name profile" } })
    .sort({ updatedAt: -1 }).limit(200).lean();
  res.json({ status: true, data: rows.map((e) => ({ ...entryRow(e, false), therapist: publicTherapist(e.therapist) })) });
});

// GET /api/my-worksheets/:id
export const myWorksheet = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid worksheet" });
  const e = await WorksheetEntry.findOne({ _id: req.params.id, user: req.user._id })
    .populate({ path: "therapist", select: "user profile_type state show_to_page", populate: { path: "user", select: "name profile" } }).lean();
  if (!e) return res.status(404).json({ status: false, message: "Worksheet not found" });
  const link = e.link ? await WorksheetLink.findById(e.link, { forClient: 1 }).lean() : null;
  const ongoing = await isOngoing(req.user._id, e.therapist?._id, link);
  res.json({ status: true, data: { ...entryRow(e, true), therapist: publicTherapist(e.therapist), ongoing, maxLogs: ongoing ? MAX_LOGS : 1 } });
});

// PUT /api/my-worksheets/:id { data, step, submit }
export const saveMyWorksheet = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid worksheet" });
  const e = await WorksheetEntry.findOne({ _id: req.params.id, user: req.user._id });
  if (!e) return res.status(404).json({ status: false, message: "Worksheet not found" });
  if (req.body?.data) {
    let max = MAX_LOGS;
    if (e.tool === "abcd" && e.therapist) {
      const link = e.link ? await WorksheetLink.findById(e.link, { forClient: 1 }).lean() : null;
      if (!(await isOngoing(req.user._id, e.therapist, link))) max = 1;
    }
    e.data = cleanFor(e.tool, req.body.data, max); e.markModified("data");
  }
  if (req.body?.step != null) e.step = Math.max(0, Math.min(5, Number(req.body.step) || 0));
  if (e.status === "assigned") e.status = "draft";
  const flag = CRISIS.test(textOf(e.data));
  let alerted = false;
  if (req.body?.submit && e.therapistUser) {
    const empty = e.tool === "activity" ? !filledCells(e.data) : e.tool === "whatif" ? !String(e.data?.worry || "").trim() : !logsOf(e.data).some((l) => String(l?.a?.what || "").trim());
    if (empty) return res.status(400).json({ status: false, message: e.tool === "activity" ? "Fill at least one time slot first" : e.tool === "whatif" ? "Write your what-if first" : "Write what happened (step A) first" });
    e.status = "submitted"; e.submittedAt = new Date();
    e.flag = flag;
    const who = req.user.name || "A client";
    await notifyTherapists([e.therapistUser], {
      type: flag ? "action" : "notice",
      title: flag ? `⚠ ${who}'s worksheet mentions self-harm — please reach out` : `${who} sent you a worksheet`,
      body: `${TOOLS[e.tool] || "Worksheet"}${previewOf(e, 120) ? `: “${previewOf(e, 120)}”` : ""}`,
      link: `/therapists/toolkit?entry=${e._id}`, ref: `worksheet-sent:${e._id}:${e.submittedAt.getTime()}`,
    });
    alerted = true;
  }
  await e.save();
  res.json({ status: true, message: alerted ? "Sent to your therapist" : "Saved", data: { status: e.status, flag, updatedAt: e.updatedAt } });
});

// DELETE /api/my-worksheets/:id
export const deleteMyWorksheet = expressAsyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ status: false, message: "Invalid worksheet" });
  await WorksheetEntry.deleteOne({ _id: req.params.id, user: req.user._id });
  res.json({ status: true, message: "Deleted" });
});
