// Therapist portal notifications: saved (so nothing is missed while the portal is closed) and pushed
// live over Server-Sent Events to every open portal tab of that therapist (the bell pops up at once).
// In memory on purpose, like services/staffEvents.js: the backend runs as a single pm2 fork process.
import mongoose from "mongoose";
import TherapistNotification from "../models/TherapistNotification.js";
import Therapists from "../models/Therapists.js";

const clients = new Map(); // userId -> Set(res)

export function addTherapistClient(res, userId) {
  const id = String(userId);
  if (!clients.has(id)) clients.set(id, new Set());
  clients.get(id).add(res);
  return () => {
    const set = clients.get(id);
    if (!set) return;
    set.delete(res);
    if (!set.size) clients.delete(id);
  };
}

function send(userId, event, data) {
  const set = clients.get(String(userId));
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { set.delete(res); }
  }
}

export const toClient = (n) => ({
  _id: String(n._id), type: n.type, title: n.title, body: n.body || "", link: n.link || "",
  createdAt: n.createdAt, read: !!n.read_at,
});

// userIds: therapists' Users _ids. n: { type, title, body?, link?, ref? }.
// Never throws — a notification must not break the action that caused it.
export async function notifyTherapists(userIds, n) {
  try {
    const ids = [...new Set((userIds || []).filter(Boolean).map(String))].filter((x) => mongoose.Types.ObjectId.isValid(x));
    if (!ids.length || !n?.title) return;
    let targets = ids;
    if (n.ref) {
      const already = await TherapistNotification.find({ user: { $in: ids }, ref: n.ref, type: n.type }).select("user").lean();
      const done = new Set(already.map((d) => String(d.user)));
      targets = ids.filter((x) => !done.has(x));
      if (!targets.length) return;
    }
    const docs = await TherapistNotification.insertMany(targets.map((user) => ({
      user, type: n.type, title: String(n.title).slice(0, 200), body: String(n.body || "").slice(0, 600), link: n.link || "", ref: n.ref || "",
    })));
    for (const d of docs) send(d.user, "notif", toClient(d));
  } catch (e) {
    console.error("[therapist-notify] failed:", e.message);
  }
}

// a Therapists _id → that therapist's Users _id
export async function therapistUserId(therapistId) {
  if (!therapistId) return null;
  if (therapistId.user) return therapistId.user._id || therapistId.user;
  const t = await Therapists.findById(therapistId).select("user").lean();
  return t?.user || null;
}

// read state changed on one device → the other open tabs update their badge
export const emitRead = (userId, ids) => send(userId, "read", { ids: ids || "all" });

// keep proxies (nginx) from closing idle streams
setInterval(() => {
  for (const set of clients.values()) {
    for (const res of set) {
      try { res.write(": ping\n\n"); } catch { set.delete(res); }
    }
  }
}, 25000).unref();
