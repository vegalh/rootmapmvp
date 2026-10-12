import type { SyncMeta } from "../../types";
import { outboxKey, type OutboxCollection, type OutboxEntry } from "./schema";

// Pure helpers that turn "the list as the screen now wants it" into per-record changes ready for sync.

type Rec = SyncMeta & { id: string };

// Stored order: by position, then id, so every device lists records the same way.
export const byPosition = (a: Rec, b: Rec) => (a.position ?? 0) - (b.position ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Positions for `next`, keeping each existing record's position and slotting new ones between their neighbours,
// so prepending or appending one record never rewrites the others.
function positions(prevLive: Map<string, Rec>, next: Rec[]): number[] {
  const out: (number | undefined)[] = next.map(r => prevLive.get(r.id)?.position);
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== undefined) continue;
    const lo = i > 0 ? out[i - 1] : undefined;
    let hi: number | undefined;
    for (let j = i + 1; j < out.length && hi === undefined; j++) hi = out[j];
    out[i] = lo === undefined ? (hi === undefined ? 0 : hi - 1) : hi === undefined || hi <= lo ? lo + 1 : (lo + hi) / 2;
  }
  return out as number[];
}

// Records that must be written so the visible collection becomes `next`:
// - new or changed records are stamped (createdAt kept or set, updatedAt = now, deletedAt cleared);
// - records missing from `next` are soft-deleted (deletedAt = now) instead of disappearing, so a future sync
//   can tell other devices about the deletion;
// - unchanged records are not written at all.
export function diffCollection<T extends Rec>(prevAll: T[], next: T[], now: string, originFor: (r: T) => NonNullable<SyncMeta["origin"]>): T[] {
  const byId = new Map(prevAll.map(r => [r.id, r]));
  const live = new Map(prevAll.filter(r => !r.deletedAt).map(r => [r.id, r] as [string, Rec]));
  const pos = positions(live, next);
  const changed: T[] = [];
  const nextIds = new Set<string>();
  next.forEach((r, i) => {
    nextIds.add(r.id);
    const prev = byId.get(r.id);
    const isLive = live.has(r.id);
    if (isLive && r === prev && r.position === pos[i]) return;
    const candidate = { ...r, position: pos[i] };
    if (isLive && JSON.stringify(candidate) === JSON.stringify(prev)) return;
    changed.push({
      ...candidate,
      // null means "created before timestamps existed" and must stay null; only brand-new records get `now`.
      createdAt: r.createdAt !== undefined ? r.createdAt : prev ? (prev.createdAt ?? null) : now,
      updatedAt: now,
      deletedAt: r.deletedAt ?? null,
      origin: prev?.origin ?? r.origin ?? originFor(r),
    });
  });
  for (const prev of prevAll) {
    if (!prev.deletedAt && !nextIds.has(prev.id)) changed.push({ ...prev, deletedAt: now, updatedAt: now });
  }
  return changed;
}

// `all` with `changed` applied (by id), in stored order.
export function applyChanges<T extends Rec>(all: T[], changed: T[]): T[] {
  if (!changed.length) return all;
  const map = new Map(all.map(r => [r.id, r]));
  for (const r of changed) map.set(r.id, r);
  return [...map.values()].sort(byPosition);
}

// Outbox entries for records being written (account spaces). One entry per record: a record changed again before
// sync keeps its place in the queue (`queuedAt`) and gets the newest `op`, `seq` and `changedAt`; sync then uploads
// the record as it is at that moment.
export function outboxEntries(collection: OutboxCollection, records: { id: string; deletedAt?: string | null }[], current: Map<string, OutboxEntry>, ctx: { now: string; deviceId: string; nextSeq: () => number }): OutboxEntry[] {
  return records.map(r => {
    const key = outboxKey(collection, r.id);
    return { key, collection, id: r.id, op: r.deletedAt ? "delete" : "put", seq: ctx.nextSeq(), queuedAt: current.get(key)?.queuedAt ?? ctx.now, changedAt: ctx.now, deviceId: ctx.deviceId };
  });
}
