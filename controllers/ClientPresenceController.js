import expressAsyncHandler from "express-async-handler";
import User from "../models/Users.js";
import Therapists from "../models/Therapists.js";

/* Who is logged in on the website right now — for Admin → Client 360 "Live now".
   A logged-in client's browser pings every ~45 s while the tab is visible (and says "leave" when the tab
   closes); anyone not heard from for TTL_MS drops off. Kept in memory on purpose (a live gauge, not a record),
   like the Noida "viewing now" counter, so it resets on restart and needs one server process (pm2 fork).
   Each ping also refreshes User.last_visit, at most once every SAVE_EVERY_MS, so "Last seen" stays true. */

const TTL_MS = 90 * 1000;
const SAVE_EVERY_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 5000;
const DEVICES = new Set(["mobile", "tablet", "desktop"]);

const online = new Map(); // userId -> { at, since, path, device, app, saved }

const prune = (now) => { for (const [id, v] of online) if (now - v.at > TTL_MS) online.delete(id); };
const cleanPath = (p) => {
  const s = typeof p === "string" ? p.split(/[?#]/)[0].slice(0, 120) : "";
  return /^\/[A-Za-z0-9/_\-.~%]*$/.test(s) ? s : "/";
};

/* ids of clients online now (used by the Client 360 list "Live now" filter and dots) */
export const onlineIdsByRole = (role) => { prune(Date.now()); return new Set([...online].filter(([, v]) => v.role === role).map(([k]) => k)); };
export const onlineClientIds = () => onlineIdsByRole(0);
export const onlineInfo = (id) => { const v = online.get(String(id)); return v && Date.now() - v.at <= TTL_MS ? v : null; };

/* POST /api/me/presence { path, device, app, leave } — heartbeat from a logged-in client */
export const pingPresence = expressAsyncHandler(async (req, res) => {
  const u = req.user;
  if (!u || (u.role !== 0 && u.role !== 1)) return res.json({ status: true }); // clients and therapists are tracked
  const id = String(u._id);
  const { path, device, app, leave } = req.body || {};
  const now = Date.now();
  if (leave) { online.delete(id); return res.json({ status: true }); }
  const prev = online.get(id);
  if (!prev) { prune(now); if (online.size >= MAX_ENTRIES) return res.json({ status: true }); }
  const fresh = !prev || now - prev.at > TTL_MS;
  const entry = {
    at: now,
    role: u.role,
    since: fresh ? now : prev.since,
    path: cleanPath(path),
    device: DEVICES.has(device) ? device : "desktop",
    app: !!app,
    saved: prev?.saved || 0,
  };
  if (now - entry.saved > SAVE_EVERY_MS) {
    entry.saved = now;
    User.updateOne({ _id: u._id }, { $set: { last_visit: new Date(now) } }).catch(() => {});
  }
  online.set(id, entry);
  res.json({ status: true });
});

/* GET /api/admin/client-360/live?role=0|1 — clients (or therapists) online now, newest activity first */
export const liveClients = expressAsyncHandler(async (req, res) => {
  const now = Date.now();
  prune(now);
  const role = /therapist-360/.test(req.originalUrl || "") || String(req.query.role) === "1" ? 1 : 0;
  const ids = [...onlineIdsByRole(role)];
  const users = ids.length ? await User.find({ _id: { $in: ids }, role }, { name: 1, email: 1, phone: 1, profile: 1 }).lean() : [];
  const data = users.map((u) => {
    const v = online.get(String(u._id));
    return { _id: String(u._id), name: u.name, email: u.email, phone: u.phone, photo: u.profile || "", path: v.path, device: v.device, app: v.app, since: new Date(v.since), at: new Date(v.at) };
  }).sort((a, b) => b.at - a.at);
  // therapists: the Therapist 360 page opens by the therapist profile id
  if (role === 1 && data.length) {
    const th = await Therapists.find({ user: { $in: data.map((x) => x._id) } }, { user: 1 }).lean();
    const T = new Map(th.map((x) => [String(x.user), String(x._id)]));
    for (const x of data) x.tid = T.get(x._id) || "";
  }
  // seen in the last 24 h (from last_visit) — a quick "today" figure next to the live count
  const today = await User.countDocuments({ role, last_visit: { $gte: new Date(now - 24 * 3600 * 1000) } });
  res.json({ status: true, data, count: data.length, today });
});
