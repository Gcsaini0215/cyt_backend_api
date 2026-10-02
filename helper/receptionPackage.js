import ReceptionClient from "../models/ReceptionClient.js";
import NoidaClientCredit from "../models/NoidaClientCredit.js";

/* Package-session bookkeeping shared by Reception (walk-ins) and CYT Noida
   (online / desk bookings that draw from a Reception package).

   Every change to a Reception client's `package.used` goes through these
   atomic helpers (never a whole-document save), bumps `rev` so a stale
   browser copy can't overwrite it, and appends a `sessionLog` entry so the
   count can always be explained:
     kind: assign | clinic | clinic-prebooked | booking | cancel | rebook |
           delete-refund | manual | recount
*/

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const logEntry = (kind, delta, extra = {}) => {
  const { kind: _ignored, ...rest } = extra || {};
  return { id: uid(), at: new Date().toISOString(), kind, delta, ...rest };
};

// Optimistic lock on the value we just read. Older records may hold `used` as a
// string ("2") or not at all — the old filter `"package.used": 0` never matched
// those, which is why some package bookings failed with "just claimed elsewhere".
const usedIs = (used) => (used === 0
  ? { $or: [{ "package.used": { $in: [0, "0", null] } }, { "package.used": { $exists: false } }] }
  : { "package.used": { $in: [used, String(used)] } });

/** Take one session from a Reception package (used +1). Returns the doc or null if none left. */
export async function claimReceptionSession(clientId, extra) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = await ReceptionClient.findOne({ id: clientId }).lean();
    if (!doc?.package) return null;
    const used = Number(doc.package.used) || 0;
    const total = Number(doc.package.total) || 0;
    if (used >= total) return null;
    const out = await ReceptionClient.findOneAndUpdate(
      { id: clientId, ...usedIs(used) },
      {
        $set: { "package.used": used + 1 },
        $inc: { rev: 1 },
        $push: { sessionLog: logEntry(extra?.kind || "booking", 1, extra) },
      },
      { new: true, lean: true }
    );
    if (out) return out;
  }
  return null;
}

/** Give one session back to a Reception package (used −1, never below 0). */
export async function refundReceptionSession(clientId, extra) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const doc = await ReceptionClient.findOne({ id: clientId }).lean();
    const used = Number(doc?.package?.used) || 0;
    if (!doc?.package || used <= 0) return null;
    const out = await ReceptionClient.findOneAndUpdate(
      { id: clientId, ...usedIs(used) },
      {
        $set: { "package.used": used - 1 },
        $inc: { rev: 1 },
        $push: { sessionLog: logEntry(extra?.kind || "cancel", -1, extra) },
      },
      { new: true, lean: true }
    );
    if (out) return out;
  }
  return null;
}

/** Give one session back to a Noida (online-purchase) credit. */
export async function refundNoidaCredit(creditId) {
  return NoidaClientCredit.findOneAndUpdate(
    { _id: creditId, sessionsUsed: { $gt: 0 } },
    { $inc: { sessionsUsed: -1 } },
    { new: true }
  );
}

/** Take one session from a Noida credit again (re-confirming a cancelled booking). */
export async function reclaimNoidaCredit(creditId) {
  const c = await NoidaClientCredit.findById(creditId).lean();
  if (!c || c.sessionsUsed >= c.totalSessions) return null;
  return NoidaClientCredit.findOneAndUpdate(
    { _id: creditId, sessionsUsed: c.sessionsUsed },
    { $inc: { sessionsUsed: 1 } },
    { new: true }
  );
}

/** Most recent time a session was taken from this Reception client's package. */
export function lastUsedOf(doc) {
  const takes = (doc?.sessionLog || []).filter((e) => e.delta > 0 && e.kind !== "assign");
  const lastLog = takes.length ? takes[takes.length - 1] : null;
  const lastAtt = (doc?.attendance || []).filter((a) => a.status === "attended").slice(-1)[0];
  const logAt = lastLog ? new Date(lastLog.at) : null;
  const attAt = lastAtt?.date ? new Date(lastAtt.date) : null;
  if (logAt && (!attAt || logAt >= attAt)) return { at: lastLog.at, kind: lastLog.kind };
  if (attAt) return { at: lastAtt.date, kind: "clinic" };
  return null;
}
