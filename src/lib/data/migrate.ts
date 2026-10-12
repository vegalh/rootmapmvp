import { done, getAll, request } from "./idb";
import { buildFromLegacy, readLegacyStorage, type Built, type Defaults } from "./legacy";
import { COLLECTIONS, STORE_NAMES, isPhotoId, newPhotoId, type MigrationMeta, type MigrationReport, type PhotoBlob, type PhotoMeta, type StoredDraft, type StoredSetting } from "./schema";

// One-time, non-destructive copy of localStorage into IndexedDB.
//
// - localStorage is only read, never changed or cleared: it stays as the pre-migration recovery copy.
// - Everything is written in ONE IndexedDB transaction, so an interruption leaves nothing half-written.
// - The result is read back and compared record by record (photos by size and type) before the migration is
//   marked complete in a second transaction. Until that marker exists the app never writes to IndexedDB, so
//   re-running after a failure or interruption simply starts over from localStorage: no duplicates, nothing lost.
export const MIGRATION_VERSION = 1;

export async function isMigrated(db: IDBDatabase) {
  const meta = await request<MigrationMeta | undefined>(db.transaction("meta").objectStore("meta").get("migration"));
  return meta?.state === "complete";
}

function writeAll(db: IDBDatabase, built: Built, now: string) {
  const tx = db.transaction([...STORE_NAMES], "readwrite");
  // Only data from a previous unfinished attempt can be here (see above), so clearing is safe.
  for (const name of STORE_NAMES) tx.objectStore(name).clear();
  for (const name of COLLECTIONS) {
    const store = tx.objectStore(name);
    for (const rec of built.collections[name]) store.put(rec);
  }
  for (const { meta, blob } of built.photos) {
    tx.objectStore("photos").put(meta);
    tx.objectStore("photoBlobs").put({ id: meta.id, blob } satisfies PhotoBlob);
  }
  for (const [key, value] of Object.entries(built.settings)) tx.objectStore("settings").put({ key, value, updatedAt: now } satisfies StoredSetting);
  for (const [key, draft] of Object.entries(built.drafts)) tx.objectStore("drafts").put({ ...draft, key } satisfies StoredDraft);
  for (const item of built.archive) tx.objectStore("archive").put(item);
  return done(tx);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Reads everything back; returns a description of the first mismatch, or null when all is intact.
async function verify(db: IDBDatabase, built: Built): Promise<string | null> {
  for (const name of COLLECTIONS) {
    const stored = new Map((await getAll<{ id: string }>(db, name)).map(r => [r.id, r]));
    if (stored.size !== built.collections[name].length) return `${name}: ${stored.size} stored, ${built.collections[name].length} expected`;
    for (const rec of built.collections[name]) if (!same(stored.get(rec.id), rec)) return `${name}/${rec.id} differs`;
  }
  const blobs = new Map((await getAll<PhotoBlob>(db, "photoBlobs")).map(p => [p.id, p.blob]));
  const metas = new Map((await getAll<PhotoMeta>(db, "photos")).map(p => [p.id, p]));
  for (const { meta, blob } of built.photos) {
    const stored = blobs.get(meta.id);
    if (!stored || stored.size !== blob.size || stored.type !== blob.type) return `photo ${meta.id} missing or damaged`;
    if (!same(metas.get(meta.id), meta)) return `photo metadata ${meta.id} differs`;
  }
  // Every photo a record points at must resolve.
  const refs = [
    ...built.collections.entries.flatMap(e => e.photos),
    ...built.collections.children.map(c => c.photo),
    ...Object.values(built.drafts).flatMap(d => d.photos),
    (built.settings["rootmap-profile"] as { photo?: string } | undefined)?.photo,
  ];
  for (const ref of refs) if (isPhotoId(ref) && !blobs.has(ref)) return `photo ${ref} referenced but not stored`;
  const settings = new Map((await getAll<StoredSetting>(db, "settings")).map(s => [s.key, s.value]));
  for (const [key, value] of Object.entries(built.settings)) if (!same(settings.get(key), value)) return `setting ${key} differs`;
  const drafts = new Map((await getAll<StoredDraft>(db, "drafts")).map(d => [d.key, d]));
  for (const [key, draft] of Object.entries(built.drafts)) if (!same(drafts.get(key), { ...draft, key })) return `draft ${key} differs`;
  if ((await getAll(db, "archive")).length !== built.archive.length) return "archive incomplete";
  return null;
}

function report(built: Built): MigrationReport {
  const counts: Record<string, number> = {};
  for (const name of COLLECTIONS) counts[name] = built.collections[name].length;
  counts.deletedChildren = built.collections.children.filter(c => c.deletedAt).length;
  counts.drafts = Object.keys(built.drafts).length;
  counts.settings = Object.keys(built.settings).length;
  // Records pointing at a child that no longer exists anywhere (kept as they were; just noted).
  const childIds = new Set(built.collections.children.map(c => c.id));
  const orphaned = [...built.collections.entries, ...built.collections.records, ...built.collections.observations].filter(r => !childIds.has(r.childId)).length;
  const warnings = orphaned ? [...built.warnings, `${orphaned} records refer to a child profile that is not on this device`] : built.warnings;
  return { counts, photos: built.photos.length, photoBytes: built.photos.reduce((n, p) => n + p.blob.size, 0), archived: built.archive.length, warnings };
}

export type MigrationResult = { ok: true; report: MigrationReport } | { ok: false; error: string };

export async function migrateFromLocalStorage(db: IDBDatabase, storage: Storage, defaults: Defaults): Promise<MigrationResult> {
  const startedAt = new Date().toISOString();
  let built: Built;
  try {
    built = buildFromLegacy(readLegacyStorage(storage), { now: startedAt, migratedAt: startedAt, defaults, extractPhotos: true, newPhotoId, photoSource: "migrated" });
  } catch (e) {
    return { ok: false, error: `read: ${String(e)}` };
  }
  try {
    await writeAll(db, built, startedAt);
  } catch (e) {
    return { ok: false, error: `write: ${e instanceof DOMException ? e.name : String(e)}` };
  }
  try {
    const problem = await verify(db, built);
    if (problem) return { ok: false, error: `verify: ${problem}` };
    const meta: MigrationMeta = { key: "migration", state: "complete", version: MIGRATION_VERSION, startedAt, completedAt: new Date().toISOString(), report: report(built) };
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(meta);
    await done(tx);
    return { ok: true, report: meta.report };
  } catch (e) {
    return { ok: false, error: `verify: ${String(e)}` };
  }
}
