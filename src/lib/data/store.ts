import type { EntryDraft } from "../../types";
import { initialChildren } from "../../data/children";
import { initialObservations, initialRecords } from "../../data/progress";
import { BACKUP_KEYS } from "../backup";
import { backupCorrupt, isQuotaError, writeRaw, type StorageFailure } from "../storage";
import { done, getAll, openDatabase, request } from "./idb";
import { buildFromLegacy, readLegacyStorage, type Built, type Defaults } from "./legacy";
import { isMigrated, migrateFromLocalStorage } from "./migrate";
import { applyChanges, byPosition } from "./records";
import {
  COLLECTIONS, LEGACY_DELETED_CHILDREN_KEY, LEGACY_DRAFTS_KEY, LEGACY_KEYS, STORE_NAMES, isPhotoId, newPhotoId, settingShape,
  type CollectionName, type Collections, type PhotoBlob, type PhotoMeta, type StoreName, type StoredDraft, type StoredSetting,
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

export async function initData(): Promise<DataStatus> {
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
  const undo = applyToCache(change);
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
    tx = transactionFor(change);
  } catch (e) {
    return Promise.resolve(settle(failureOf(e)));
  }
  return done(tx).then(
    () => {
      if (change.drafts) clearRescue(change.drafts.map(([key]) => key));
      return settle(null);
    },
    e => settle(failureOf(e)),
  );
}

function transactionFor(change: Change) {
  if (!db) throw new Error("database closed");
  const stores = new Set<StoreName>(Object.keys(change.collections || {}) as CollectionName[]);
  if (change.settings?.length) stores.add("settings");
  if (change.drafts?.length) stores.add("drafts");
  const tx = db.transaction([...stores], "readwrite");
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
  return tx;
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

function readRescue(): Rescue {
  try {
    const parsed = JSON.parse(localStorage.getItem(RESCUE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Synchronously keeps a copy of a draft write that may not finish because the page is going away.
export function rescueDraft(key: string, draft: EntryDraft | null) {
  if (mode !== "indexeddb") return; // the localStorage backend already writes synchronously
  try {
    localStorage.setItem(RESCUE_KEY, JSON.stringify({ ...readRescue(), [key]: { draft, at: nowIso() } }));
  } catch {
    // Out of space: the IndexedDB write is still under way.
  }
}

function clearRescue(keys: string[]) {
  try {
    if (localStorage.getItem(RESCUE_KEY) === null) return;
    const rescue = readRescue();
    for (const key of keys) delete rescue[key];
    if (Object.keys(rescue).length) localStorage.setItem(RESCUE_KEY, JSON.stringify(rescue));
    else localStorage.removeItem(RESCUE_KEY);
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
  const meta: PhotoMeta = { id, mimeType: blob.type || "image/jpeg", byteSize: blob.size, width: size?.width ?? null, height: size?.height ?? null, createdAt: now, updatedAt: now, deletedAt: null, source: "upload", storagePath: null, uploadedAt: null };
  try {
    const tx = db.transaction(["photos", "photoBlobs"], "readwrite");
    tx.objectStore("photos").put(meta);
    tx.objectStore("photoBlobs").put({ id, blob } satisfies PhotoBlob);
    await done(tx);
  } catch (e) {
    return { ok: false, failure: failureOf(e) };
  }
  photoUrls.set(id, URL.createObjectURL(blob));
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
  try {
    const tx = db.transaction(STORE_NAMES.filter(s => s !== "meta"), "readwrite");
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
    return false;
  }
}

// Development only: a hot update would reset the loaded data above while screens keep running; reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
