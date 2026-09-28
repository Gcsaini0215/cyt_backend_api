// Live updates for the staff system over Server-Sent Events.
//
// Every open dashboard keeps one EventSource to /api/staff/stream. When anything staff-related changes
// (check-in, task done, new notice…) the controller calls emitStaff(), and each connected browser gets a
// tiny "changed" event and refetches — so updates show up in well under a second, with no polling.
// In memory on purpose: it needs the single pm2 fork process the backend already runs as.

const clients = new Set(); // { res, adminId, manager }

export function addStaffClient(res, adminId, manager) {
  const client = { res, adminId: String(adminId), manager: !!manager };
  clients.add(client);
  return () => clients.delete(client);
}

// scope: what changed ("attendance" | "tasks" | "notices" | "settings");
// adminIds: staff members it concerns (null = everyone). Managers always hear about every change.
export function emitStaff(scope, adminIds = null) {
  const ids = adminIds ? new Set(adminIds.map(String)) : null;
  const payload = `event: changed\ndata: ${JSON.stringify({ scope, at: Date.now() })}\n\n`;
  for (const c of clients) {
    if (!c.manager && ids && !ids.has(c.adminId)) continue;
    try { c.res.write(payload); } catch { clients.delete(c); }
  }
}

// keep proxies (nginx) from closing idle streams
setInterval(() => {
  for (const c of clients) {
    try { c.res.write(": ping\n\n"); } catch { clients.delete(c); }
  }
}, 25000).unref();
