import { before, test } from "node:test";
import assert from "node:assert/strict";

// The store's published state and change notifications (src/lib/data/store.ts). In Node there is no IndexedDB,
// so the store runs on its localStorage backend (an in-memory Storage here), where writes settle at once.
// The browser suite tests/e2e/reactive.mjs covers the IndexedDB timing and real screens.

class MemStorage {
  m = new Map<string, string>();
  failWrites = false;
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) {
    if (this.failWrites) throw new DOMException("Simulated full disk", "QuotaExceededError");
    this.m.set(k, String(v));
  }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const storage = new MemStorage();
let store: typeof import("../../src/lib/data/store.ts");

before(async () => {
  Object.assign(globalThis, { localStorage: storage, window: { addEventListener() {}, setTimeout } });
  store = await import("../../src/lib/data/store.ts");
  const warn = console.warn;
  console.warn = () => {}; // "RootMap is using localStorage for now: IndexedDB unavailable"
  try { assert.deepEqual(await store.initData(), { mode: "localStorage" }); } finally { console.warn = warn; }
});

const goal = (id: string, title = id) => ({ id, title, completed: false, createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z", deletedAt: null });

test("start-up publishes the loaded data before any screen renders (a new device: no demo children)", () => {
  assert.deepEqual(store.publishedCollection("children").map(c => c.id), []);
  assert.deepEqual(store.publishedCollection("records"), []);
  assert.deepEqual(store.publishedCollection("saved"), []);
});

test("a write made outside any screen is published and every subscriber is told once", async () => {
  let calls = 0;
  const off = store.subscribe(() => { calls++; });
  const childrenBefore = store.publishedCollection("children");
  const failure = await store.write({ collections: { goals: [goal("g-ext-1")] } });
  assert.equal(failure, null);
  assert.equal(calls, 1);
  assert.deepEqual(store.publishedCollection("goals").map(g => g.id), ["g-ext-1"]);
  // Collections the write did not touch keep their identity, so screens showing them do not re-render.
  assert.equal(store.publishedCollection("children"), childrenBefore);
  // And it was stored (localStorage backend: the original key and format).
  assert.equal(JSON.parse(storage.getItem("rootmap-goals")!)[0].id, "g-ext-1");
  off();
  await store.write({ collections: { goals: [goal("g-ext-2")] } });
  assert.equal(calls, 1, "no calls after unsubscribing");
});

test("an edit and a soft delete arrive the same way", async () => {
  await store.write({ collections: { goals: [goal("g-ext-1", "Renamed")] } });
  assert.equal(store.publishedCollection("goals").find(g => g.id === "g-ext-1")!.title, "Renamed");
  await store.write({ collections: { goals: [{ ...goal("g-ext-1", "Renamed"), deletedAt: "2026-10-12T01:00:00.000Z" }] } });
  const g = store.publishedCollection("goals").find(x => x.id === "g-ext-1")!;
  assert.ok(g.deletedAt, "still present, marked deleted (screens hide it)");
});

test("settings are published, with the stored-shape rule of readSetting", async () => {
  const fallback = "en";
  assert.equal(store.publishedSetting("rootmap-language", fallback), "en");
  await store.write({ settings: [["rootmap-language", "zh"]] });
  assert.equal(store.publishedSetting("rootmap-language", fallback), "zh");
  // A value of another shape than the fallback reads as the fallback, as before.
  await store.write({ settings: [["rootmap-language", ["zh"]]] });
  assert.equal(store.publishedSetting("rootmap-language", fallback), "en");
  // An unchanged setting keeps its identity across unrelated writes.
  const fallbackList: string[] = [];
  await store.write({ settings: [["rootmap-read-notifications", ["n1"]]] });
  const first = store.publishedSetting("rootmap-read-notifications", fallbackList);
  await store.write({ settings: [["rootmap-language", "en"]] });
  assert.equal(store.publishedSetting("rootmap-read-notifications", fallbackList), first);
});

test("a failed save with rollback is never published, and memory is put back", async () => {
  const before = store.publishedCollection("goals");
  let calls = 0;
  const off = store.subscribe(() => { calls++; });
  storage.failWrites = true;
  try {
    const failure = await store.write({ collections: { goals: [goal("g-fails")] } }, { rollback: true });
    assert.equal(failure, "full");
  } finally {
    storage.failWrites = false;
    off();
  }
  assert.equal(store.publishedCollection("goals"), before, "screens never saw it");
  assert.ok(!store.getCollection("goals").some(g => g.id === "g-fails"), "memory rolled back");
  assert.ok(calls <= 1);
});

test("a failed background save stays shown (and is reported by the caller), as before", async () => {
  storage.failWrites = true;
  try {
    const failure = await store.write({ collections: { goals: [goal("g-background")] } });
    assert.equal(failure, "full");
  } finally {
    storage.failWrites = false;
  }
  assert.ok(store.publishedCollection("goals").some(g => g.id === "g-background"));
});
