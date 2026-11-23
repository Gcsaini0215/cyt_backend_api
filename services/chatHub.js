// Live chat events over Server-Sent Events (2026-11-23). In memory on purpose, like services/therapistNotify.js:
// the backend runs as a single pm2 fork process. Users (clients + therapists) get events for their own threads;
// admins with chat access get every thread's events for the live Chat Monitor.

const users = new Map(); // userId -> Set(res)
const admins = new Set(); // res

export function addChatClient(res, userId) {
  const id = String(userId);
  if (!users.has(id)) users.set(id, new Set());
  users.get(id).add(res);
  return () => { const s = users.get(id); if (!s) return; s.delete(res); if (!s.size) users.delete(id); };
}
export function addChatAdmin(res) { admins.add(res); return () => admins.delete(res); }

const write = (res, event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); return true; } catch { return false; } };

export function toUser(userId, event, data) {
  const s = users.get(String(userId));
  if (!s) return;
  for (const res of s) if (!write(res, event, data)) s.delete(res);
}
export function toAdmins(event, data) { for (const res of admins) if (!write(res, event, data)) admins.delete(res); }
export const isOnline = (userId) => users.has(String(userId));

// keep connections alive through nginx / mobile networks
setInterval(() => {
  for (const s of users.values()) for (const res of s) write(res, "ping", { t: Date.now() });
  for (const res of admins) write(res, "ping", { t: Date.now() });
}, 25000).unref?.();
