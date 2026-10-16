// Client portal notifications — same idea as services/therapistNotify.js: saved (nothing is missed
// while the portal is closed) and pushed live over Server-Sent Events to every open tab of that
// client. `changed()` sends a lightweight "bookings" event with nothing stored, so an open dashboard
// refreshes itself when a session starts, moves or ends. In memory: single pm2 fork process.
import mongoose from "mongoose";
import ClientNotification from "../models/ClientNotification.js";

const clients = new Map(); // userId -> Set(res)

export function addClientStream(res, userId) {
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

export const toClientRow = (n) => ({
  _id: String(n._id), type: n.type, title: n.title, body: n.body || "", link: n.link || "",
  createdAt: n.createdAt, read: !!n.read_at,
});

const idOf = (u) => String(u?._id || u || "");

// userId: the client's Users _id. n: { type, title, body?, link?, ref? }. Never throws.
export async function notifyClient(userId, n) {
  try {
    const user = idOf(userId);
    if (!mongoose.Types.ObjectId.isValid(user) || !n?.title) return;
    if (n.ref && await ClientNotification.exists({ user, ref: n.ref, type: n.type })) return;
    const d = await ClientNotification.create({
      user, type: n.type, title: String(n.title).slice(0, 200), body: String(n.body || "").slice(0, 600), link: n.link || "", ref: n.ref || "",
    });
    send(user, "notif", toClientRow(d));
    send(user, "bookings", { at: Date.now() });
  } catch (e) {
    console.error("[client-notify] failed:", e.message);
  }
}

// something about this client's bookings changed — open dashboards refetch (nothing stored)
export const changed = (userId) => { try { send(idOf(userId), "bookings", { at: Date.now() }); } catch { /* ignore */ } };

// read on one device → other open tabs update their badge
export const emitClientRead = (userId, ids) => send(idOf(userId), "read", { ids: ids || "all" });

// keep proxies (nginx) from closing idle streams
setInterval(() => {
  for (const set of clients.values()) {
    for (const res of set) {
      try { res.write(": ping\n\n"); } catch { set.delete(res); }
    }
  }
}, 25000).unref();
