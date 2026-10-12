import { isPhotoId, type OutboxEntry, type PhotoMeta } from "../data/schema";
import type { EntryState } from "./engine";
import { isSyncedCollection } from "./mapping";

// What the parent is told about backup (Phase 2B-2 M4). Pure. "All backed up" only when every record has been
// confirmed by the server and every photo those records show has been verified there; anything pending, held,
// failed or waiting for a photo means it is not, whatever else is true.

export type SyncPhase = "off" | "idle" | "syncing" | "offline" | "error";

export type SyncStatus = {
  phase: SyncPhase;
  lastSyncedAt: string | null;
  // Local changes not yet confirmed by the server (including ones waiting for another record first).
  pending: number;
  // Not sent: ownership not established (demo or unknown origin; the first-login migration decides).
  held: number;
  // Not sent: the server refused them; retried every round.
  failed: number;
  // Photos shown by records here that the server hasn't verified yet (uploading, or retried after a problem).
  photosWaiting: number;
  // Of those, the ones whose last transfer failed (retried every round; the local copy is always kept).
  photosFailed: number;
  // Records whose own data is backed up but which show at least one such photo.
  recordsWaitingForPhotos: number;
  allBackedUp: boolean;
};

type Live = { id: string; deletedAt?: string | null; photo?: string; photos?: string[] };

export function computeStatus(input: {
  phase: SyncPhase;
  lastSyncedAt: string | null;
  outbox: OutboxEntry[];
  notSent: Record<string, { state: EntryState }>;
  // Photo id → why its last upload or download failed (lib/sync/photos.ts).
  photosFailed?: Record<string, string>;
  children: Live[];
  entries: Live[];
  photo: (id: string) => PhotoMeta | undefined;
}): SyncStatus {
  let pending = 0, held = 0, failed = 0;
  for (const e of input.outbox) {
    if (e.collection !== "versions" && !isSyncedCollection(e.collection)) continue; // local-only
    const state = input.notSent[e.key]?.state;
    if (state === "held") held++;
    else if (state === "failed") failed++;
    else pending++;
  }
  const waitingPhotos = new Set<string>();
  let recordsWaitingForPhotos = 0;
  const live = [...input.children.map(c => [c.photo]), ...input.entries.map(e => e.photos ?? [])];
  [...input.children, ...input.entries].forEach((r, i) => {
    if (r.deletedAt) return;
    const missing = (live[i] as (string | undefined)[]).filter((ref): ref is string => isPhotoId(ref) && !input.photo(ref)?.verifiedAt);
    missing.forEach(id => waitingPhotos.add(id));
    if (missing.length) recordsWaitingForPhotos++;
  });
  const allBackedUp = input.phase === "idle" && input.lastSyncedAt !== null && pending + held + failed === 0 && waitingPhotos.size === 0;
  const photosFailed = [...waitingPhotos].filter(id => input.photosFailed?.[id]).length;
  return { phase: input.phase, lastSyncedAt: input.lastSyncedAt, pending, held, failed, photosWaiting: waitingPhotos.size, photosFailed, recordsWaitingForPhotos, allBackedUp };
}
