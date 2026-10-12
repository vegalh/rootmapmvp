import { sessionValid } from "../cloud/auth";
import { getCloudClient } from "../cloud/client";
import { signOutHere } from "../cloud/session";
import { cloudConfig } from "../cloud/config";
import { initialChildren } from "../../data/children";
import { initialObservations, initialRecords } from "../../data/progress";
import { readGuestSnapshot } from "../data/guestPlan";
import {
  DEFAULT_SAVED, activeSpace, allPhotoMetas, commitSync, getCollection, guestImportState, guestPhotoBytes, hasPhotoBytes, importGuestCopy, pendingOutbox, photoBytes,
  photoChecksum, photoMeta, refreshFromDisk, saveGuestImportState, storePhotoBytes, subscribe, syncMeta, syncRecordFor, syncRecordValue,
} from "../data/store";
import {
  acceptGuestImport, advanceGuestImport, dismissGuestImport, importProgress, prepareGuestImport, type AcceptResult, type GuestImportLocal, type ImportAnswers,
  type ImportContext, type ImportProgress, type Prepared,
} from "./guestImport";
import { SyncOffline, sha256Hex, syncRound, type RoundResult, type SyncLocal } from "./engine";
import { resetPhotoRetries, syncPhotos, type LocalPhoto, type PhotoLocal } from "./photos";
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

// Bringing the guest data into the account (guestImport.ts), on this device's stores.
const importLocal: GuestImportLocal = {
  guest: readGuestSnapshot,
  guestPhotoBytes,
  records: collection => getCollection(collection) as unknown as Record<string, unknown>[],
  photos: allPhotoMetas,
  state: guestImportState,
  saveState: saveGuestImportState,
  copy: importGuestCopy,
  syncRecord: syncRecordFor,
  outbox: pendingOutbox,
  deviceId: () => syncMeta().deviceId,
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

// Set while sync runs: starts a round now (the Account page's "Try again").
let runNow: (() => void) | null = null;
// The account sync runs for.
let syncAccount: { userId: string; familyId: string } | null = null;

// ---- Earlier memories (guest data) → this account. Screens call these; see guestImport.ts. ----

// SHA-256 of the bundled demo pictures, so a demo child still showing one isn't taken for the parent's own.
let demoPhotoSha: Promise<string[]> | null = null;
const bundledPhotoSha = () => (demoPhotoSha ??= Promise.all(initialChildren.map(async c => {
  try { return await sha256Hex(await (await fetch(c.photo)).arrayBuffer()); } catch { return ""; }
})).then(list => list.filter(Boolean)));
async function importContext(): Promise<ImportContext | null> {
  const account = syncAccount;
  if (!account) return null;
  return { ...account, demo: initialChildren, seed: { records: initialRecords, observations: initialObservations, saved: DEFAULT_SAVED, photoSha: await bundledPhotoSha() } };
}

// What could be brought in. null: not signed in here, or nothing on this device. Throws SyncOffline when offline.
export async function prepareImport(): Promise<Prepared | null> {
  const ctx = await importContext();
  const client = await getCloudClient();
  if (!ctx || !client) return null;
  return prepareGuestImport(client, importLocal, ctx);
}
export async function acceptImport(answers: ImportAnswers, prepared?: Prepared): Promise<AcceptResult | null> {
  const ctx = await importContext();
  const client = await getCloudClient();
  if (!ctx || !client) return null;
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const go = () => acceptGuestImport(client, importLocal, ctx, answers, prepared);
  const result = locks ? ((await locks.request(`rootmap-guest-import:${ctx.userId}`, go)) as AcceptResult) : await go();
  runNow?.();
  return result;
}
export const dismissImport = () => dismissGuestImport(importLocal);
export const guestImportProgress = (): ImportProgress => importProgress(importLocal);

// "Try again" for photos that failed: photos given up on after repeated rejected uploads are tried again, and a
// round starts at once (without waiting for the back-off). False when sync isn't running.
export async function retryPhotos(): Promise<boolean> {
  if (!runNow) return false;
  await resetPhotoRetries(photoLocal, Object.keys(photosFailed));
  runNow?.();
  return true;
}

const DEBOUNCE_MS = 1500;
const INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;
// How often sync asks Auth whether the session is still valid (also before the first round).
const SESSION_CHECK_MS = 5 * 60_000;

// Starts syncing; returns the function that stops it. Only for the open account space of `userId`.
export function startSync({ userId, familyId }: { userId: string; familyId: string }): () => void {
  const space = activeSpace();
  if (space.kind !== "account" || space.userId !== userId) return () => {};
  let stopped = false;
  let running = false;
  let again = false;
  let timer: number | undefined;
  let failures = 0;
  let sessionCheckedAt = 0;
  let seenOutbox = outboxSignature();

  const schedule = (ms: number) => {
    if (stopped) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), ms);
  };

  async function round() {
    const client = await getCloudClient();
    if (!client) return;
    // A session the server no longer accepts uploads nothing more: sign out here, and the app reopens the guest
    // space (App.tsx). Everything stays on this device for when the parent signs in again.
    if (Date.now() - sessionCheckedAt >= SESSION_CHECK_MS) {
      const valid = await sessionValid(client);
      if (valid === false) { stopped = true; await signOutHere(); return; }
      if (valid === true) sessionCheckedAt = Date.now();
    }
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    const go = async () => {
      phase = "syncing"; update();
      const result = await syncRound(client, local, { familyId, userId });
      notSent = result.notSent;
      // Then the files of photos whose details are on the server (and downloads of others' photos).
      if (cloudConfig.enabled) {
        const photos = await syncPhotos(client, photoLocal, { familyId, url: cloudConfig.supabaseUrl, key: cloudConfig.publishableKey });
        photosFailed = photos.failed;
        // Then, if earlier memories are being brought in, whether the server now has all of them.
        await advanceGuestImport(client, importLocal, { familyId, userId });
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
  const now = () => { failures = 0; if (running) again = true; else schedule(0); };
  runNow = now;
  const account = { userId, familyId };
  setRunning(account);
  schedule(0);

  return () => {
    stopped = true;
    if (runNow === now) runNow = null;
    if (isRunning(account)) setRunning(null);
    window.clearTimeout(timer);
    unsubscribe();
    window.removeEventListener("online", online);
    document.removeEventListener("visibilitychange", visible);
    phase = "off";
    update();
  };
}

function setRunning(next: { userId: string; familyId: string } | null) { syncAccount = next; }
const isRunning = (a: { userId: string; familyId: string }) => syncAccount === a;

const outboxSignature = () => pendingOutbox().map(e => `${e.key}@${e.seq}`).join("|");

export { allPhotoMetas };
