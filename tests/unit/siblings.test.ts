import { test } from "node:test";
import assert from "node:assert/strict";
import { buildActivityRecord, planCompletionRecords } from "../../src/lib/activityRecords";
import { mergeShared } from "../../src/lib/entries";
import { deviceLanguage } from "../../src/lib/i18n";
import type { Entry, LessonRecord, Plan } from "../../src/types";

// Siblings: Mark as Tried and Moments for several children at once, completing a plan after Mark as Tried, and
// opening in the phone's language.

const NOW = "2026-10-30T08:00:00.000Z";
const DAY = "2026-10-30";

test("plan completion: a child already marked as tried for this activity today gets no second record", () => {
  const plan: Plan = { id: "p-1", activityId: "dotting", date: DAY, childIds: ["a", "b", "c"] };
  const tried = (childId: string, patch: Partial<LessonRecord> = {}): LessonRecord => {
    const built = buildActivityRecord({ kind: "tried", childId, date: DAY, activityId: "dotting" }, `t-${childId}`, NOW, ["a", "b", "c"]);
    assert.ok("record" in built);
    return { ...built.record, ...patch };
  };
  let n = 0;
  const id = () => `t-new-${++n}`;
  const childrenGetting = (records: LessonRecord[]) => planCompletionRecords(plan, records, ["a", "b", "c"], DAY, NOW, id).map(r => r.childId);

  // Same day, same activity, live: skipped. The others still get theirs.
  assert.deepEqual(childrenGetting([tried("a")]), ["b", "c"]);
  // Another day, another activity, or a deleted record: never blocks.
  assert.deepEqual(childrenGetting([tried("a", { date: "2026-10-29" })]), ["a", "b", "c"]);
  assert.deepEqual(childrenGetting([tried("a", { activityId: "water-pouring" })]), ["a", "b", "c"]);
  assert.deepEqual(childrenGetting([tried("a", { deletedAt: NOW })]), ["a", "b", "c"]);
  // Everyone tried it today: nothing to add.
  assert.deepEqual(childrenGetting([tried("a"), tried("b"), tried("c")]), []);
});

const entry = (id: string, childId: string, patch: Partial<Entry> = {}): Entry => ({
  id, childId, date: DAY, title: "Leaf rubbing", text: "They loved the colours.", photos: ["ph-1", "ph-2"], createdAt: NOW, updatedAt: NOW, ...patch,
});

test("mergeShared: a moment saved for several children is one entry naming every child", () => {
  const list = [entry("m-1", "a"), entry("m-2", "b"), entry("m-3", "a", { title: "Another", createdAt: "2026-10-30T07:00:00.000Z" }), entry("m-4", "c")];
  const { entries, childrenOf } = mergeShared(list);
  assert.deepEqual(entries.map(e => e.id), ["m-1", "m-3"], "the first of each group, in order");
  assert.deepEqual(childrenOf.get("m-1"), ["a", "b", "c"]);
  assert.deepEqual(childrenOf.get("m-3"), ["a"]);
  // Display only: the entries themselves are untouched.
  assert.equal(list.length, 4);
  assert.equal(entries[0], list[0]);
});

test("mergeShared: different text, photos or createdAt are separate moments", () => {
  for (const patch of [
    { text: "Edited for one child." },
    { photos: ["ph-1"] },
    { photos: ["ph-2", "ph-1"] },
    { createdAt: "2026-10-30T08:00:01.000Z" },
  ] satisfies Partial<Entry>[]) {
    const { entries, childrenOf } = mergeShared([entry("m-1", "a"), entry("m-2", "b", patch)]);
    assert.deepEqual(entries.map(e => e.id), ["m-1", "m-2"], JSON.stringify(patch));
    assert.deepEqual(childrenOf.get("m-1"), ["a"]);
    assert.deepEqual(childrenOf.get("m-2"), ["b"]);
  }
});

test("deviceLanguage: Chinese when the first preferred language is Chinese, otherwise English", () => {
  for (const zh of [["zh-CN"], ["zh"], ["zh-Hans-CN"], ["zh-TW"], ["ZH-cn"]]) assert.equal(deviceLanguage(zh), "zh", zh.join());
  for (const en of [["en-US"], ["en-GB", "zh-CN"], ["fr"], []]) assert.equal(deviceLanguage(en), "en", en.join());
});

test("deviceLanguage: English where there is no navigator", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
  try {
    assert.equal(deviceLanguage(undefined), "en");
    assert.equal(deviceLanguage(), "en");
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
});
