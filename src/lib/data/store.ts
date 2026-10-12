import type { EntryDraft } from "../../types";
import { initialChildren } from "../../data/children";
import { initialObservations, initialRecords } from "../../data/progress";
import { BACKUP_KEYS } from "../backup";
import { backupCorrupt, isQuotaError, writeRaw, type StorageFailure } from "../storage";
import { deviceId } from "./device";
import { done, getAll, openDatabase, openExisting, request } from "./idb";
import { buildFromLegacy, readLegacyStorage, type Built, type Defaults } from "./legacy";
import { isMigrated, migrateFromLocalStorage } from "./migrate";
import { applyChanges, byPosition, outboxEntries } from "./records";
import {
  COLLECTIONS, DB_NAME, GUEST, LEGACY_DELETED_CHILDREN_KEY, LEGACY_DRAFTS_KEY, LEGACY_KEYS, STORE_NAMES, isPhotoId, newPhotoId, settingShape,
  type CollectionName, type Collections, type OutboxCollection, type OutboxEntry, type PhotoBlob, type PhotoMeta, type Space, type SpaceMeta,
  type StoreName, type StoredDraft, type StoredSetting, type SyncRecord,
} from "./schema";

// The single place RootMap data is read from and written to. Screens never touch a storage API directly.
//
// On start (initData) everything is loaded into memory once, so screens read synchronously exactly as before;
// every change is then written through `write`, which reports whether it really reached storage.
//
// Backends:
// - "indexeddb": the normal case once the one-time migration from localStorage has completed and verified.
// - "localStorage": the original storage, used only while IndexedDB is unavailable or the migration has not
//   yet succeeded on this device; it keeps the original key layout, so the migration can still run later.
//
// Spaces (Phase 2B-2 M3, see schema.ts): the store serves exactly one space per page load, the guest space or one
// signed-in account's. Switching space reloads the page, so nothing of one space is ever held in memory with
// another's. Account spaces are IndexedDB only (the localStorage keys belong to the guest space) and keep an outbox,
// written in the same transaction as every record change.

export type DataMode = "indexeddb" | "localStorage";
export type DataStatus = { mode: DataMode } | { mode: "unavailable"; error: string };

export const DEFAULT_SAVED = ["water-pouring", "dotting"];
export const defaults: Defaults = { children: initialChildren, records: initialRecords, observations: initialObservations, saved: DEFAULT_SAVED };

// Set once the migration has completed. If IndexedDB later fails to open, the app must not quietly fall back to
// the older localStorage copy (it would look like recent memories were lost), so it asks to reopen instead.
const STORE_HINT_KEY = "rootmap-data-store";
// Last-moment copy of drafts written synchronously when the page is being hidden or closed, in case the
// IndexedDB write that was started at the same moment is cut short. Applied on the next start.
const RESCUE_KEY = "rootmap-draft-rescue";

let mode: DataMode = "localStorage";
let db: IDBDatabase | null = null;
let space: Space = GUEST;
let spaceMeta: SpaceMeta | null = null;
// Account spaces: the stored outbox (see OutboxEntry), kept in memory like everything else.
const outbox = new Map<string, OutboxEntry>();
let outboxSeq = 0;
// Account spaces: per-record sync state, and photo metadata (light; the bytes stay in IndexedDB).
const syncRecords = new Map<string, SyncRecord>();
const photoMetas = new Map<string, PhotoMeta>();

const cache = {
  collections: Object.fromEntries(COLLECTIONS.map(n => [n, []])) as unknown as { [K in CollectionName]: Collections[K][] },
  settings: new Map<string, unknown>(),
  drafts: new Map<string, EntryDraft>(),
};
const photoUrls = new Map<string, string>();

// What screens show. `cache` is the working copy every write updates at once; `published` is the state screens
// render, and listeners are told whenever it changes. An ordinary write is published immediately; a write with
// `rollback` (a save that shows a confirmation) is published only once it is stored, so a failed save never
// appears on screen. Any write is published this way, whoever makes it (a screen, a restore, a future sync).
type Published = { collections: { [K in CollectionName]: Collections[K][] }; settings: Map<string, unknown> };
let published: Published = { collections: { ...cache.collections }, settings: new Map() };
const listeners = new Set<() => void>();
// localStorage mode only: items that could not become records (see legacy.ts), written back unchanged with
// their key so the fallback backend never drops anything it could not understand.
let legacyExtras = new Map<string, unknown[]>();

const nowIso = () => new Date().toISOString();
const failureOf = (e: unknown): StorageFailure => (isQuotaError(e) ? "full" : "failed");

// ---------------------------------------------------------------------------------------------------------
// Start-up

export async function initData(target: Space = GUEST): Promise<DataStatus> {
  if (target.kind === "account") return initAccount(target);
  const migratedBefore = readHint() === "indexeddb";
  let opened: IDBDatabase;
  try {
    opened = await openDatabase();
  } catch (e) {
    if (!migratedBefore) return startLegacy(`IndexedDB unavailable: ${String(e)}`);
    try {
      await new Promise(r => setTimeout(r, 400));
      opened = await openDatabase();
    } catch (e2) {
      return { mode: "unavailable", error: String(e2) };
    }
  }
  let migrated = false;
  try {
    // One tab at a time: a second tab opened during the first start waits, then finds the migration done.
    const error = await withMigrationLock(async () => {
      migrated = await isMigrated(opened);
      if (migrated) return null;
      const result = await migrateFromLocalStorage(opened, localStorage, defaults);
      if (!result.ok) return result.error;
      migrated = true;
      if (result.report.warnings.length) console.info("RootMap data migration notes:", result.report.warnings);
      try { localStorage.setItem(STORE_HINT_KEY, "indexeddb"); } catch { /* hint only */ }
      return null;
    });
    if (error) {
      opened.close();
      return startLegacy(`migration not completed (${error}); will retry on next start`);
    }
    await hydrate(opened);
    db = opened;
    mode = "indexeddb";
  } catch (e) {
    opened.close();
    if (migrated || migratedBefore) return { mode: "unavailable", error: String(e) };
    return startLegacy(`IndexedDB read failed: ${String(e)}`);
  }
  await applyDraftRescue();
  requestPersistence();
  return { mode };
}

// An account's space: its own database, created empty the first time this account signs in on this device. Nothing
// is copied from the guest space except the language and appearance chosen on this device; the guest database is
// only read, never written.
async function initAccount(target: Extract<Space, { kind: "account" }>): Promise<DataStatus> {
  let opened: IDBDatabase;
  try {
    opened = await openDatabase(target);
  } catch (e) {
    // Never fall back to localStorage: those keys belong to the guest space.
    return { mode: "unavailable", error: String(e) };
  }
  try {
    space = target;
    spaceMeta = await ensureSpaceMeta(opened, target.userId);
    await hydrate(opened);
    db = opened;
    mode = "indexeddb";
  } catch (e) {
    opened.close();
    return { mode: "unavailable", error: String(e) };
  }
  await applyDraftRescue();
  requestPersistence();
  return { mode };
}

const DEVICE_PREFERENCES = ["rootmap-language", "rootmap-appearance"];

async function ensureSpaceMeta(target: IDBDatabase, userId: string): Promise<SpaceMeta> {
  const existing = await request<SpaceMeta | undefined>(target.transaction("meta").objectStore("meta").get("space"));
  if (existing) {
    if (existing.userId !== userId) throw new Error("account space belongs to another account");
    return existing;
  }
  const now = nowIso();
  const meta: SpaceMeta = { key: "space", userId, deviceId: deviceId(), createdAt: now, familyId: null, cursor: 0 };
  const preferences = await guestPreferences();
  const tx = target.transaction(["meta", "settings"], "readwrite");
  // A second tab creating the space at the same moment writes the same values.
  tx.objectStore("meta").put(meta);
  for (const s of preferences) tx.objectStore("settings").put({ ...s, updatedAt: now } satisfies StoredSetting);
  await done(tx);
  return meta;
}

// Language and appearance as chosen in the guest space, read without changing it.
async function guestPreferences(): Promise<StoredSetting[]> {
  try {
    const guest = await openExisting(DB_NAME);
    if (!guest) return [];
    try {
      if (!guest.objectStoreNames.contains("settings")) return [];
      const all = await getAll<StoredSetting>(guest, "settings");
      return all.filter(s => DEVICE_PREFERENCES.includes(s.key));
    } finally {
      guest.close();
    }
  } catch {
    return [];
  }
}

export const activeSpace = () => space;
// The account space's description (null in the guest space).
export const activeSpaceMeta = () => spaceMeta;
// Local changes waiting for sync, oldest first (always empty in the guest space).
export const pendingOutbox = () => [...outbox.values()].sort((a, b) => a.seq - b.seq);

function withMigrationLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? (locks.request("rootmap-migration", fn) as Promise<T>) : fn();
}

function readHint() {
  try { return localStorage.getItem(STORE_HINT_KEY); } catch { return null; }
}

async function hydrate(source: IDBDatabase) {
  for (const name of COLLECTIONS) (cache.collections as Record<string, unknown[]>)[name] = (await getAll<Collections[typeof name]>(source, name)).sort(byPosition);
  cache.settings = new Map((await getAll<StoredSetting>(source, "settings")).map(s => [s.key, s.value]));
  cache.drafts = new Map((await getAll<StoredDraft>(source, "drafts")).map(({ key, ...draft }) => [key, draft]));
  outbox.clear();
  syncRecords.clear();
  photoMetas.clear();
  if (source.objectStoreNames.contains("outbox")) {
    for (const entry of await getAll<OutboxEntry>(source, "outbox")) outbox.set(entry.key, entry);
    outboxSeq = Math.max(outboxSeq, 0, ...[...outbox.values()].map(e => e.seq));
    for (const r of await getAll<SyncRecord>(source, "syncRecords")) syncRecords.set(r.key, r);
    for (const p of await getAll<PhotoMeta>(source, "photos")) photoMetas.set(p.id, p);
  }
  for (const url of photoUrls.values()) URL.revokeObjectURL(url);
  photoUrls.clear();
  for (const p of await getAll<PhotoBlob>(source, "photoBlobs")) photoUrls.set(p.id, URL.createObjectURL(p.blob));
  publish();
}

// Runs on the original localStorage data, interpreted exactly as before (same defaults for missing values).
function startLegacy(reason: string): DataStatus {
  console.warn(`RootMap is using localStorage for now: ${reason}`);
  mode = "localStorage";
  // If another tab completes the migration meanwhile, this tab must not keep writing to the older copy.
  window.addEventListener("storage", e => { if (e.key === STORE_HINT_KEY && e.newValue === "indexeddb") window.location.reload(); });
  let built: Built;
  try {
    const source = readLegacyStorage(localStorage);
    for (const u of source.unplaced) if (u.reason === "unreadable") backupCorrupt(u.key, u.raw);
    built = buildFromLegacy(source, { now: nowIso(), defaults, extractPhotos: false, newPhotoId, photoSource: "upload" });
  } catch {
    // localStorage itself is unreadable (e.g. blocked): the app starts with its defaults, as it always did.
    built = buildFromLegacy({ values: {}, unplaced: [] }, { now: nowIso(), defaults, extractPhotos: false, newPhotoId, photoSource: "upload" });
  }
  cache.collections = built.collections;
  cache.settings = new Map(Object.entries(built.settings));
  cache.drafts = new Map(Object.entries(built.drafts));
  legacyExtras = new Map();
  for (const item of built.archive) {
    if (item.reason === "unreadable" || item.reason === "earlier-unreadable-copy" || item.reason === "unrecognized-key") continue;
    legacyExtras.set(item.source, [...(legacyExtras.get(item.source) || []), item.value]);
  }
  publish();
  return { mode };
}

// Asks the browser not to evict RootMap's data under storage pressure. Silent in Chrome, Edge and Safari;
// skipped in Firefox, where it would show a permission prompt.
function requestPersistence() {
  try {
    if (/firefox/i.test(navigator.userAgent)) return;
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    // not supported
  }
}

export const dataMode = () => mode;

// ---------------------------------------------------------------------------------------------------------
// Reads (synchronous, from memory)

export const getCollection = <K extends CollectionName>(name: K): Collections[K][] => cache.collections[name];

// Visible (not deleted) records of one child, for collections that belong to a child.
export const listByChild = <K extends "records" | "observations" | "entries">(name: K, childId: string) =>
  getCollection(name).filter(r => r.childId === childId && !r.deletedAt);

// The stored value, or `fallback` when absent or of another shape (array vs. object vs. primitive).
export const readSetting = <T>(key: string, fallback: T): T => settingFrom(cache.settings, key, fallback);

function settingFrom<T>(settings: Map<string, unknown>, key: string, fallback: T): T {
  if (!settings.has(key)) return fallback;
  const value = settings.get(key);
  const sameShape = value !== null && Array.isArray(value) === Array.isArray(fallback) && typeof value === typeof fallback;
  return sameShape ? (value as T) : fallback;
}

// The published state (see `published`), for React's useSyncExternalStore. Each value keeps its identity until
// it changes, so a screen re-renders only when its own data did.
export const publishedCollection = <K extends CollectionName>(name: K): Collections[K][] => published.collections[name];
export const publishedSetting = <T>(key: string, fallback: T): T => settingFrom(published.settings, key, fallback);

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish() {
  published = { collections: { ...cache.collections }, settings: new Map(cache.settings) };
  for (const listener of [...listeners]) listener();
}

export const readDraftValue = (key: string) => cache.drafts.get(key);
export const allDrafts = () => [...cache.drafts.entries()];

// ---------------------------------------------------------------------------------------------------------
// Writes

export type Change = {
  collections?: { [K in CollectionName]?: Collections[K][] };
  // `undefined` removes the setting.
  settings?: [string, unknown][];
  // `null` removes the draft.
  drafts?: [string, EntryDraft | null][];
};

// Applies a change to memory and returns how to take it back.
function applyToCache(change: Change) {
  const undo: (() => void)[] = [];
  for (const [name, recs] of Object.entries(change.collections || {}) as [CollectionName, { id: string }[]][]) {
    const before = cache.collections[name];
    const after = applyChanges(before as { id: string }[], recs);
    (cache.collections as Record<string, unknown[]>)[name] = after;
    undo.push(() => { if (cache.collections[name] === after) (cache.collections as Record<string, unknown[]>)[name] = before; });
  }
  for (const [key, value] of change.settings || []) {
    const had = cache.settings.has(key);
    const before = cache.settings.get(key);
    if (value === undefined) cache.settings.delete(key);
    else cache.settings.set(key, value);
    undo.push(() => { if (cache.settings.get(key) === value) { if (had) cache.settings.set(key, before); else cache.settings.delete(key); } });
  }
  for (const [key, draft] of change.drafts || []) {
    const before = cache.drafts.get(key);
    if (draft) cache.drafts.set(key, draft);
    else cache.drafts.delete(key);
    undo.push(() => { if (cache.drafts.get(key) === (draft || undefined)) { if (before) cache.drafts.set(key, before); else cache.drafts.delete(key); } });
  }
  return () => undo.forEach(u => u());
}

// Persists a change. Resolves to null only once the data is stored; otherwise to the reason it was not.
// Memory is updated immediately. Without `rollback` the change is also shown at once, and stays shown if saving
// fails (the failure is reported instead). With `rollback` it is shown only once stored, and a failed change is
// taken back out. The IndexedDB transaction is started synchronously, before this function first yields, so a
// write begun while the page is closing is already queued.
export function write(change: Change, { rollback = false } = {}): Promise<StorageFailure | null> {
  const queued = queueOutbox(Object.entries(change.collections || {}) as [CollectionName, { id: string; deletedAt?: string | null }[]][]);
  const undoCache = applyToCache(change);
  const undo = () => { undoCache(); queued.undo(); };
  if (!rollback) publish();
  const settle = (failure: StorageFailure | null) => {
    if (rollback) {
      if (failure) undo();
      publish();
    }
    return failure;
  };
  if (mode === "localStorage") return Promise.resolve(settle(writeLegacy(change)));
  if (!Object.keys(change.collections || {}).length && !change.settings?.length && !change.drafts?.length) return Promise.resolve(settle(null));
  let tx: IDBTransaction;
  try {
    tx = transactionFor(change, queued.entries);
  } catch (e) {
    queued.undo();
    return Promise.resolve(settle(failureOf(e)));
  }
  return done(tx).then(
    () => {
      if (change.drafts) clearRescue(change.drafts.map(([key]) => key));
      return settle(null);
    },
    e => {
      // Nothing of this change was stored, so its outbox entries weren't either.
      queued.undo();
      return settle(failureOf(e));
    },
  );
}

// Account spaces: the outbox entries for a change's records, already applied to memory (with a way back if the
// transaction fails). Nothing in the guest space.
function queueOutbox(changes: [OutboxCollection, { id: string; deletedAt?: string | null }[]][]) {
  if (space.kind !== "account" || !spaceMeta) return { entries: [] as OutboxEntry[], undo: () => {} };
  const ctx = { now: nowIso(), deviceId: spaceMeta.deviceId, nextSeq: () => ++outboxSeq };
  const entries = changes.flatMap(([name, recs]) => outboxEntries(name, recs, outbox, ctx));
  const before = entries.map(e => [e.key, outbox.get(e.key)] as const);
  for (const e of entries) outbox.set(e.key, e);
  return {
    entries,
    undo: () => { for (const [key, prev] of before) if (prev) outbox.set(key, prev); else outbox.delete(key); },
  };
}

// Starts the transaction for a change. Every part is queued before this returns; if any part can't be (for
// example a value IndexedDB can't store), the whole transaction is aborted, so a change is stored completely or
// not at all.
function transactionFor(change: Change, queued: OutboxEntry[]) {
  if (!db) throw new Error("database closed");
  const stores = new Set<StoreName>(Object.keys(change.collections || {}) as CollectionName[]);
  if (change.settings?.length) stores.add("settings");
  if (change.drafts?.length) stores.add("drafts");
  if (queued.length) stores.add("outbox");
  const tx = db.transaction([...stores], "readwrite");
  try {
    fillTransaction(tx, change, queued);
  } catch (e) {
    try { tx.abort(); } catch { /* already finished */ }
    throw e;
  }
  return tx;
}

function fillTransaction(tx: IDBTransaction, change: Change, queued: OutboxEntry[]) {
  for (const entry of queued) tx.objectStore("outbox").put(entry);
  for (const [name, recs] of Object.entries(change.collections || {})) {
    const store = tx.objectStore(name);
    for (const rec of recs as unknown[]) store.put(rec);
  }
  const now = nowIso();
  for (const [key, value] of change.settings || []) {
    if (value === undefined) tx.objectStore("settings").delete(key);
    else tx.objectStore("settings").put({ key, value, updatedAt: now } satisfies StoredSetting);
  }
  for (const [key, draft] of change.drafts || []) {
    if (draft) tx.objectStore("drafts").put({ ...draft, key } satisfies StoredDraft);
    else tx.objectStore("drafts").delete(key);
  }
}

// localStorage backend: rewrites each touched key in its original format (soft-deleted records, other than
// removed child profiles, are left out, as before).
function writeLegacy(change: Change): StorageFailure | null {
  const json = (key: string, value: unknown) => writeRaw(key, JSON.stringify(value));
  const withExtras = (key: string, list: unknown[]) => [...list, ...(legacyExtras.get(key) || [])];
  for (const name of Object.keys(change.collections || {}) as CollectionName[]) {
    const all = cache.collections[name] as { id: string; deletedAt?: string | null }[];
    const live = all.filter(r => !r.deletedAt);
    let failure: StorageFailure | null;
    if (name === "children") {
      failure = json(LEGACY_KEYS.children, withExtras(LEGACY_KEYS.children, live))
        || json(LEGACY_DELETED_CHILDREN_KEY, withExtras(LEGACY_DELETED_CHILDREN_KEY, all.filter(r => r.deletedAt)));
    } else if (name === "saved") {
      failure = json(LEGACY_KEYS.saved, live.map(r => r.id));
    } else {
      failure = json(LEGACY_KEYS[name], withExtras(LEGACY_KEYS[name], live));
    }
    if (failure) return failure;
  }
  for (const [key, value] of change.settings || []) {
    if (value === undefined) {
      try { localStorage.removeItem(key); } catch { return "failed"; }
      continue;
    }
    const failure = settingShape(key) === "text" ? writeRaw(key, value as string) : json(key, value);
    if (failure) return failure;
  }
  if (change.drafts?.length) {
    const unreadable = (legacyExtras.get(LEGACY_DRAFTS_KEY) || []) as { key: string; value: unknown }[];
    return json(LEGACY_DRAFTS_KEY, { ...Object.fromEntries(unreadable.map(x => [x.key, x.value])), ...Object.fromEntries(cache.drafts) });
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Draft rescue

type Rescue = Record<string, { draft: EntryDraft | null; at: string }>;

// Each space keeps its own rescue copy. Account keys use "rootmap." so the guest migration never reads them.
const rescueKey = () => (space.kind === "guest" ? RESCUE_KEY : `rootmap.draft-rescue:${space.userId}`);

function readRescue(): Rescue {
  try {
    const parsed = JSON.parse(localStorage.getItem(rescueKey()) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Synchronously keeps a copy of a draft write that may not finish because the page is going away.
export function rescueDraft(key: string, draft: EntryDraft | null) {
  if (mode !== "indexeddb") return; // the localStorage backend already writes synchronously
  try {
    localStorage.setItem(rescueKey(), JSON.stringify({ ...readRescue(), [key]: { draft, at: nowIso() } }));
  } catch {
    // Out of space: the IndexedDB write is still under way.
  }
}

function clearRescue(keys: string[]) {
  try {
    if (localStorage.getItem(rescueKey()) === null) return;
    const rescue = readRescue();
    for (const key of keys) delete rescue[key];
    if (Object.keys(rescue).length) localStorage.setItem(rescueKey(), JSON.stringify(rescue));
    else localStorage.removeItem(rescueKey());
  } catch {
    // stays until the next start, where it is only applied if newer than the stored draft
  }
}

async function applyDraftRescue() {
  const rescue = readRescue();
  const changes: [string, EntryDraft | null][] = [];
  for (const [key, { draft, at }] of Object.entries(rescue)) {
    const current = cache.drafts.get(key);
    if (draft === null) { if (current && current.savedAt <= at) changes.push([key, null]); }
    else if (!current || current.savedAt < draft.savedAt) changes.push([key, draft]);
  }
  if (!changes.length) { clearRescue(Object.keys(rescue)); return; }
  await write({ drafts: changes });
}

// ---------------------------------------------------------------------------------------------------------
// Photos

// URL to show for a photo reference: a stored photo id resolves to its local image; any other value (bundled
// asset, remote URL, a legacy inline image) is already a URL. Undefined for an id with no stored image.
export function photoUrl(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  return isPhotoId(ref) ? photoUrls.get(ref) : ref;
}

export const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

// Stores an image and returns the reference to keep in a record. In IndexedDB the bytes go to "photoBlobs"
// and the metadata to "photos" in one transaction; the localStorage fallback can only keep an inline image.
export async function savePhoto(blob: Blob, size?: { width: number; height: number }): Promise<{ ok: true; ref: string } | { ok: false; failure: StorageFailure }> {
  if (mode !== "indexeddb" || !db) {
    try { return { ok: true, ref: await blobToDataUrl(blob) }; } catch { return { ok: false, failure: "failed" }; }
  }
  const id = newPhotoId();
  const now = nowIso();
  // The fingerprint is taken when the photo is saved, so a later backup can prove the file is unchanged.
  let sha256: string | undefined;
  try { sha256 = await sha256Of(blob); } catch { /* computed later by sync */ }
  const meta: PhotoMeta = { id, mimeType: blob.type || "image/jpeg", byteSize: blob.size, width: size?.width ?? null, height: size?.height ?? null, createdAt: now, updatedAt: now, deletedAt: null, source: "upload", storagePath: null, uploadedAt: null, ...(sha256 ? { sha256 } : {}) };
  const queued = queueOutbox([["photos", [meta]]]);
  try {
    const tx = db.transaction(queued.entries.length ? ["photos", "photoBlobs", "outbox"] : ["photos", "photoBlobs"], "readwrite");
    tx.objectStore("photos").put(meta);
    tx.objectStore("photoBlobs").put({ id, blob } satisfies PhotoBlob);
    for (const entry of queued.entries) tx.objectStore("outbox").put(entry);
    await done(tx);
  } catch (e) {
    queued.undo();
    return { ok: false, failure: failureOf(e) };
  }
  photoUrls.set(id, URL.createObjectURL(blob));
  if (space.kind === "account") photoMetas.set(id, meta);
  publish();
  return { ok: true, ref: id };
}

// The image as a data URL (for backup files). Non-id references are returned unchanged.
export async function photoAsDataUrl(ref: string): Promise<string> {
  if (!isPhotoId(ref) || !db) return ref;
  const stored = await request<PhotoBlob | undefined>(db.transaction("photoBlobs").objectStore("photoBlobs").get(ref));
  if (!stored) throw new Error(`photo ${ref} missing`);
  return blobToDataUrl(stored.blob);
}

// ---------------------------------------------------------------------------------------------------------
// Backup file support (lib/backup.ts format, version 1: legacy keys, photos inline)

export async function backupData(): Promise<Record<string, unknown>> {
  const inline = (ref: unknown) => (typeof ref === "string" ? photoAsDataUrl(ref) : Promise.resolve(ref));
  const live = <K extends CollectionName>(name: K) => getCollection(name).filter(r => !r.deletedAt);
  const children = getCollection("children");
  const data: Record<string, unknown> = {
    [LEGACY_KEYS.children]: await Promise.all(children.filter(c => !c.deletedAt).map(async c => ({ ...c, photo: await inline(c.photo) }))),
    [LEGACY_DELETED_CHILDREN_KEY]: await Promise.all(children.filter(c => c.deletedAt).map(async c => ({ ...c, photo: await inline(c.photo) }))),
    [LEGACY_KEYS.records]: live("records"),
    [LEGACY_KEYS.observations]: live("observations"),
    [LEGACY_KEYS.entries]: await Promise.all(live("entries").map(async e => ({ ...e, photos: await Promise.all(e.photos.map(inline)) }))),
    [LEGACY_KEYS.plans]: live("plans"),
    [LEGACY_KEYS.goals]: live("goals"),
    [LEGACY_KEYS.saved]: live("saved").map(s => s.id),
    [LEGACY_DRAFTS_KEY]: Object.fromEntries(await Promise.all(allDrafts().map(async ([key, d]) => [key, { ...d, photos: await Promise.all(d.photos.map(inline)) }]))),
  };
  for (const key of Object.keys(BACKUP_KEYS)) {
    if (!settingShape(key) || !cache.settings.has(key)) continue;
    const value = cache.settings.get(key);
    data[key] = key === "rootmap-profile" ? { ...(value as object), photo: await inline((value as { photo?: string }).photo) } : value;
  }
  return data;
}

// Replaces this device's data with a validated backup, all or nothing (one transaction). Nothing is erased:
// records not in the backup are soft-deleted (removed profiles reappear under Recently Deleted), photos are kept.
export async function restoreData(data: Record<string, unknown>): Promise<boolean> {
  if (mode !== "indexeddb" || !db) return false;
  const now = nowIso();
  const built = buildFromLegacy({ values: data, unplaced: [] }, { now, defaults, extractPhotos: true, newPhotoId, photoSource: "restored" });
  // Every record the restore writes, by collection (for the outbox in an account space).
  const written: [OutboxCollection, { id: string; deletedAt?: string | null }[]][] = COLLECTIONS.map(name => {
    const incoming = new Set(built.collections[name].map(r => r.id));
    const removed = getCollection(name).filter(r => !r.deletedAt && !incoming.has(r.id)).map(r => ({ id: r.id, deletedAt: now }));
    return [name, [...built.collections[name], ...removed]];
  });
  written.push(["photos", built.photos.map(p => p.meta)]);
  const queued = queueOutbox(written);
  try {
    const tx = db.transaction([...STORE_NAMES.filter(s => s !== "meta"), ...(queued.entries.length ? ["outbox" as const] : [])], "readwrite");
    for (const entry of queued.entries) tx.objectStore("outbox").put(entry);
    for (const name of COLLECTIONS) {
      const store = tx.objectStore(name);
      const incoming = new Set(built.collections[name].map(r => r.id));
      for (const rec of built.collections[name]) store.put({ ...rec, updatedAt: now });
      for (const rec of getCollection(name)) if (!rec.deletedAt && !incoming.has(rec.id)) store.put({ ...rec, deletedAt: now, updatedAt: now });
    }
    for (const { meta, blob } of built.photos) {
      tx.objectStore("photos").put(meta);
      tx.objectStore("photoBlobs").put({ id: meta.id, blob } satisfies PhotoBlob);
    }
    for (const key of Object.keys(BACKUP_KEYS)) {
      if (!settingShape(key)) continue;
      if (key in built.settings) tx.objectStore("settings").put({ key, value: built.settings[key], updatedAt: now } satisfies StoredSetting);
      else tx.objectStore("settings").delete(key);
    }
    tx.objectStore("drafts").clear();
    for (const [key, draft] of Object.entries(built.drafts)) tx.objectStore("drafts").put({ ...draft, key } satisfies StoredDraft);
    for (const item of built.archive) tx.objectStore("archive").put(item);
    await done(tx);
    return true;
  } catch {
    queued.undo();
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Sync (account spaces only; lib/sync/engine.ts). Records written here are not queued for upload: they are what
// the server already holds.

export const syncRecordFor = (key: string) => syncRecords.get(key);
export const photoMeta = (id: string) => photoMetas.get(id);
export const allPhotoMetas = () => [...photoMetas.values()];

export async function syncRecordValue(collection: string, id: string): Promise<Record<string, unknown> | undefined> {
  if (collection === "photos") {
    const meta = photoMetas.get(id);
    return meta && { ...meta };
  }
  const rec = (cache.collections as Record<string, { id: string }[]>)[collection]?.find(r => r.id === id);
  return rec && { ...rec };
}

async function sha256Of(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

export async function photoChecksum(id: string): Promise<string | null> {
  const blob = await photoBytes(id);
  return blob ? sha256Of(blob) : null;
}

// Photo files (lib/sync/photos.ts). Whether this device holds a photo's bytes, and reading them.
export const hasPhotoBytes = (id: string) => photoUrls.has(id);
export async function photoBytes(id: string): Promise<Blob | null> {
  if (!db) return null;
  const stored = await request<PhotoBlob | undefined>(db.transaction("photoBlobs").objectStore("photoBlobs").get(id));
  return stored?.blob ?? null;
}

// Keeps a downloaded photo file (already checked against its SHA-256). Only adds bytes this device lacks; an
// existing local copy is never replaced.
export async function storePhotoBytes(id: string, blob: Blob): Promise<boolean> {
  if (space.kind !== "account" || !db || photoUrls.has(id)) return false;
  try {
    const tx = db.transaction("photoBlobs", "readwrite");
    const store = tx.objectStore("photoBlobs");
    const existing = store.get(id);
    existing.onsuccess = () => { if (!existing.result) store.put({ id, blob } satisfies PhotoBlob); };
    await done(tx);
  } catch {
    return false;
  }
  if (!photoUrls.has(id)) photoUrls.set(id, URL.createObjectURL(blob));
  // Screens re-render when their list changes: renew the lists that show photos, so the picture appears.
  cache.collections.children = [...cache.collections.children];
  cache.collections.entries = [...cache.collections.entries];
  publish();
  return true;
}

export const syncMeta = () => ({ familyId: spaceMeta?.familyId ?? null, cursors: spaceMeta?.cursors ?? {}, deviceId: spaceMeta?.deviceId ?? "" });

export type SyncCommit = {
  records?: { collection: string; record: Record<string, unknown> }[];
  syncRecords?: SyncRecord[];
  outboxRemove?: { key: string; seq: number }[];
  outboxAdd?: OutboxEntry[];
  expect?: { key: string; seq: number | null }[];
  meta?: { familyId?: string; cursors?: Record<string, number> };
};

// Applies a sync result in one transaction, only if every outbox expectation still holds on disk (the parent, or
// another tab, may have changed a record since sync looked at it). "stale": nothing was applied.
export function commitSync(batch: SyncCommit): Promise<"ok" | "stale"> {
  if (space.kind !== "account" || !db || !spaceMeta) return Promise.reject(new Error("sync needs an open account space"));
  const expectations = new Map<string, number | null>();
  for (const e of batch.expect ?? []) expectations.set(e.key, e.seq);
  for (const r of batch.outboxRemove ?? []) expectations.set(r.key, r.seq);
  // Quick check against memory first.
  for (const [key, seq] of expectations) if ((outbox.get(key)?.seq ?? null) !== seq) return Promise.resolve("stale");

  const collections = new Set((batch.records ?? []).map(r => r.collection));
  const stores = new Set<string>(["outbox", "syncRecords", "meta", ...collections]);
  const nextMeta: SpaceMeta = { ...spaceMeta, ...(batch.meta?.familyId ? { familyId: batch.meta.familyId } : {}), ...(batch.meta?.cursors ? { cursors: batch.meta.cursors } : {}) };
  const tx = db.transaction([...stores], "readwrite");
  const result = new Promise<"ok" | "stale">(resolveResult => {
    let stale = false;
    const keys = [...expectations.keys()];
    let left = keys.length;
    const apply = () => {
      try {
        for (const { collection, record } of batch.records ?? []) tx.objectStore(collection).put(record);
        for (const r of batch.syncRecords ?? []) tx.objectStore("syncRecords").put(r);
        for (const r of batch.outboxRemove ?? []) tx.objectStore("outbox").delete(r.key);
        for (const e of batch.outboxAdd ?? []) tx.objectStore("outbox").put(e);
        if (batch.meta) tx.objectStore("meta").put(nextMeta);
      } catch {
        try { tx.abort(); } catch { /* finished */ }
      }
    };
    if (!left) apply();
    for (const key of keys) {
      const req = tx.objectStore("outbox").get(key);
      req.onsuccess = () => {
        if (((req.result as OutboxEntry | undefined)?.seq ?? null) !== expectations.get(key)) stale = true;
        if (--left === 0) {
          if (stale) { try { tx.abort(); } catch { /* finished */ } }
          else apply();
        }
      };
    }
    done(tx).then(() => resolveResult("ok"), () => resolveResult("stale"));
  });
  return result.then(outcome => {
    if (outcome !== "ok") return outcome;
    // Stored: now memory and screens.
    const byCollection = new Map<string, { id: string }[]>();
    for (const { collection, record } of batch.records ?? []) {
      if (collection === "photos") photoMetas.set(String(record.id), record as unknown as PhotoMeta);
      else byCollection.set(collection, [...(byCollection.get(collection) ?? []), record as { id: string }]);
    }
    for (const [name, recs] of byCollection) (cache.collections as Record<string, unknown[]>)[name] = applyChanges((cache.collections as Record<string, { id: string }[]>)[name], recs);
    for (const r of batch.syncRecords ?? []) syncRecords.set(r.key, r);
    for (const r of batch.outboxRemove ?? []) if (outbox.get(r.key)?.seq === r.seq) outbox.delete(r.key);
    for (const e of batch.outboxAdd ?? []) { outbox.set(e.key, e); outboxSeq = Math.max(outboxSeq, e.seq); }
    if (batch.meta) spaceMeta = nextMeta;
    publish();
    return outcome;
  });
}

// Another tab of this space may have written since this one loaded: if the stored outbox differs from memory,
// reload everything from disk (screens update).
export async function refreshFromDisk(): Promise<void> {
  if (space.kind !== "account" || !db) return;
  const stored = await getAll<OutboxEntry>(db, "outbox");
  const same = stored.length === outbox.size && stored.every(e => outbox.get(e.key)?.seq === e.seq);
  const storedMeta = await request<SpaceMeta | undefined>(db.transaction("meta").objectStore("meta").get("space"));
  const syncedElsewhere = JSON.stringify(storedMeta?.cursors ?? {}) !== JSON.stringify(spaceMeta?.cursors ?? {});
  if (storedMeta) spaceMeta = storedMeta;
  if (!same || syncedElsewhere) await hydrate(db);
}

// Development only: a hot update would reset the loaded data above while screens keep running; reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
