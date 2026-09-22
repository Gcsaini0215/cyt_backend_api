import NoidaClient from "../models/NoidaClient.js";
import NoidaCounter from "../models/NoidaCounter.js";
import NoidaAppointment from "../models/NoidaAppointment.js";
import NoidaClientCredit from "../models/NoidaClientCredit.js";

const PREFIX = "CT-";
const format = (n) => PREFIX + String(n).padStart(4, "0");

// A 10-digit phone matched against a free-typed phone string (spaces, +91, dashes, etc.) —
// used wherever a client is looked up by phone across systems whose phone fields aren't
// stored the same way (e.g. the walk-in Reception client list, which is a plain string the
// front desk types by hand). `phoneTailRegex` narrows a DB query to candidates; `samePhone`
// then confirms the trailing 10 digits actually match (the regex alone can over-match).
export function phoneTailRegex(phone) {
  return new RegExp(String(phone).split("").join("\\D*") + "$");
}
export function samePhone(candidate, phone) {
  return String(candidate || "").replace(/\D/g, "").slice(-10) === String(phone || "").trim();
}

async function nextNumber() {
  const c = await NoidaCounter.findOneAndUpdate({ _id: "client" }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return c.seq;
}

// The client's permanent number — handed out on first sight of this phone,
// the same one every time after that.
const inflight = new Map(); // phone -> promise, so simultaneous requests for one new client share one number

export function ensureClientCode({ phone, name }) {
  const p = String(phone || "").trim();
  if (!p) return Promise.resolve("");
  if (inflight.has(p)) return inflight.get(p);
  const job = createOrFind(p, name).finally(() => inflight.delete(p));
  inflight.set(p, job);
  return job;
}

async function createOrFind(p, name) {
  const existing = await NoidaClient.findOne({ phone: p }).lean();
  if (existing) return existing.code;
  try {
    const seq = await nextNumber();
    const doc = await NoidaClient.create({ phone: p, code: format(seq), seq, name: String(name || "").trim() });
    return doc.code;
  } catch (err) {
    if (err.code === 11000) { // two requests for a brand-new client at once — the other one won
      const again = await NoidaClient.findOne({ phone: p }).lean();
      if (again) return again.code;
    }
    throw err;
  }
}

// One-time catch-up for clients who booked before numbers existed: numbered
// in the order they first appeared, then stamped on their appointments.
// Safe to run again — it only fills gaps.
async function backfill() {
  const [fromAppointments, fromCredits] = await Promise.all([
    NoidaAppointment.aggregate([{ $group: { _id: "$phone", first: { $min: "$createdAt" }, name: { $first: "$name" } } }]),
    NoidaClientCredit.aggregate([{ $group: { _id: "$phone", first: { $min: "$createdAt" }, name: { $first: "$name" } } }]),
  ]);
  const byPhone = new Map();
  for (const row of [...fromAppointments, ...fromCredits]) {
    if (!row._id) continue;
    const prev = byPhone.get(row._id);
    if (!prev || (row.first && prev.first && row.first < prev.first)) byPhone.set(row._id, row);
  }
  const have = new Set((await NoidaClient.find({}, "phone").lean()).map((c) => c.phone));
  const missing = [...byPhone.values()].filter((r) => !have.has(String(r._id).trim())).sort((a, b) => new Date(a.first) - new Date(b.first));
  for (const r of missing) await ensureClientCode({ phone: r._id, name: r.name });

  // A number handed out under an older prefix keeps its digits, just under the current prefix.
  const stale = await NoidaClient.find({ code: { $not: new RegExp("^" + PREFIX) } }).lean();
  for (const c of stale) {
    const code = format(c.seq);
    await NoidaClient.updateOne({ _id: c._id }, { code });
    await NoidaAppointment.updateMany({ clientCode: c.code }, { clientCode: code });
  }

  const clients = await NoidaClient.find({}).lean();
  if (clients.length) {
    await NoidaAppointment.bulkWrite(clients.map((c) => ({
      updateMany: {
        filter: { phone: c.phone, $or: [{ clientCode: { $exists: false } }, { clientCode: "" }] },
        update: { $set: { clientCode: c.code } },
      },
    })));
  }
}

let backfillPromise = null;
export function ensureBackfilled() {
  if (!backfillPromise) {
    backfillPromise = backfill().catch((err) => {
      console.error("Client number backfill failed (will retry):", err.message);
      backfillPromise = null;
    });
  }
  return backfillPromise;
}

// { phone -> code } for a set of phones.
export async function clientCodesFor(phones) {
  const list = [...new Set(phones.filter(Boolean).map((p) => String(p).trim()))];
  if (!list.length) return new Map();
  const rows = await NoidaClient.find({ phone: { $in: list } }).lean();
  return new Map(rows.map((c) => [c.phone, c.code]));
}
