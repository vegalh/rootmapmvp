import { test } from "node:test";
import assert from "node:assert/strict";
import { buildActivityRecord, planCompletionRecords } from "../../src/lib/activityRecords";
import { activityAgeRanges, ageOptionsFor, ageRangeForYears, spanAgeRanges } from "../../src/lib/catalog";
import { childOptionLabel, childShortName, defaultChildId, isActiveChild } from "../../src/lib/children";
import { localIsoDate, localIsoToday } from "../../src/lib/dates";
import { EMPTY_DEFAULTS, NO_DEMO_KEY, defaults, defaultsFor } from "../../src/lib/data/store";
import { buildFromLegacy } from "../../src/lib/data/legacy";
import { formatRoute, parseRoute, type Route } from "../../src/lib/routes";
import { activities } from "../../src/data/activities";
import { copy } from "../../src/lib/i18n";
import type { Child, LessonRecord, Plan } from "../../src/types";

// Regression tests for the product-testing fixes: which child a record belongs to, demo data for new families,
// local dates, overlapping age filters, page addresses, and completing a planned activity.

const en = copy.en;
const kid = (id: string, first: string, last = "", dob = "2023-01-01"): Child => ({ id, first, last, dob, enrolled: "", lessons: 0, group: "", photo: "" });
const NOW = "2026-10-13T08:00:00.000Z";

test("children: a deleted or unknown child can never receive a new record", () => {
  const active = ["c-1"];
  assert.deepEqual(buildActivityRecord({ childId: "c-deleted", date: "2026-10-13", activityId: "dotting" }, "r", NOW, active), { problem: "child" });
  assert.deepEqual(buildActivityRecord({ childId: "", date: "2026-10-13", activityId: "dotting" }, "r", NOW, active), { problem: "child" });
  const ok = buildActivityRecord({ childId: "c-1", date: "2026-10-13", activityId: "dotting" }, "r", NOW, active);
  assert.ok("record" in ok && ok.record.childId === "c-1");
});

test("children: one child is chosen automatically, several need an explicit choice, a removed one is never preselected", () => {
  const one = [kid("a", "Mia")];
  const two = [kid("a", "Mia"), kid("b", "Leo")];
  assert.equal(defaultChildId(one), "a");
  assert.equal(defaultChildId(two), "");
  assert.equal(defaultChildId(two, "b"), "b");
  assert.equal(defaultChildId(two, "gone"), "");
  assert.equal(defaultChildId([], "a"), "");
  assert.ok(isActiveChild(two, "a"));
  assert.ok(!isActiveChild(two, "gone"));
});

test("children: two children with the same name can be told apart", () => {
  const twins = [kid("a", "Mia", "Chen", "2021-03-01"), kid("b", "Mia", "Chen", "2023-06-01"), kid("c", "Mia", "Wong")];
  assert.notEqual(childOptionLabel(twins[0], twins, en), childOptionLabel(twins[1], twins, en));
  assert.equal(childOptionLabel(twins[2], twins, en), "Mia Wong");
  assert.equal(childShortName(twins[2], twins), "Mia W.");
  assert.equal(childShortName(kid("d", "Leo"), [kid("d", "Leo")]), "Leo");
});

test("demo data: a new device starts empty; a device that already used RootMap keeps what it always showed", () => {
  assert.equal(defaultsFor({}), EMPTY_DEFAULTS);
  assert.equal(defaultsFor({ "rootmap-language": "zh" }), EMPTY_DEFAULTS, "a language choice alone isn't earlier use");
  assert.equal(defaultsFor({ [NO_DEMO_KEY]: true, "rootmap-children": [] }), EMPTY_DEFAULTS, "a new family stays without demo data");
  assert.equal(defaultsFor({ "rootmap-seed-version": 3 }), defaults);
  assert.equal(defaultsFor({ "rootmap-journal": [] }), defaults);

  const opts = { now: NOW, extractPhotos: false, newPhotoId: () => "photo-x", photoSource: "upload" as const };
  const fresh = buildFromLegacy({ values: {}, unplaced: [] }, { ...opts, defaults: defaultsFor({}) });
  assert.equal(fresh.collections.children.length, 0, "no Maya or Leo");
  assert.equal(fresh.collections.records.length, 0, "no demo records");
  assert.equal(fresh.collections.observations.length, 0, "no demo Moments");
  assert.equal(fresh.collections.saved.length, 0, "no demo favorites");

  // An existing device keeps its own records and the demo family it was already showing.
  const values = { "rootmap-seed-version": 3, "rootmap-records": [{ id: "r-1760000000000", childId: "emma", lesson: "Mine", date: "2026-10-01" }] };
  const existing = buildFromLegacy({ values, unplaced: [] }, { ...opts, defaults: defaultsFor(values) });
  assert.deepEqual(existing.collections.children.map(c => c.id), ["emma", "noah"]);
  assert.deepEqual(existing.collections.records.map(r => r.id), ["r-1760000000000"]);
});

test("dates: 'today' is the local calendar date in any time zone, never the UTC one", () => {
  // 23:30 on Oct 12 in Los Angeles is already Oct 13 in UTC; 00:30 on Oct 13 in Shanghai is still Oct 12 in UTC.
  const cases: [string, string][] = [["America/Los_Angeles", "2026-10-13T06:30:00Z"], ["Asia/Shanghai", "2026-10-12T16:30:00Z"], ["Pacific/Auckland", "2026-10-12T11:30:00Z"]];
  for (const [tz, instant] of cases) {
    const wall = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
    // localIsoDate reads the date the way the device's clock shows it; emulate that device's local fields.
    const shifted = new Date(new Date(instant).toLocaleString("en-US", { timeZone: tz }));
    assert.equal(localIsoDate(shifted), wall, tz);
    // The old UTC-based date would have been a day off at exactly these moments.
    assert.notEqual(new Date(instant).toISOString().slice(0, 10), wall, `${tz}: UTC date differs`);
  }
  assert.match(localIsoToday(), /^\d{4}-\d{2}-\d{2}$/);
  const d = new Date();
  assert.equal(localIsoToday(), `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
});

test("age filters: overlapping ranges, and only filters that have activities", () => {
  assert.deepEqual(spanAgeRanges(1, 3), ["0–2", "2–3"]);
  const reading = activities.find(a => a.id === "reading-about-myself")!; // ages 1–3
  assert.ok(activityAgeRanges(reading).includes("0–2"), "1–3 shows under 0–2");
  assert.ok(activityAgeRanges(reading).includes("2–3"));
  const juicing = activities.find(a => a.id === "orange-juicing")!; // ages 3–5
  assert.deepEqual(activityAgeRanges(juicing), ["3–4", "4–6"]);
  assert.deepEqual(activityAgeRanges({ age: "4+ years", ageKey: "4–6" }), ["4–6", "6+"]);
  const offered = ageOptionsFor(activities.map(activityAgeRanges));
  for (const range of offered.slice(1)) assert.ok(activities.some(a => activityAgeRanges(a).includes(range as never)), range);
  assert.ok(!offered.includes("6+"), "no activity for 6+, so no 6+ filter");
  assert.equal(ageRangeForYears(1.5), "0–2");
  assert.equal(ageRangeForYears(3.2), "3–4");
});

test("My Week: completing a plan records it for each planned child once, never for a removed child", () => {
  const plan: Plan = { id: "p-1", activityId: "dotting", date: "2026-10-12", childIds: ["a", "b", "gone"] };
  let n = 0;
  const id = () => `t-${++n}`;
  const first = planCompletionRecords(plan, [], ["a", "b"], "2026-10-13", NOW, id);
  assert.deepEqual(first.map(r => [r.childId, r.activityId, r.date, r.planId, r.kind]), [["a", "dotting", "2026-10-13", "p-1", "tried"], ["b", "dotting", "2026-10-13", "p-1", "tried"]]);
  // A second completion (double tap, or a retry) adds nothing.
  assert.deepEqual(planCompletionRecords(plan, first, ["a", "b"], "2026-10-13", NOW, id), []);
  // A deleted record doesn't block, an existing one for one child only adds the other.
  const records: LessonRecord[] = [{ ...first[0] }, { ...first[1], deletedAt: NOW }];
  assert.deepEqual(planCompletionRecords(plan, records, ["a", "b"], "2026-10-13", NOW, id).map(r => r.childId), ["b"]);
});

test("routes: every page has an address that opens it again; unknown addresses open nothing", () => {
  const routes: Route[] = [
    { screen: "today" }, { screen: "children" }, { screen: "profile" }, { screen: "week" }, { screen: "observations" },
    { screen: "discover", discoverTab: "activities" }, { screen: "discover", discoverTab: "books" }, { screen: "discover", discoverTab: "music" },
    { screen: "activity", activity: "water-pouring" }, { screen: "music", activity: "music-freeze-dance" }, { screen: "book", book: "guess-how-much" },
    { screen: "child", child: "c-1", childTab: "Journal" }, { screen: "child", child: "c-1", childTab: "Activities" },
    { screen: "entry", entry: "m-1" }, { screen: "entryEdit", entry: "m-1" }, { screen: "entryEdit", child: "c-1" }, { screen: "record", child: "c-1" }, { screen: "record" },
    { screen: "deletedChildren" }, { screen: "notificationPrefs" },
  ];
  for (const r of routes) {
    const hash = formatRoute(r);
    assert.ok(hash.startsWith("#/"), hash);
    const back = parseRoute(hash)!;
    for (const [k, v] of Object.entries(r)) assert.equal((back as Record<string, unknown>)[k], v, `${hash} ${k}`);
  }
  assert.equal(formatRoute({ screen: "activity", activity: "a b/c" }), "#/activity/a%20b%2Fc");
  assert.equal(parseRoute("#/activity/a%20b%2Fc")!.activity, "a b/c");
  assert.equal(parseRoute(""), null);
  assert.equal(parseRoute("#/no-such-page"), null);
});
