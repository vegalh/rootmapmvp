import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFromLegacy, dataUrlToBlob, readLegacyStorage } from "../../src/lib/data/legacy.ts";
import { applyChanges, diffCollection } from "../../src/lib/data/records.ts";
import { isPhotoId, newPhotoId, uuid } from "../../src/lib/data/schema.ts";

class MemStorage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const png1 = "data:image/png;base64," + Buffer.from("PNGDATA-1".repeat(5000)).toString("base64");
const png2 = "data:image/jpeg;base64," + Buffer.from("JPEG-2".repeat(9000)).toString("base64");
const defaults = {
  children: [{ id: "emma", first: "Maya", last: "Hao", dob: "2023-08-10", enrolled: "x", lessons: 1, group: "Primary", photo: "/maya.svg" }],
  records: [{ id: "r1", childId: "emma", lesson: "Pink Tower", date: "2026-10-05" }],
  observations: [{ id: "o1", childId: "emma", date: "2026-10-08", notes: "n", skills: [] }],
  saved: ["water-pouring", "dotting"],
} as any;
const opts = (extra = {}) => ({ now: "2026-10-11T00:00:00.000Z", migratedAt: "2026-10-11T00:00:00.000Z", defaults, extractPhotos: true, newPhotoId, photoSource: "migrated" as const, ...extra });

function fixture() {
  const s = new MemStorage();
  s.setItem("rootmap-children", JSON.stringify([
    defaults.children[0],
    { id: "c-1700000000000", first: "小明", last: "张", dob: "2022-01-01", enrolled: "x", lessons: 0, group: "Toddler", photo: png1, notes: "Zoë 😊" },
  ]));
  s.setItem("rootmap-deleted-children", JSON.stringify([
    { id: "c-1700000000001", first: "Ana", last: "Gómez", photo: png2, deletedAt: "2026-09-01T10:00:00.000Z" },
    { id: "c-1700000000001", first: "Ana", last: "Gómez", photo: png2, deletedAt: "2026-09-05T10:00:00.000Z" },
    { id: "emma", first: "Maya", last: "Hao", photo: "/maya.svg", deletedAt: "2026-08-01T00:00:00.000Z" },
  ]));
  s.setItem("rootmap-journal", JSON.stringify([
    { id: "m-1700000000000-abc123", childId: "c-1700000000000", date: "2026-10-01", title: "第一天", text: "Hello 世界", photos: [png1, png2], createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z" },
    { id: "obs-o1", childId: "emma", date: "2026-10-08", text: "n", photos: [], createdAt: "2026-10-08T12:00:00.000Z", updatedAt: "2026-10-08T12:00:00.000Z" },
  ]));
  s.setItem("rootmap-records", JSON.stringify([{ id: "t-1700000000000-x", childId: "emma", kind: "tried", activityId: "water-pouring", lesson: "Water", date: "2026-10-02", createdAt: "2026-10-02T00:00:00.000Z" }, defaults.records[0]]));
  s.setItem("rootmap-plans", JSON.stringify([{ id: "p-1700000000000", activityId: "dotting", date: "2026-10-12", childIds: ["emma"] }, { id: "p-1700000000000", activityId: "water-pouring", date: "2026-10-13", childIds: [] }]));
  s.setItem("rootmap-goals", JSON.stringify([{ id: "g-1700000000000", title: "Read more", completed: false, createdAt: "2026-09-01T00:00:00.000Z" }]));
  s.setItem("rootmap-saved", JSON.stringify(["dotting", "my-activity"]));
  s.setItem("rootmap-journal-drafts", JSON.stringify({ "c-1700000000000:new": { childId: "c-1700000000000", date: "2026-10-10", title: "", text: "draft", photos: [png1], savedAt: "2026-10-10T00:00:00.000Z" } }));
  s.setItem("rootmap-profile", JSON.stringify({ name: "Lin", photo: png2, contact: "" }));
  s.setItem("rootmap-language", JSON.stringify("zh"));
  s.setItem("rootmap-personal-notes", "plain text notes");
  s.setItem("rootmap-pref-Follow-up reminders", "false");
  s.setItem("rootmap-goals.corrupt", "{oops");
  s.setItem("rootmap-observations", "{not json");
  s.setItem("rootmap-something-new", "42");
  s.setItem("other-site", "x");
  return s;
}

test("reading legacy storage never modifies it", () => {
  const s = fixture();
  const before = JSON.stringify([...s.m]);
  readLegacyStorage(s as any);
  assert.equal(JSON.stringify([...s.m]), before);
});

test("migration preserves every record, id, date, text and relationship", () => {
  const built = buildFromLegacy(readLegacyStorage(fixture() as any), opts());
  const c = built.collections;
  assert.deepEqual(c.children.map(x => [x.id, x.deletedAt]), [["emma", null], ["c-1700000000000", null], ["c-1700000000001", "2026-09-05T10:00:00.000Z"]]);
  assert.equal(c.children[1].first, "小明");
  assert.equal(c.children[1].notes, "Zoë 😊");
  const entry = c.entries.find(e => e.id === "m-1700000000000-abc123")!;
  assert.equal(entry.title, "第一天");
  assert.equal(entry.text, "Hello 世界");
  assert.equal(entry.date, "2026-10-01");
  assert.equal(entry.createdAt, "2026-10-01T08:00:00.000Z");
  assert.equal(entry.childId, "c-1700000000000");
  assert.equal(entry.photos.length, 2);
  assert.ok(entry.photos.every(isPhotoId));
  assert.equal(c.records.length, 2);
  assert.equal(c.records[1].createdAt, null, "missing createdAt stays null, not invented");
  assert.equal(c.records[1].updatedAt, "2026-10-11T00:00:00.000Z");
  assert.deepEqual(c.saved.map(s => s.id), ["dotting", "my-activity"]);
  assert.equal(c.goals.length, 1);
});

test("conflicting duplicate ids are both kept; exact duplicates and stale snapshots are archived", () => {
  const built = buildFromLegacy(readLegacyStorage(fixture() as any), opts());
  assert.deepEqual(built.collections.plans.map(p => [p.id, p.legacyId]), [["p-1700000000000", undefined], ["p-1700000000000~2", "p-1700000000000"]]);
  const reasons = built.archive.map(a => `${a.source}:${a.reason}`).sort();
  assert.deepEqual(reasons, [
    "rootmap-deleted-children:older-deleted-snapshot",
    "rootmap-deleted-children:snapshot-of-active-child",
    "rootmap-goals.corrupt:earlier-unreadable-copy",
    "rootmap-observations:unreadable",
    "rootmap-something-new:unrecognized-key",
  ]);
  assert.equal(built.archive.find(a => a.source === "rootmap-observations")!.value, "{not json");
});

test("unreadable collection falls back exactly like the app did (its default) and keeps the raw value", () => {
  const built = buildFromLegacy(readLegacyStorage(fixture() as any), opts());
  assert.deepEqual(built.collections.observations.map(o => o.id), ["o1"]);
});

test("photos: same bytes, deduplicated, and referenced by id everywhere", async () => {
  const built = buildFromLegacy(readLegacyStorage(fixture() as any), opts());
  assert.equal(built.photos.length, 2, "png1 and png2 are each stored once");
  const byId = new Map(built.photos.map(p => [p.meta.id, p]));
  const entry = built.collections.entries[0];
  const p1 = byId.get(entry.photos[0])!;
  assert.deepEqual(Buffer.from(await p1.blob.arrayBuffer()), Buffer.from(png1.split(",")[1], "base64"));
  assert.equal(p1.meta.mimeType, "image/png");
  assert.equal(built.collections.children[1].photo, entry.photos[0]);
  assert.equal(built.drafts["c-1700000000000:new"].photos[0], entry.photos[0]);
  assert.equal((built.settings["rootmap-profile"] as any).photo, entry.photos[1]);
  assert.equal(built.collections.children[2].photo, entry.photos[1]);
  assert.equal(built.collections.children[0].photo, "/maya.svg", "bundled image URLs are left alone");
});

test("settings keep legacy keys and raw text", () => {
  const built = buildFromLegacy(readLegacyStorage(fixture() as any), opts());
  assert.equal(built.settings["rootmap-language"], "zh");
  assert.equal(built.settings["rootmap-personal-notes"], "plain text notes");
  assert.equal(built.settings["rootmap-pref-Follow-up reminders"], false);
});

test("origin is only labelled when reliable", () => {
  const built = buildFromLegacy(readLegacyStorage(fixture() as any), opts());
  const o = (list: any[], id: string) => list.find(x => x.id === id).origin;
  assert.equal(o(built.collections.children, "emma"), "demo");
  assert.equal(o(built.collections.children, "c-1700000000000"), "user");
  assert.equal(o(built.collections.entries, "obs-o1"), "demo");
  assert.equal(o(built.collections.entries, "m-1700000000000-abc123"), "user");
  assert.equal(o(built.collections.saved, "dotting"), "unknown");
  assert.equal(o(built.collections.saved, "my-activity"), "user");
});

test("empty device gets the same demo data the app always showed, labelled demo", () => {
  const built = buildFromLegacy(readLegacyStorage(new MemStorage() as any), opts());
  assert.deepEqual(built.collections.children.map(c => [c.id, c.origin]), [["emma", "demo"]]);
  assert.deepEqual(built.collections.saved.map(s => [s.id, s.origin]), [["water-pouring", "demo"], ["dotting", "demo"]]);
  assert.equal(built.collections.entries.length, 0);
});

test("building twice gives the same records (idempotent apart from fresh photo ids)", () => {
  const strip = (b: any) => JSON.stringify(b.collections, (k, v) => (typeof v === "string" && isPhotoId(v) ? "PHOTO" : v));
  assert.equal(strip(buildFromLegacy(readLegacyStorage(fixture() as any), opts())), strip(buildFromLegacy(readLegacyStorage(fixture() as any), opts())));
});

test("dataUrlToBlob handles base64, url-encoded and invalid input", async () => {
  assert.equal(await dataUrlToBlob("data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E")!.text(), "<svg></svg>");
  assert.equal(dataUrlToBlob("data:image/png;base64,@@@"), null);
  assert.equal(dataUrlToBlob("https://x"), null);
});

test("diff: add stamps createdAt/updatedAt and slots position; edit only rewrites that record", () => {
  const now = "2026-10-11T01:00:00.000Z";
  const prev = [{ id: "a", v: 1, position: 0, createdAt: null, updatedAt: "x", deletedAt: null }, { id: "b", v: 2, position: 1, createdAt: "y", updatedAt: "y", deletedAt: null }] as any[];
  const added = diffCollection(prev, [{ id: "n", v: 0 } as any, ...prev], now, () => "user");
  assert.equal(added.length, 1);
  assert.deepEqual([added[0].id, added[0].position, added[0].createdAt, added[0].updatedAt, added[0].origin, added[0].deletedAt], ["n", -1, now, now, "user", null]);
  const edited = diffCollection(prev, [prev[0], { ...prev[1], v: 3 }], now, () => "user");
  assert.equal(edited.length, 1);
  assert.equal(edited[0].createdAt, "y");
  const editedLegacy = diffCollection(prev, [{ ...prev[0], v: 9 }, prev[1]], now, () => "user");
  assert.equal(editedLegacy[0].createdAt, null, "unknown creation time stays unknown after edit");
});

test("diff: removing soft-deletes; re-adding restores the same id at the end", () => {
  const now = "2026-10-11T01:00:00.000Z";
  const prev = [{ id: "a", position: 0, deletedAt: null }, { id: "b", position: 1, deletedAt: null }] as any[];
  const removed = diffCollection(prev, [prev[1]], now, () => "user");
  assert.deepEqual(removed.map(r => [r.id, r.deletedAt]), [["a", now]]);
  const all = applyChanges(prev, removed);
  assert.equal(all.length, 2, "the record is still stored");
  const { deletedAt, ...back } = all.find(r => r.id === "a");
  const restored = diffCollection(all, [prev[1], back], now, () => "user");
  assert.deepEqual(restored.map(r => [r.id, r.deletedAt, r.position]), [["a", null, 2]]);
});

test("diff: unchanged list writes nothing", () => {
  const prev = [{ id: "a", position: 0, deletedAt: null }] as any[];
  assert.equal(diffCollection(prev, [...prev], "t", () => "user").length, 0);
});

test("uuid ids are unique and well-formed", () => {
  const ids = new Set(Array.from({ length: 10000 }, uuid));
  assert.equal(ids.size, 10000);
  assert.ok(isPhotoId(newPhotoId()));
});
