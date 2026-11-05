import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activities } from "../../src/data/activities.ts";
import { ALONE, DIRECT_AIM, infantActivities } from "../../src/data/infantActivities.ts";
import { DEFAULT_DISCOVER_FILTERS, ageTagLabel, durationLabel, filterDiscoverActivities, findActivity, materialsTag, suitsAge, timeBand } from "../../src/lib/catalog.ts";
import { copy, localizeActivity } from "../../src/lib/i18n.ts";

const byId = (id: string) => findActivity(id)!;

test("0–12 months: all 51, unique ids, in the one catalog", () => {
  assert.equal(infantActivities.length, 51);
  const ids = activities.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length, "no id used twice");
  for (const a of infantActivities) assert.equal(findActivity(a.id), a, a.id);
});

test("0–12 months: the shared content rules hold for every activity", () => {
  for (const a of infantActivities) {
    assert.equal(a.directAim, DIRECT_AIM, a.id);
    assert.ok(a.safety?.startsWith(ALONE.slice(0, -1)), `${a.id}: safety starts with the universal line`);
    assert.ok(a.indirectAim && a.picturePrompt && a.extensions?.length, a.id);
    for (const s of a.steps) assert.doesNotMatch(s, /\byou(r)?\b/i, `${a.id}: ${s}`);
    assert.doesNotMatch(JSON.stringify(a), /gymboree|金宝贝/i, a.id);
    if (/choking rule/.test(a.safety!)) assert.match(a.safety!, /toilet-paper tube/, `${a.id}: the choking rule is spelled out`);
  }
});

test("0–12 months: English and Chinese for every shown field", () => {
  for (const a of infantActivities) {
    const zh = a.zh!;
    assert.ok(zh.title && zh.description && zh.safety && zh.indirectAim && zh.directAim, a.id);
    assert.equal(zh.steps!.length, a.steps.length, `${a.id}: steps`);
    assert.equal(zh.extensions!.length, a.extensions!.length, `${a.id}: extensions`);
    assert.equal(zh.domains!.length, a.domains.length, `${a.id}: domains`);
    assert.equal(zh.materials!.length, a.materials.length, `${a.id}: materials`);
    assert.equal(!!zh.preparation, !!a.preparation, `${a.id}: preparation`);
    const shown = localizeActivity(a, copy.zh);
    assert.equal(shown.title, zh.title);
    assert.deepEqual(shown.extensions, zh.extensions);
  }
  assert.equal(byId("high-contrast-cards").zh?.title, "黑白卡片");
  assert.equal(byId("barefoot-textures").zh?.title, "光脚踩踩");
});

test("0–12 months: the picture prompt is stored but never shown", () => {
  assert.match(byId("high-contrast-cards").picturePrompt!, /^Overhead shot of a newborn/);
  for (const page of ["src/pages/ActivityDetailPage.tsx", "src/pages/DiscoverPage.tsx", "src/pages/TodayPage.tsx", "src/pages/MyWeekPage.tsx"]) {
    assert.doesNotMatch(readFileSync(page, "utf8"), /picturePrompt/, page);
  }
});

test("0–12 months: ages in months, durations as ranges, both languages", () => {
  const cards = byId("high-contrast-cards");
  assert.equal(cards.age, "0–3 months");
  assert.equal(ageTagLabel(cards, "en"), "0–3 mo");
  assert.equal(ageTagLabel(cards, "zh"), "0–3个月");
  assert.equal(durationLabel(cards, "en"), "2–5 min");
  assert.equal(durationLabel(cards, "zh"), "2–5分钟");
  assert.equal(durationLabel(byId("treasure-basket"), "en"), "10–20 min");
  assert.equal(durationLabel(byId("mopping"), "en"), "15 min", "a single length is unchanged");
  assert.equal(ageTagLabel(byId("mopping"), "en"), "2–3 yrs", "ages in years are unchanged");
});

test("0–12 months: Discover's filters (age, setting, materials) and the time band", () => {
  const list = (f: Partial<typeof DEFAULT_DISCOVER_FILTERS>) => filterDiscoverActivities(activities, { ...DEFAULT_DISCOVER_FILTERS, ...f }).map(a => a.id);
  const baby = list({ age: "0–2" });
  for (const a of infantActivities) assert.ok(baby.includes(a.id), `${a.id} under 0–2`);
  assert.ok(!list({ age: "2–3" }).includes("high-contrast-cards"), "not under 2–3");
  assert.ok(list({ age: "0–2", materials: "none" }).includes("naming-touch"));
  assert.ok(list({ age: "0–2", materials: "everyday" }).includes("treasure-basket"));
  assert.ok(!list({ materials: "everyday" }).includes("sound-bottles"), "prepared materials: All only");
  assert.equal(materialsTag(byId("sound-bottles")), "prep");
  assert.ok(list({ setting: "park" }).includes("leaf-and-bark-touch"));
  assert.ok(list({ q: "黑白" }).includes("high-contrast-cards"), "Chinese search");
  assert.ok(list({ q: "object permanence" }).includes("peekaboo"), "search by what it builds");
  assert.ok(list({ q: "baby" }).length >= 51, "search for baby");
  assert.equal(timeBand(byId("treasure-basket").minutes), "over15", "the longest session counts");
});

test("0–12 months: a baby's own age picks the activities that suit it", () => {
  const fourMonths = 4 / 12, tenMonths = 10 / 12;
  assert.ok(suitsAge(byId("something-to-grasp"), fourMonths), "3–6 months");
  assert.ok(!suitsAge(byId("posting-box"), fourMonths), "9–12 months is too old");
  assert.ok(suitsAge(byId("posting-box"), tenMonths));
  assert.ok(suitsAge(byId("floor-mirror"), tenMonths), "0–12 months");
  assert.ok(!suitsAge(byId("posting-box"), 1), "ends at 12 months");
  assert.ok(suitsAge(byId("mopping"), 2.5), "years unchanged");
});
