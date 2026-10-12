import { getCloudClient } from "../cloud/client";
import { cloudConfig } from "../cloud/config";
import {
  activeSpace, allPhotoMetas, commitSync, getCollection, hasPhotoBytes, pendingOutbox, photoBytes, photoChecksum, photoMeta, refreshFromDisk, storePhotoBytes, subscribe,
  syncMeta, syncRecordFor, syncRecordValue,
} from "../data/store";
import { SyncOffline, syncRound, type RoundResult, type SyncLocal } from "./engine";
import { syncPhotos, type LocalPhoto, type PhotoLocal } from "./photos";
import type { SyncedCollection } from "./mapping";
import { computeStatus, type SyncPhase, type SyncStatus } from "./status";

// When sync runs, for the signed-in account's own space (Phase 2B-2 M4): at start, a moment after each local
// change, when the device comes back online or the app comes back to the screen, and every 30 seconds while it
// is open. One round at a time across this account's tabs (Web Locks). After a failure it waits longer each time
// (up to 5 minutes); coming back online retries at once.

const local: SyncLocal = {
  outbox: pendingOutbox,
  syncRecord: syncRecordFor,
  record: (collection: SyncedCollection, id: string) => syncRecordValue(collection, id),
  photoChecksum,
  meta: syncMeta,
  commit: batch => commitSync(batch),
  refresh: refreshFromDisk,
};

const photoLocal: PhotoLocal = {
  photos: () => allPhotoMetas() as LocalPhoto[],
  hasBytes: hasPhotoBytes,
  bytes: photoBytes,
  storeBytes: storePhotoBytes,
  syncRecord: syncRecordFor,
  commit: batch => commitSync(batch),
};

let phase: SyncPhase = "off";
let lastSyncedAt: string | null = null;
let notSent: RoundResult["notSent"] = {};
let photosFailed: Record<string, string> = {};
let status: SyncStatus = makeStatus();
const listeners = new Set<() => void>();

function makeStatus(): SyncStatus {
  return computeStatus({ phase, lastSyncedAt, outbox: pendingOutbox(), notSent, photosFailed, children: getCollection("children"), entries: getCollection("entries"), photo: photoMeta });
}
function update() {
  const next = makeStatus();
  if (JSON.stringify(next) === JSON.stringify(status)) return;
  status = next;
  for (const l of [...listeners]) l();
}
export const syncStatus = () => status;
export function subscribeSync(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const DEBOUNCE_MS = 1500;
const INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;

// Starts syncing; returns the function that stops it. Only for the open account space of `userId`.
export function startSync({ userId, familyId }: { userId: string; familyId: string }): () => void {
  const space = activeSpace();
  if (space.kind !== "account" || space.userId !== userId) return () => {};
  let stopped = false;
  let running = false;
  let again = false;
  let timer: number | undefined;
  let failures = 0;
  let seenOutbox = outboxSignature();

  const schedule = (ms: number) => {
    if (stopped) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), ms);
  };

  async function round() {
    const client = await getCloudClient();
    if (!client) return;
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    const go = async () => {
      phase = "syncing"; update();
      const result = await syncRound(client, local, { familyId, userId });
      notSent = result.notSent;
      // Then the files of photos whose details are on the server (and downloads of others' photos).
      if (cloudConfig.enabled) {
        const photos = await syncPhotos(client, photoLocal, { familyId, url: cloudConfig.supabaseUrl, key: cloudConfig.publishableKey });
        photosFailed = photos.failed;
      }
      lastSyncedAt = new Date().toISOString();
      phase = "idle";
    };
    if (locks) {
      await locks.request(`rootmap-sync:${userId}`, { ifAvailable: true }, async lock => {
        if (lock) await go();
        // Another tab is syncing this account right now; this tab reloads what it wrote on the next round.
      });
    } else {
      await go();
    }
  }

  async function run() {
    if (stopped) return;
    if (running) { again = true; return; }
    running = true;
    try {
      await round();
      failures = 0;
      schedule(INTERVAL_MS);
    } catch (e) {
      failures++;
      phase = e instanceof SyncOffline || (typeof navigator !== "undefined" && navigator.onLine === false) ? "offline" : "error";
      if (phase === "error") console.warn("RootMap sync:", e);
      schedule(Math.min(MAX_BACKOFF_MS, 5000 * 2 ** (failures - 1)));
    } finally {
      running = false;
      // What the round itself removed from the outbox isn't a new change.
      if (!again) seenOutbox = outboxSignature();
      update();
      if (again && !stopped) { again = false; schedule(0); }
    }
  }

  // Local changes: sync shortly after (several quick edits make one round).
  const unsubscribe = subscribe(() => {
    update();
    const sig = outboxSignature();
    if (sig !== seenOutbox) { seenOutbox = sig; if (!running) schedule(DEBOUNCE_MS); else again = true; }
  });
  const online = () => { failures = 0; schedule(0); };
  const visible = () => { if (document.visibilityState === "visible") schedule(0); };
  window.addEventListener("online", online);
  document.addEventListener("visibilitychange", visible);
  schedule(0);

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("online", online);
    document.removeEventListener("visibilitychange", visible);
    phase = "off";
    update();
  };
}

const outboxSignature = () => pendingOutbox().map(e => `${e.key}@${e.seq}`).join("|");

export { allPhotoMetas };
