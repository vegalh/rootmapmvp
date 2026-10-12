import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildFromLegacy, readLegacyStorage } from "../../src/lib/data/legacy.ts";
import { newPhotoId, newRecordId, uuid } from "../../src/lib/data/schema.ts";

// Record ids must never collide, even across devices of one family (the cloud key is (family_id, id)).

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("newRecordId: <prefix>-<uuid v4> for every record kind", () => {
  for (const prefix of ["c", "r", "t", "m", "p", "g"]) {
    const id = newRecordId(prefix);
    assert.ok(id.startsWith(`${prefix}-`), id);
    assert.match(id.slice(prefix.length + 1), V4);
  }
  assert.match(newPhotoId(), /^photo-[0-9a-f-]{36}$/);
});

test("ids made in the same millisecond are all different (Date.now() ids were not)", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 20000; i++) ids.add(newRecordId("p"));
  assert.equal(ids.size, 20000);
});

test("without crypto.randomUUID (an http LAN preview), ids are still random v4 uuids", () => {
  const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(crypto), "randomUUID")!;
  Object.defineProperty(Object.getPrototypeOf(crypto), "randomUUID", { configurable: true, value: () => { throw new Error("insecure context"); } });
  try {
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const id = uuid();
      assert.match(id, V4);
      ids.add(id);
    }
    assert.equal(ids.size, 5000);
  } finally {
    Object.defineProperty(Object.getPrototypeOf(crypto), "randomUUID", original);
  }
});

test("new goal and plan ids are recognised as the parent's own data (origin 'user') by the migration rules", () => {
  const m = new Map<string, string>([
    ["rootmap-goals", JSON.stringify([{ id: newRecordId("g"), title: "Read", completed: false, createdAt: "2026-10-12T00:00:00.000Z" }])],
    ["rootmap-plans", JSON.stringify([{ id: newRecordId("p"), activityId: "dotting", date: "2026-10-12", childIds: [] }])],
  ]);
  const storage = { get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null, setItem() {}, removeItem() {}, clear() {} };
  const defaults = { children: [], records: [], observations: [], saved: [] } as never;
  const built = buildFromLegacy(readLegacyStorage(storage as unknown as Storage), { now: "2026-10-12T00:00:00.000Z", defaults, extractPhotos: false, newPhotoId, photoSource: "migrated" });
  assert.equal(built.collections.goals[0].origin, "user");
  assert.equal(built.collections.plans[0].origin, "user");
});

test("no screen creates record ids from the clock", () => {
  const root = path.resolve(import.meta.dirname, "../../src");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(entry.name) && /\bid:\s*`[^`]*\$\{Date\.now\(\)\}/.test(fs.readFileSync(file, "utf8"))) offenders.push(path.relative(root, file));
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], "use newRecordId(prefix) from src/lib/data/schema.ts");
});
