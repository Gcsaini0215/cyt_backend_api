// Live "who is on the booking page right now" counter for the reception screen.
//
// Visitors' browsers ping every ~25s while the tab is visible; anything not heard from for TTL_MS is
// dropped. State is in memory on purpose — it is a live gauge, not a record — so it resets on restart
// (visitors reappear within one ping) and needs a single server process (pm2 fork mode, as deployed).
// Nothing personal is stored: a random session id, the booking stage, the device class and the traffic source.

const TTL_MS = 45 * 1000;
const MAX_ENTRIES = 5000; // hard ceiling so a flood of fake ids can't grow memory without bound
const MAX_PER_IP = 12; // one address (a shared office/college network) can't inflate the gauge with invented visitors
const STAGES = new Set(["browsing", "form", "payment"]);
const DEVICES = new Set(["mobile", "tablet", "desktop"]);
const BOT_RE = /bot|crawl|spider|headless|lighthouse|pagespeed|preview|monitor|uptime/i;
// Where the visitor came from, as worked out by the booking page: a known channel, "ref:<code>" for a
// referral link, or "site:<host>" for any other referring website. Anything else is counted as "other".
const SOURCES = new Set(["direct", "whatsapp", "instagram", "facebook", "google", "google-ads", "youtube", "linkedin", "twitter", "snapchat", "telegram", "email", "sms", "qr", "website"]);
const cleanSource = (s) => {
  if (typeof s !== "string") return "direct";
  const v = s.trim().toLowerCase().slice(0, 48);
  if (SOURCES.has(v)) return v;
  if (/^ref:[a-z0-9_-]{1,32}$/.test(v)) return v;
  if (/^site:[a-z0-9.-]{3,44}$/.test(v)) return v;
  return "other";
};

const sessions = new Map(); // sid -> { at, stage, device, source, ip }

const prune = (now) => {
  for (const [sid, v] of sessions) if (now - v.at > TTL_MS) sessions.delete(sid);
};

/* POST /api/noida-appointments/presence — public heartbeat from the booking page */
export const pingNoidaPresence = (req, res) => {
  const { sid, stage, device, source, leave } = req.body || {};
  if (typeof sid !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(sid)) {
    return res.status(400).json({ status: false, message: "Bad session id" });
  }
  if (leave) {
    sessions.delete(sid);
    return res.json({ status: true });
  }
  if (BOT_RE.test(req.headers["user-agent"] || "")) return res.json({ status: true });

  const now = Date.now();
  const ip = req.ip || "";
  const known = sessions.has(sid);
  if (!known) {
    prune(now);
    let sameIp = 0;
    for (const v of sessions.values()) if (v.ip === ip) sameIp++;
    if (sessions.size >= MAX_ENTRIES || sameIp >= MAX_PER_IP) return res.json({ status: true }); // silently ignored
  }
  sessions.set(sid, {
    at: now,
    ip,
    stage: STAGES.has(stage) ? stage : "browsing",
    device: DEVICES.has(device) ? device : "desktop",
    source: cleanSource(source),
  });
  res.json({ status: true });
};

/* GET /api/noida-appointments/presence — reception/admin: current counts */
export const getNoidaPresence = (req, res) => {
  const now = Date.now();
  prune(now);
  const out = { live: 0, browsing: 0, form: 0, payment: 0, mobile: 0, tablet: 0, desktop: 0 };
  const bySource = new Map();
  for (const v of sessions.values()) {
    out.live++;
    out[v.stage]++;
    out[v.device]++;
    bySource.set(v.source || "direct", (bySource.get(v.source || "direct") || 0) + 1);
  }
  // most visitors first, e.g. [{ source: "instagram", count: 3 }, { source: "ref:priya", count: 1 }]
  const sources = [...bySource].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
  res.json({ status: true, data: { ...out, sources, ttlSeconds: TTL_MS / 1000, at: new Date(now).toISOString() } });
};
