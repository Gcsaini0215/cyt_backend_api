// Trainee portal notifications — saved (nothing is missed while the portal is closed) and pushed live over
// Server-Sent Events to every open tab of that trainee (keyed by email). `traineeChanged()` sends a light
// "changed" event with nothing stored, so open pages refetch (e.g. a check-in from another tab, an admin edit).
// In memory: single pm2 fork process — same as services/clientNotify.js.
import TraineeNotification from "../models/TraineeNotification.js";

const streams = new Map(); // email -> Set(res)

export function addTraineeStream(res, email) {
  const id = String(email).toLowerCase();
  if (!streams.has(id)) streams.set(id, new Set());
  streams.get(id).add(res);
  return () => {
    const set = streams.get(id);
    if (!set) return;
    set.delete(res);
    if (!set.size) streams.delete(id);
  };
}

function send(email, event, data) {
  const set = streams.get(String(email).toLowerCase());
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { set.delete(res); }
  }
}

export const toTraineeRow = (n) => ({
  _id: String(n._id), type: n.type, title: n.title, body: n.body || "", link: n.link || "",
  createdAt: n.createdAt, read: !!n.read_at,
});

// emails: one or many. n: { type, title, body?, link? }. Never throws.
export async function notifyTrainees(emails, n) {
  try {
    const list = [...new Set((Array.isArray(emails) ? emails : [emails]).map((e) => String(e || "").toLowerCase().trim()).filter(Boolean))];
    if (!list.length || !n?.title) return;
    const docs = await TraineeNotification.insertMany(list.map((email) => ({
      email, type: n.type, title: String(n.title).slice(0, 200), body: String(n.body || "").slice(0, 600), link: n.link || "",
    })));
    for (const d of docs) {
      send(d.email, "notif", toTraineeRow(d));
      send(d.email, "changed", { scope: n.type, at: Date.now() });
    }
  } catch (e) {
    console.error("[trainee-notify] failed:", e.message);
  }
}

// something changed for this trainee (or everyone, when email is "*") — open pages refetch, nothing stored
export function traineeChanged(email, scope) {
  try {
    if (email === "*") { for (const e of streams.keys()) send(e, "changed", { scope, at: Date.now() }); return; }
    send(email, "changed", { scope, at: Date.now() });
  } catch { /* ignore */ }
}

export const emitTraineeRead = (email, ids) => send(email, "read", { ids: ids || "all" });

// keep proxies (nginx) from closing idle streams
setInterval(() => {
  for (const set of streams.values()) {
    for (const res of set) {
      try { res.write(": ping\n\n"); } catch { set.delete(res); }
    }
  }
}, 25000).unref();
