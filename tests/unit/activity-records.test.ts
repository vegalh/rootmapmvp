import { test } from "node:test";
import assert from "node:assert/strict";
import { DISCOVER_CATEGORIES, catalogCategories, catalogItems, findActivity, searchCatalog, spreadEvenly } from "../../src/lib/catalog.ts";
import { buildActivityRecord, recentActivityIds, recordView } from "../../src/lib/activityRecords.ts";
import { copy } from "../../src/lib/i18n.ts";
import { activities } from "../../src/data/activities.ts";
import { musicActivities } from "../../src/data/music.ts";
import { initialRecords } from "../../src/data/progress.ts";
import type { LessonRecord } from "../../src/types.ts";

const en = copy.en, zh = copy.zh;
const now = "2026-10-13T09:00:00.000Z";
const ids = (list: { id: string }[]) => list.map(a => a.id);

test("catalog: one list of every Discover activity and music activity, ids unchanged", () => {
  const items = catalogItems();
  assert.deepEqual([...ids(items)].sort(), [...ids(activities), ...ids(musicActivities)].sort());
  assert.equal(new Set(ids(items)).size, items.length, "ids are unique across activities and music");
  assert.ok(items.filter(a => a.type === "music").every(a => a.area === "Music" && a.category === "art-creativity"));
  for (const a of items) assert.equal(findActivity(a.id)?.id, a.id);
});

test("catalog: music is spread evenly through the activities, in a stable order", () => {
  const items = ids(catalogItems());
  assert.deepEqual(ids(catalogItems()), items, "the same order every time");
  // Each list keeps its own order.
  assert.deepEqual(items.filter(id => !id.startsWith("music-")), ids(activities));
  assert.deepEqual(items.filter(id => id.startsWith("music-")), ids(musicActivities));
  // Not all at the end, and no two music activities next to each other.
  const at = items.map((id, i) => (id.startsWith("music-") ? i : -1)).filter(i => i >= 0);
  assert.ok(at[0] < items.length / 2 && at[at.length - 1] < items.length - 1, JSON.stringify(at));
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] > 1, JSON.stringify(at));
  assert.deepEqual(spreadEvenly([1, 2, 3, 4, 5, 6], ["a", "b"]), [1, 2, "a", 3, 4, "b", 5, 6]);
  assert.deepEqual(spreadEvenly([1, 2], []), [1, 2]);
  assert.deepEqual(spreadEvenly([], ["a"]), ["a"]);
});

test("catalog: Discover and Add Activity share the six categories; an empty one (Math) isn't offered as a filter", () => {
  assert.deepEqual(catalogCategories(), DISCOVER_CATEGORIES);
  assert.deepEqual([...DISCOVER_CATEGORIES], ["practical-life", "language", "math", "art-creativity", "nature-culture", "sensory-movement"]);
  const used = new Set(catalogItems().map(a => a.category));
  assert.deepEqual(catalogCategories({ inUse: true }), DISCOVER_CATEGORIES.filter(c => used.has(c)));
  assert.ok(!catalogCategories({ inUse: true }).includes("math"), "no math activities yet");
  assert.ok(catalogCategories().includes("math"), "a custom activity can still be Math");
});

test("search: English title, partial and case-insensitive", () => {
  const found = ids(searchCatalog("POUR"));
  for (const id of ["water-pouring", "pouring-to-cups", "pouring-stars"]) {
    if (findActivity(id)) assert.ok(found.includes(id), id);
  }
  assert.ok(found.every(id => /pour/i.test(findActivity(id)!.title) || findActivity(id)!.keywords.includes("pour")));
});

test("search: Chinese title, whatever the interface language", () => {
  const found = searchCatalog("倒水");
  assert.ok(found.length > 0);
  assert.ok(found.some(a => a.zh?.title?.includes("倒水")));
  assert.deepEqual(ids(searchCatalog("音乐停")), ["music-freeze-dance"]);
});

test("search: keywords and category names in both languages", () => {
  assert.ok(ids(searchCatalog("gross motor")).includes("duck-walk"));
  const movement = searchCatalog("movement");
  assert.ok(catalogItems().filter(a => a.area === "Movement").every(a => movement.includes(a)), "category name finds the whole category");
  assert.ok(searchCatalog("日常生活").length > 0, "Chinese category label");
  assert.equal(searchCatalog("音乐").filter(a => a.type === "music").length, musicActivities.length, "Chinese 'Music' finds every music activity");
  assert.deepEqual(searchCatalog("zzz-nothing"), []);
});

test("search: category filter and query work together; title matches come first", () => {
  const water = searchCatalog("water", { category: "practical-life" });
  assert.ok(water.length > 0);
  assert.ok(water.every(a => a.category === "practical-life"));
  const art = searchCatalog("", { category: "art-creativity" });
  assert.ok(ids(musicActivities).every(id => ids(art).includes(id)), "music is in Art & Creativity");
  assert.ok(art.some(a => a.type === "activity"), "alongside the art activities");
  assert.deepEqual(ids(searchCatalog("", { category: "math" })), []);
  const pour = searchCatalog("pour");
  const firstNonTitle = pour.findIndex(a => !a.title.toLowerCase().includes("pour"));
  if (firstNonTitle >= 0) assert.ok(pour.slice(firstNonTitle).every(a => !a.title.toLowerCase().includes("pour")));
});

test("records: a catalog record stores the stable id with title and category snapshots", () => {
  const a = activities[0];
  const built = buildActivityRecord({ childId: "emma", date: "2026-10-13", activityId: a.id, notes: "  " }, "r-1", now);
  assert.ok("record" in built);
  assert.deepEqual(built.record, { id: "r-1", childId: "emma", activityId: a.id, lesson: a.title, area: a.area, date: "2026-10-13", createdAt: now });
});

test("records: music activities record the same way", () => {
  const m = musicActivities[0];
  const built = buildActivityRecord({ childId: "emma", date: "2026-10-13", activityId: m.id, stage: "Practicing", skills: ["Order"] }, "r-2", now);
  assert.ok("record" in built);
  assert.equal(built.record.area, "Music");
  assert.equal(built.record.stage, "Practicing");
  assert.deepEqual(built.record.skills, ["Order"]);
  assert.equal(recordView(built.record, zh).title, m.titleZh);
  assert.equal(recordView(built.record, zh).music, true);
});

test("records: Mark as Tried keeps its shape (kind tried, no area or stage)", () => {
  const a = activities[1];
  const built = buildActivityRecord({ kind: "tried", childId: "noah", date: "2026-10-12", activityId: a.id, notes: " Loved it " }, "t-1", now);
  assert.ok("record" in built);
  assert.deepEqual(built.record, { id: "t-1", childId: "noah", kind: "tried", activityId: a.id, lesson: a.title, date: "2026-10-12", notes: "Loved it", createdAt: now });
  assert.equal(recordView(built.record, en).area, undefined);
});

test("records: a custom activity keeps its name exactly and needs a name and an area", () => {
  const built = buildActivityRecord({ childId: "emma", date: "2026-10-13", customTitle: "  Climbing at the playground ", customArea: "Movement" }, "r-3", now);
  assert.ok("record" in built);
  assert.equal(built.record.lesson, "Climbing at the playground");
  assert.equal(built.record.activityId, undefined);
  assert.equal(built.record.stage, undefined);
  assert.equal(recordView(built.record, zh).title, "Climbing at the playground");
  assert.equal(recordView(built.record, zh).area, zh.movement);
  assert.ok(!catalogItems().some(a => a.title === "Climbing at the playground"), "never added to Discover");
  assert.deepEqual(buildActivityRecord({ childId: "emma", date: "2026-10-13", customTitle: " ", customArea: "Art" }, "x", now), { problem: "name" });
  assert.deepEqual(buildActivityRecord({ childId: "emma", date: "2026-10-13", customTitle: "Leaves" }, "x", now), { problem: "area" });
});

test("records: validation", () => {
  const a = activities[0].id;
  assert.deepEqual(buildActivityRecord({ childId: "", date: "2026-10-13", activityId: a }, "x", now), { problem: "child" });
  assert.deepEqual(buildActivityRecord({ childId: "emma", date: "13/10/2026", activityId: a }, "x", now), { problem: "date" });
  assert.deepEqual(buildActivityRecord({ childId: "emma", date: "2026-10-13", activityId: "no-such-activity" }, "x", now), { problem: "activity" });
  assert.deepEqual(buildActivityRecord({ kind: "tried", childId: "emma", date: "2026-10-13", customTitle: "x", customArea: "Art" }, "x", now), { problem: "activity" });
});

test("history: legacy records keep their title, area, stage and translations", () => {
  const r1 = initialRecords[0];
  const v = recordView(r1, zh);
  assert.equal(v.title, "倒水练习");
  assert.equal(v.area, zh.practical);
  assert.equal(v.stage, zh.practicing);
  // Older learning areas read in everyday words; the stored value stays "Sensorial".
  assert.equal(recordView(initialRecords[1], en).area, "Senses");
  assert.equal(initialRecords[1].area, "Sensorial");
  const old: LessonRecord = { id: "old", childId: "emma", lesson: "Golden Beads", area: "Mathematics", stage: "Introduced", date: "2026-09-01" };
  assert.equal(recordView(old, zh).title, "金色珠串");
  assert.equal(recordView(old, zh).area, zh.mathematics);
  assert.equal(recordView(old, en).area, "Math");
});

test("history: removed activities fall back to the stored title; nothing is blank", () => {
  const gone: LessonRecord = { id: "g", childId: "emma", activityId: "retired-activity", lesson: "Old Activity", area: "Art", date: "2026-10-01" };
  assert.equal(recordView(gone, zh).title, "Old Activity");
  assert.equal(recordView(gone, zh).area, zh.art);
  const blank: LessonRecord = { id: "b", childId: "emma", lesson: "", date: "2026-10-01" };
  assert.equal(recordView(blank, en).title, en.lessonActivityLabel);
  assert.equal(recordView(blank, en).area, undefined);
  assert.equal(recordView(blank, en).stage, undefined);
});

test("records: a custom activity can use a parent-facing category; older custom areas still read the same", () => {
  const built = buildActivityRecord({ childId: "emma", date: "2026-10-13", customTitle: "Counting stairs", customArea: "math" }, "r-4", now);
  assert.ok("record" in built);
  assert.equal(built.record.area, "math");
  assert.equal(recordView(built.record, en).area, "Math");
  assert.equal(recordView(built.record, zh).area, "数学");
  const older: LessonRecord = { id: "o", childId: "emma", lesson: "Climbing", area: "Movement", date: "2026-09-01" };
  assert.equal(recordView(older, en).area, en.movement);
  assert.equal(older.area, "Movement", "the stored value is never rewritten");
});

test("history: a catalog record shows the activity's category, the same as Discover and Add Activity", () => {
  const m = musicActivities[0];
  const r: LessonRecord = { id: "m", childId: "emma", activityId: m.id, lesson: m.title, area: "Music", date: "2026-10-01" };
  assert.equal(recordView(r, en).area, "Art & Creativity");
  assert.equal(recordView(r, zh).area, "艺术与创造");
  assert.equal(r.area, "Music", "stored snapshot unchanged");
  const a = activities.find(x => x.id === "matching-color-caps")!;
  assert.equal(recordView({ id: "x", childId: "emma", activityId: a.id, lesson: a.title, area: a.area, date: "2026-10-01" }, en).area, "Sensory & Movement");
});

test("history: catalog records show the current localized title", () => {
  const a = activities[0];
  const r: LessonRecord = { id: "c", childId: "emma", activityId: a.id, lesson: "Snapshot title", area: a.area, date: "2026-10-01" };
  assert.equal(recordView(r, en).title, a.title);
  assert.equal(recordView(r, zh).title, a.zh?.title || a.title);
});

test("recently used: newest first, this child first, no repeats, only catalog activities", () => {
  const [a, b, c] = activities;
  const m = musicActivities[0];
  const records: LessonRecord[] = [
    { id: "1", childId: "emma", activityId: a.id, lesson: a.title, date: "2026-10-01" },
    { id: "2", childId: "emma", activityId: b.id, lesson: b.title, date: "2026-10-05" },
    { id: "3", childId: "emma", activityId: a.id, lesson: a.title, date: "2026-10-06", kind: "tried" },
    { id: "4", childId: "noah", activityId: c.id, lesson: c.title, date: "2026-10-09" },
    { id: "5", childId: "emma", activityId: "retired-activity", lesson: "Gone", date: "2026-10-10" },
    { id: "6", childId: "emma", lesson: "Pink Tower", area: "Sensorial", date: "2026-10-11" },
    { id: "7", childId: "emma", activityId: m.id, lesson: m.title, date: "2026-10-02", deletedAt: now },
  ];
  assert.deepEqual(recentActivityIds(records, "emma"), [a.id, b.id, c.id]);
  assert.deepEqual(recentActivityIds(records, "noah"), [c.id, a.id, b.id]);
  assert.deepEqual(recentActivityIds(records, "emma", 1), [a.id]);
  assert.deepEqual(recentActivityIds([], "emma"), []);
});
