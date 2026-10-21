import { before, test } from "node:test";
import assert from "node:assert/strict";
import { buildBackup, parseBackup, serializeBackup } from "../../src/lib/backup.ts";
import { buildFromLegacy } from "../../src/lib/data/legacy.ts";
import { COLLECTIONS, LEGACY_KEYS, newPhotoId } from "../../src/lib/data/schema.ts";

// Saving and unsaving a collection (the `savedCollections` collection) survives a reload. In Node there is no
// IndexedDB, so the store runs on its localStorage backend; a reload is a fresh copy of the store module reading
// the same storage. The IndexedDB store reads every collection in COLLECTIONS the same way (store.ts load).

class MemStorage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const storage = new MemStorage();
let loads = 0;
type Store = typeof import("../../src/lib/data/store.ts");
// A page load: a new store instance over the same device storage.
async function load(): Promise<Store> {
  const store = (await import(`../../src/lib/data/store.ts?load=${++loads}`)) as Store;
  const warn = console.warn;
  console.warn = () => {}; // "RootMap is using localStorage for now: IndexedDB unavailable"
  try { await store.initData(); } finally { console.warn = warn; }
  return store;
}
const live = (store: Store) => store.publishedCollection("savedCollections").filter(r => !r.deletedAt).map(r => r.id);
const now = () => new Date().toISOString();

before(() => {
  Object.assign(globalThis, { localStorage: storage, window: { addEventListener() {}, setTimeout } });
});

test("saved collections: a new collection in the schema, stored as a list of ids", () => {
  assert.ok(COLLECTIONS.includes("savedCollections"));
  assert.equal(LEGACY_KEYS.savedCollections, "rootmap-saved-collections");
});

test("saved collections: saving and unsaving persist after a reload", async () => {
  let store = await load();
  assert.deepEqual(live(store), []);
  const at = now();
  assert.equal(await store.write({ collections: { savedCollections: [
    { id: "after-work", createdAt: at, updatedAt: at, deletedAt: null, origin: "user", position: 0 },
    { id: "autumn", createdAt: at, updatedAt: at, deletedAt: null, origin: "user", position: 1 },
  ] } }), null);

  store = await load();
  assert.deepEqual(live(store), ["after-work", "autumn"], "both saved after a reload");

  const unsaved = { ...store.publishedCollection("savedCollections").find(r => r.id === "after-work")!, deletedAt: now(), updatedAt: now() };
  assert.equal(await store.write({ collections: { savedCollections: [unsaved] } }), null);

  store = await load();
  assert.deepEqual(live(store), ["autumn"], "unsaving persists too");
});

test("saved collections: kept in a backup file and restored from it", () => {
  const data = { "rootmap-saved": ["water-pouring"], "rootmap-saved-collections": ["rainy-day", "autumn"] };
  const parsed = parseBackup(serializeBackup(buildBackup(data)));
  assert.ok(parsed.ok);
  const built = buildFromLegacy({ values: data, unplaced: [] }, { now: now(), defaults: { children: [], records: [], observations: [], saved: [] }, extractPhotos: false, newPhotoId, photoSource: "restored" });
  assert.deepEqual(built.collections.savedCollections.map(r => [r.id, r.origin]), [["rainy-day", "user"], ["autumn", "user"]]);
  assert.deepEqual(built.collections.saved.map(r => r.id), ["water-pouring"]);
  // An older backup without the key restores with no saved collections.
  assert.deepEqual(buildFromLegacy({ values: {}, unplaced: [] }, { now: now(), defaults: { children: [], records: [], observations: [], saved: [] }, extractPhotos: false, newPhotoId, photoSource: "restored" }).collections.savedCollections, []);
  // A malformed list is refused.
  assert.equal(parseBackup(serializeBackup(buildBackup({ "rootmap-saved-collections": [1, 2] }))).ok, false);
});
