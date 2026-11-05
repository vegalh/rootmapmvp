import { test } from "node:test";
import assert from "node:assert/strict";
import { songs } from "../../src/data/music.ts";
import { activities } from "../../src/data/activities.ts";
import { ageTagLabel, findActivity, materialsTag, materialsTagLabel } from "../../src/lib/catalog.ts";
import { lastTriedLine } from "../../src/lib/activityRecords.ts";
import { plannedNote, plansTriedBy, todaysPlans } from "../../src/lib/plans.ts";
import { localIsoToday } from "../../src/lib/dates.ts";
import { copy } from "../../src/lib/i18n.ts";
import type { LessonRecord, Plan } from "../../src/types.ts";

const en = copy.en, zh = copy.zh;
const year = localIsoToday().slice(0, 4);
const nov4 = `${year}-11-04`;
const plan = (p: Partial<Plan> & Pick<Plan, "id">): Plan => ({ activityId: "i-spy-a-color", date: nov4, childIds: ["emma"], ...p });

test("songs: for every age RootMap is for (0–2, 2–3, 3–6), shown as 0–6 on the card", () => {
  for (const m of songs) assert.deepEqual(m.ageRanges, ["0–2", "2–3", "3–6"], m.id);
  assert.equal(ageTagLabel(findActivity("song-1")!, "en"), "0–6 yrs");
  assert.equal(ageTagLabel(findActivity("song-1")!, "zh"), "0–6岁");
});

test("today's plan: only today's, not completed, with an activity still in the catalog, filtered by child", () => {
  const plans = [
    plan({ id: "a", childIds: ["emma", "ben"] }),
    plan({ id: "b", childIds: ["ben"] }),
    plan({ id: "done", completed: true, completedDate: nov4 }),
    plan({ id: "tomorrow", date: `${year}-11-05` }),
    plan({ id: "yesterday", date: `${year}-11-03` }),
    plan({ id: "gone", activityId: "no-such-activity" }),
  ];
  assert.deepEqual(todaysPlans(plans, nov4).map(p => p.id), ["a", "b"]);
  assert.deepEqual(todaysPlans(plans, nov4, "emma").map(p => p.id), ["a"]);
  assert.deepEqual(todaysPlans(plans, nov4, "ben").map(p => p.id), ["a", "b"]);
  assert.deepEqual(todaysPlans(plans, nov4, "nobody"), []);
  assert.deepEqual(todaysPlans([], nov4), [], "no plans: the page is unchanged");
});

test("mark as tried: Notes starts with the note of an open plan for that activity, date and child", () => {
  const plans = [
    plan({ id: "a", note: "  Use the red cups.  " }),
    plan({ id: "other-activity", activityId: "mopping", note: "Small mop" }),
    plan({ id: "done", childIds: ["ben"], note: "Already done", completed: true }),
  ];
  assert.equal(plannedNote(plans, "i-spy-a-color", ["emma"], nov4), "Use the red cups.");
  assert.equal(plannedNote(plans, "i-spy-a-color", ["emma", "ben"], nov4), "Use the red cups.");
  assert.equal(plannedNote(plans, "i-spy-a-color", ["ben"], nov4), "", "a completed plan doesn't count");
  assert.equal(plannedNote(plans, "i-spy-a-color", ["emma"], `${year}-11-05`), "", "another day");
  assert.equal(plannedNote(plans, "cutting-bananas", ["emma"], nov4), "", "another activity");
  assert.equal(plannedNote([plan({ id: "x" })], "i-spy-a-color", ["emma"], nov4), "", "a plan without a note");
  // Saving completes the matching open plans, and only those.
  assert.deepEqual(plansTriedBy(plans, "i-spy-a-color", ["emma"], nov4).map(p => p.id), ["a"]);
  assert.deepEqual(plansTriedBy(plans, "i-spy-a-color", ["ben"], nov4), []);
});

test("materials tag: Nothing needed, At home or Needs prep on every card, never a count", () => {
  const byId = (id: string) => activities.find(a => a.id === id)!;
  assert.equal(materialsTag({ id: "x", materialType: "none" }), "none");
  assert.equal(materialsTag({ id: "x", materialType: "everyday" }), "everyday");
  assert.equal(materialsTag({ id: "x" }), "prep");
  assert.equal(materialsTagLabel(byId("i-spy-a-color"), en), "Nothing needed");
  assert.equal(materialsTagLabel(byId("i-spy-a-color"), zh), "无需材料");
  assert.equal(materialsTagLabel(byId("mopping"), en), "At home");
  assert.equal(materialsTagLabel(byId("mopping"), zh), "家里就有");
  assert.equal(materialsTagLabel(byId("cutting-bananas"), en), "Needs prep");
  assert.equal(materialsTagLabel(byId("cutting-bananas"), zh), "需要准备");
  assert.equal(materialsTagLabel(findActivity("song-1")!, en), "Nothing needed", "a song only needs a voice");
  const everyday = ["mopping", "sweeping", "dotting", "water-pouring", "orange-juicing", "lemon-squeezing", "egg-peeling-cutting", "grinding-spices", "flower-arranging", "peaceful-spot", "finger-painting-stamping", "painting-corn", "snipping-paper", "pinecone-rolling-painting"];
  for (const id of everyday) assert.equal(byId(id).materialType, "everyday", id);
  const prep = ["reading-about-myself", "cleaning-chalkboard", "cutting-celery", "pouring-stars", "matching-color-caps", "threading-paper-fish", "olive-fingers", "cooking-eggs", "ironing-cloths", "fall-gluing", "cutting-pickles", "leaf-matching", "cutting-bananas"];
  for (const id of prep) assert.equal(materialsTag(byId(id)), "prep", id);
  for (const a of activities) assert.doesNotMatch(materialsTagLabel(a, en), /\d|materials/i, a.id);
});

test("kids: the child card's Last tried line comes from that child's most recent record", () => {
  const records: LessonRecord[] = [
    { id: "t1", childId: "emma", kind: "tried", activityId: "mopping", lesson: "Mopping", date: `${year}-10-30` },
    { id: "t2", childId: "emma", kind: "tried", activityId: "i-spy-a-color", lesson: "I Spy a Color", date: nov4 },
    { id: "t3", childId: "ben", kind: "tried", activityId: "sweeping", lesson: "Sweeping", date: `${year}-11-05` },
    { id: "t4", childId: "emma", kind: "tried", activityId: "sweeping", lesson: "Sweeping", date: `${year}-11-06`, deletedAt: "2026-11-06T10:00:00.000Z" },
  ];
  assert.equal(lastTriedLine(records, "emma", en), "I Spy a Color · Nov 4");
  assert.equal(lastTriedLine(records, "emma", zh), "我发现一种颜色 · 11月4日");
  assert.equal(lastTriedLine(records, "ben", en), "Sweeping · Nov 5");
  assert.equal(lastTriedLine(records, "lily", en), undefined, "nothing tried yet: no line");
  assert.equal(en.lastTriedLabel, "Last tried:");
  assert.equal(zh.lastTriedLabel, "最近尝试：");
});
