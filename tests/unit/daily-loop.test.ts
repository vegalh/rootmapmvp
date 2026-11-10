import { test } from "node:test";
import assert from "node:assert/strict";
import { activities } from "../../src/data/activities";
import { songs } from "../../src/data/music";
import { rememberEntries } from "../../src/lib/activityRecords";
import { dayHash } from "../../src/lib/memories";
import { REMINDER_OFF, noReminders, parseReminderTime } from "../../src/lib/platform/reminders";
import { AGAIN_DAYS, againIdea, childInterests, dayIdeas, doneOrPlannedToday, fewSongs, forAge, IDEA_KEY, lovedInterests, notTodayIds, routineForDay, routinePool, showAnother, shownIdea, todaysIdeas, type Routine } from "../../src/lib/todayIdeas";
import { SHARE_MOMENTS, shareMoments, shareNames } from "../../src/lib/shareWeek";
import { dailyLoopOnServer, nextRoutineAction, routineValue } from "../../src/lib/sync/dailyLoop";
import { clientRow, fromRow, setDailyColumns, toRow } from "../../src/lib/sync/mapping";
import type { Child, LessonRecord, Plan } from "../../src/types";

// The daily loop (Today's idea → Mark as Tried → a Moment → the weekly recap), lib/todayIdeas.ts and
// lib/activityRecords.ts.

const TODAY = "2026-11-10"; // a Tuesday
const tried = (id: string, activityId: string, date: string, fields: Partial<LessonRecord> = {}): LessonRecord => ({ id, childId: "a", lesson: activityId, kind: "tried", activityId, date, createdAt: `${date}T10:00:00.000Z`, ...fields });
const plan = (activityId: string, date: string, fields: Partial<Plan> = {}): Plan => ({ id: `p-${activityId}`, activityId, date, childIds: ["a"], ...fields });

test("Today's idea without a routine is the day's pick, as before", () => {
  const { ideas, routine, suited } = todaysIdeas({ records: [], plans: [], today: TODAY });
  assert.equal(routine, undefined);
  assert.equal(suited, false);
  assert.equal(ideas[0].id, activities[dayHash(TODAY, "activity:") % activities.length].id);
});

test("Today's idea skips an activity the child tried today or has planned today", () => {
  const first = todaysIdeas({ childId: "a", years: 4, records: [], plans: [], today: TODAY }).ideas[0];
  const afterTried = todaysIdeas({ childId: "a", years: 4, records: [tried("t1", first.id, TODAY)], plans: [], today: TODAY }).ideas;
  assert.notEqual(afterTried[0].id, first.id, "tried today");
  assert.ok(!afterTried.some(a => a.id === first.id));
  const afterPlanned = todaysIdeas({ childId: "a", years: 4, records: [], plans: [plan(first.id, TODAY)], today: TODAY }).ideas;
  assert.notEqual(afterPlanned[0].id, first.id, "planned today");
  // A completed plan for today counts too; it's in the child's day already.
  assert.notEqual(todaysIdeas({ childId: "a", years: 4, records: [], plans: [plan(first.id, TODAY, { completed: true })], today: TODAY }).ideas[0].id, first.id);
});

test("only today's records and plans, and only this child's, are skipped", () => {
  const first = todaysIdeas({ childId: "a", years: 4, records: [], plans: [], today: TODAY }).ideas[0];
  const other = { records: [tried("t1", first.id, "2026-11-09"), tried("t2", first.id, TODAY, { childId: "b" }), tried("t3", first.id, TODAY, { deletedAt: "2026-11-10T11:00:00.000Z" })], plans: [plan(first.id, "2026-11-11"), plan(first.id, TODAY, { childIds: ["b"] })] };
  assert.equal(todaysIdeas({ childId: "a", years: 4, ...other, today: TODAY }).ideas[0].id, first.id);
  assert.deepEqual([...doneOrPlannedToday(other.records, other.plans, "a", TODAY)], []);
});

test("an entry made from a tried record: same child and date, the activity's title, linked to the record", () => {
  const records = [tried("t-a", "water-pouring", "2026-11-09"), tried("t-b", "water-pouring", "2026-11-09", { childId: "b" })];
  let n = 0;
  const entries = rememberEntries(records, { title: "Pouring Water", text: "  She poured it all by herself.  ", photosFor: id => (id === "a" ? ["photo-a"] : ["photo-b"]) }, "2026-11-10T09:00:00.000Z", () => `m-${++n}`);
  assert.deepEqual(entries, [
    { id: "m-1", childId: "a", date: "2026-11-09", title: "Pouring Water", text: "She poured it all by herself.", photos: ["photo-a"], recordId: "t-a", createdAt: "2026-11-10T09:00:00.000Z", updatedAt: "2026-11-10T09:00:00.000Z" },
    { id: "m-2", childId: "b", date: "2026-11-09", title: "Pouring Water", text: "She poured it all by herself.", photos: ["photo-b"], recordId: "t-b", createdAt: "2026-11-10T09:00:00.000Z", updatedAt: "2026-11-10T09:00:00.000Z" },
  ]);
  // A photo alone is enough; words alone too; neither makes nothing.
  assert.equal(rememberEntries(records.slice(0, 1), { title: "x", text: " ", photosFor: () => ["p"] }, "now", () => "m")[0].text, undefined);
  assert.deepEqual(rememberEntries(records.slice(0, 1), { title: "x", text: "hi", photosFor: () => [] }, "now", () => "m")[0].photos, []);
  assert.deepEqual(rememberEntries(records, { title: "x", text: "", photosFor: () => [] }, "now", () => "m"), []);
});

// ── Part 2: ideas that fit the family's routine ──────────────────────────────────────────────────────────────

const SAT = "2026-11-14";
const SUN = "2026-11-15";

test("each routine's pool: cooking, after dinner, bath and bedtime (with songs), weekend mornings", () => {
  const cooking = routinePool("cooking");
  assert.ok(cooking.length > 0 && cooking.every(a => a.topic === "Food Preparation"));
  const dinner = routinePool("after-dinner");
  assert.ok(dinner.length > 0 && dinner.every(a => a.settings?.includes("home") && a.minutes <= 15 && a.topic !== "Food Preparation"));
  const bedtime = routinePool("bedtime");
  const calm = bedtime.filter(a => !a.id.startsWith("song-"));
  assert.ok(calm.length > 0 && calm.every(a => a.minutes <= 10 && a.domains.some(d => ["Concentration", "Self-Regulation", "Listening"].includes(d))));
  assert.equal(bedtime.filter(a => a.id.startsWith("song-")).length, songs.length, "every song");
  assert.equal(routinePool("weekend-morning").length, activities.length, "any activity, outdoor and longer ones included");
  assert.ok(routinePool("weekend-morning").some(a => a.minutes > 15));
});

test("the routine rotates by day; weekend mornings only on Saturday and Sunday", () => {
  assert.equal(routineForDay(null, TODAY), undefined, "not answered");
  assert.equal(routineForDay([], TODAY), undefined, "answered with none");
  assert.equal(routineForDay(["weekend-morning"], TODAY), undefined, "a Tuesday");
  assert.equal(routineForDay(["weekend-morning"], SAT), "weekend-morning");
  assert.equal(routineForDay(["cooking", "weekend-morning"], TODAY), "cooking", "weekdays: only the weekday ones");
  const two: Routine[] = ["cooking", "bedtime"];
  const days = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].map(d => routineForDay(two, d));
  assert.deepEqual(new Set(days), new Set(two), "both come up");
  for (let i = 1; i < days.length; i++) assert.notEqual(days[i], days[i - 1], "in turn, day by day");
  assert.equal(routineForDay(two, TODAY), routineForDay(["bedtime", "cooking"], TODAY), "the order chosen doesn't matter");
  const weekend = [SAT, SUN].map(d => routineForDay(["after-dinner", "weekend-morning"], d));
  assert.ok(weekend.includes("weekend-morning") && weekend.includes("after-dinner"));
});

test("Today's idea comes from the routine's pool for the child's age, and says so", () => {
  const r = todaysIdeas({ childId: "a", years: 4, routines: ["cooking"], records: [], plans: [], today: TODAY });
  assert.equal(r.routine, "cooking");
  assert.ok(r.ideas.length > 0 && r.ideas.every(a => a.topic === "Food Preparation"));
  assert.ok(r.ideas.every(a => forAge(routinePool("cooking"), 4).includes(a)), "for a 4-year-old");
  // The day's pick stays the same all day.
  assert.equal(todaysIdeas({ childId: "a", years: 4, routines: ["cooking"], records: [], plans: [], today: TODAY }).ideas[0].id, r.ideas[0].id);
});

test("a routine with nothing for the child's age falls back to Today's Inspiration as before", () => {
  // Cooking has nothing for a 3-month-old.
  assert.equal(forAge(routinePool("cooking"), 0.25).length, 0);
  const baby = todaysIdeas({ childId: "a", years: 0.25, routines: ["cooking"], records: [], plans: [], today: TODAY });
  const before = todaysIdeas({ childId: "a", years: 0.25, records: [], plans: [], today: TODAY });
  assert.equal(baby.routine, undefined);
  assert.deepEqual(baby.ideas.map(a => a.id), before.ideas.map(a => a.id));
  // Weekend mornings on a weekday: no routine today.
  assert.equal(todaysIdeas({ childId: "a", years: 4, routines: ["weekend-morning"], records: [], plans: [], today: TODAY }).routine, undefined);
});

// ── Part 3: "Show me another" ───────────────────────────────────────────────────────────────────────────────
test("Show me another: up to 3 ideas from the pool, the day's pick first, then ones needing nothing or everyday things", () => {
  const pool = routinePool("after-dinner");
  const ideas = dayIdeas(pool, new Set(), TODAY, "activity:a");
  assert.equal(ideas.length, 3);
  assert.equal(new Set(ideas.map(a => a.id)).size, 3, "no repeats");
  assert.equal(ideas[0].id, pool[dayHash(TODAY, "activity:a") % pool.length].id);
  const easyLeft = pool.filter(a => a.id !== ideas[0].id && (a.materialType === "none" || a.materialType === "everyday")).length;
  if (easyLeft >= 2) assert.ok(ideas.slice(1).every(a => a.materialType === "none" || a.materialType === "everyday"));
  assert.equal(dayIdeas(pool.slice(0, 2), new Set(), TODAY, "x").length, 2, "fewer when the pool is small");
  assert.deepEqual(dayIdeas([], new Set(), TODAY, "x"), []);
});

test("Show me another cycles to the third idea, stays there, and starts again tomorrow", () => {
  assert.equal(IDEA_KEY, "rootmap-today-idea");
  let choice = null as ReturnType<typeof showAnother> | null;
  assert.equal(shownIdea(choice, "a", TODAY, 3), 0);
  choice = showAnother(choice, "a", TODAY, 3);
  assert.equal(shownIdea(choice, "a", TODAY, 3), 1);
  choice = showAnother(choice, "a", TODAY, 3);
  assert.equal(shownIdea(choice, "a", TODAY, 3), 2);
  choice = showAnother(choice, "a", TODAY, 3);
  assert.equal(shownIdea(choice, "a", TODAY, 3), 2, "the third is the last");
  assert.equal(shownIdea(choice, "b", TODAY, 3), 0, "each child has their own");
  assert.equal(shownIdea(choice, "a", "2026-11-11", 3), 0, "tomorrow starts again");
  assert.deepEqual(showAnother(choice, "a", "2026-11-11", 3), { date: "2026-11-11", shown: { a: 1 } }, "yesterday's choices are dropped");
  assert.equal(shownIdea(choice, "a", TODAY, 2), 1, "never past the ideas there are");
});

// ── Part 4: "Did they enjoy it?" ─────────────────────────────────────────────────────────────────────────────
const daysAgo = (n: number) => { const d = new Date(`${TODAY}T12:00:00`); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

test("Again?: loved 3 to 14 days ago and not done since", () => {
  assert.deepEqual(AGAIN_DAYS, { from: 3, to: 14 });
  const loved = (days: number, id = "water-pouring") => tried(`t${days}`, id, daysAgo(days), { enjoyed: "loved" });
  assert.equal(againIdea([loved(2)], "a", TODAY), undefined, "2 days: too soon");
  assert.equal(againIdea([loved(3)], "a", TODAY)?.days, 3);
  assert.equal(againIdea([loved(14)], "a", TODAY)?.days, 14);
  assert.equal(againIdea([loved(15)], "a", TODAY), undefined, "15 days: too long ago");
  assert.equal(againIdea([tried("t5", "water-pouring", daysAgo(5))], "a", TODAY), undefined, "tried, not loved");
  assert.equal(againIdea([tried("t5", "water-pouring", daysAgo(5), { enjoyed: "not-today" })], "a", TODAY), undefined);
  assert.equal(againIdea([loved(6), tried("t2", "water-pouring", daysAgo(2))], "a", TODAY), undefined, "done again since");
  assert.equal(againIdea([loved(6), tried("t0", "water-pouring", TODAY)], "a", TODAY), undefined, "done again today");
  assert.equal(againIdea([loved(6), tried("t9", "water-pouring", daysAgo(9))], "a", TODAY)?.days, 6, "an earlier try doesn't count");
  assert.equal(againIdea([loved(6, "dotting"), loved(4)], "a", TODAY)?.record.activityId, "water-pouring", "the most recent one: one card");
  assert.equal(againIdea([loved(6, "dotting"), loved(4)], "a", TODAY, new Set(["water-pouring"]))?.record.activityId, "dotting", "not today's idea");
  assert.equal(againIdea([loved(6)], "b", TODAY), undefined, "another child's");
  assert.equal(againIdea([{ ...loved(6), deletedAt: "2026-11-09T10:00:00.000Z" }], "a", TODAY), undefined, "a deleted record");
  assert.equal(againIdea([loved(6, "no-such-activity")], "a", TODAY), undefined, "no longer in the catalog");
});

test("Not today keeps an activity out of the child's idea for 14 days, never anyone else's", () => {
  const nope = (days: number) => tried(`n${days}`, "water-pouring", daysAgo(days), { enjoyed: "not-today" });
  assert.deepEqual([...notTodayIds([nope(0)], "a", TODAY)], ["water-pouring"], "marked today");
  assert.deepEqual([...notTodayIds([nope(13)], "a", TODAY)], ["water-pouring"], "the 14th day");
  assert.deepEqual([...notTodayIds([nope(14)], "a", TODAY)], [], "back after 14 days");
  assert.deepEqual([...notTodayIds([nope(3)], "b", TODAY)], [], "another child");
  assert.deepEqual([...notTodayIds([tried("t", "water-pouring", daysAgo(3), { enjoyed: "loved" })], "a", TODAY)], []);
  // In Today's idea: the day's pick, marked "Not today" yesterday, is skipped.
  const first = todaysIdeas({ childId: "a", years: 4, records: [], plans: [], today: TODAY }).ideas[0];
  const without = todaysIdeas({ childId: "a", years: 4, records: [tried("n", first.id, daysAgo(1), { enjoyed: "not-today" })], plans: [], today: TODAY }).ideas;
  assert.ok(!without.some(a => a.id === first.id));
  const later = todaysIdeas({ childId: "a", years: 4, records: [tried("n", first.id, daysAgo(14), { enjoyed: "not-today" })], plans: [], today: "2026-11-10" }).ideas;
  assert.equal(later[0].id, first.id, "after 14 days it can come back");
});

test("interests from loved activities: up to 3, most loved first; the child's own interests win", () => {
  const loved = (id: string, activityId: string, date: string) => tried(id, activityId, date, { enjoyed: "loved" });
  const food = activities.filter(a => a.topic === "Food Preparation").map(a => a.id);
  const nature = activities.filter(a => a.topic === "Nature").map(a => a.id);
  const senses = activities.filter(a => a.topic === "Sensory Exploration").map(a => a.id);
  const lang = activities.filter(a => a.topic === "Language Development").map(a => a.id);
  const records = [
    loved("1", food[0], "2026-11-01"), loved("2", food[1], "2026-11-02"),
    loved("3", nature[0], "2026-11-03"),
    loved("4", senses[0], "2026-11-05"),
    loved("5", lang[0], "2026-11-04"),
    tried("6", lang[1], "2026-11-06"), tried("7", lang[2], "2026-11-06", { enjoyed: "not-today" }),
  ];
  assert.deepEqual(lovedInterests(records, "a"), ["cooking", "senses", "words"], "cooking twice; then the most recent");
  assert.deepEqual(lovedInterests(records, "b"), [], "nothing loved");
  assert.deepEqual(lovedInterests([loved("s", songs[0].id, "2026-11-01")], "a"), ["music"], "music by its category");
  assert.deepEqual(childInterests({ id: "a", interests: ["Trains"] }, records), { own: ["Trains"] });
  assert.deepEqual(childInterests({ id: "a", interests: [] }, records), { derived: ["cooking", "senses", "words"] });
});

test("bedtime: the calm activities with a few songs, not all 50", () => {
  const pool = forAge(routinePool("bedtime"), 4);
  const mixed = fewSongs(pool, TODAY, "s");
  const calm = pool.filter(a => !a.id.startsWith("song-"));
  assert.ok(calm.length > 0);
  assert.ok(calm.every(a => mixed.includes(a)), "every calm activity");
  const songCount = mixed.length - calm.length;
  assert.ok(songCount >= 2 && songCount <= Math.max(2, Math.ceil(calm.length / 3)));
  assert.notDeepEqual(mixed.slice(calm.length).map(a => a.id), fewSongs(pool, "2026-11-11", "s").slice(calm.length).map(a => a.id), "different songs another day");
  assert.equal(fewSongs(pool.filter(a => a.id.startsWith("song-")), TODAY, "s").length, songs.length, "only songs: all of them");
});

// ── Part 5: one gentle reminder a day (iOS app only) ─────────────────────────────────────────────────────────

test("the reminder: off by default at 17:30, a valid time kept, the website has none", async () => {
  assert.deepEqual(REMINDER_OFF, { on: false, time: "17:30" });
  assert.deepEqual(parseReminderTime("17:30"), { hour: 17, minute: 30 });
  assert.deepEqual(parseReminderTime("07:05"), { hour: 7, minute: 5 });
  assert.deepEqual(parseReminderTime("24:00"), { hour: 17, minute: 30 }, "not a time → the default");
  assert.deepEqual(parseReminderTime(undefined), { hour: 17, minute: 30 });
  assert.equal(noReminders.available, false);
  assert.equal(await noReminders.enable({ hour: 17, minute: 30 }, { title: "", body: "" }), "failed", "nothing to turn on, no permission asked");
});

// ── Part 6: share the weekly summary ────────────────────────────────────────────────────────────────────────
test("the share picture: up to 6 moments, a photo when there is one and the first line of words; first names only", () => {
  const e = (id: string, date: string, fields: Record<string, unknown> = {}) => ({ id, childId: "a", date, photos: [] as string[], createdAt: `${date}T10:00:00.000Z`, updatedAt: `${date}T10:00:00.000Z`, ...fields });
  const week = [
    e("1", "2026-11-09", { text: "First line\nsecond line", photos: ["p1", "p2"] }),
    e("2", "2026-11-09", { title: "Only a title" }),
    e("3", "2026-11-10", { text: "  \n  Line after blanks" }),
    e("4", "2026-11-10", { photos: ["hidden"] }),
    e("5", "2026-11-11", { text: "five" }), e("6", "2026-11-11", { text: "six" }), e("7", "2026-11-12", { text: "seven", photos: ["p7"] }),
  ];
  const shown = shareMoments(week, "en", p => p !== "hidden");
  assert.equal(shown.length, SHARE_MOMENTS);
  assert.deepEqual(shown[0], { photo: "p1", line: "First line" });
  assert.ok(shown.some(m => m.line === "Only a title" && !m.photo));
  assert.ok(shown.some(m => m.line === "Line after blanks"));
  assert.ok(shown.some(m => m.photo === "p7"), "the fullest ones are kept");
  assert.ok(!shown.some(m => m.photo === "hidden"));
  const kids = [{ id: "a", first: "Ada", last: "Lin", dob: "2022-03-01" }, { id: "b", first: "Ben", last: "Lin", dob: "2024-01-01" }, { id: "c", first: "Cy", last: "Lin", dob: "2020-01-01" }] as Child[];
  assert.equal(shareNames(["b", "a"], kids, ", "), "Ada, Ben", "family order, first names, no ages or last names");
});

// ── Sync: the daily loop's shared data (lib/sync/dailyLoop.ts, mapping.ts) ──────────────────────────────────
test("new columns go to the server only once it has them; a row without them never erases the device's value", () => {
  const record = { id: "t-1", childId: "a", lesson: "Pouring", date: "2026-11-09", kind: "tried", activityId: "water-pouring", enjoyed: "loved" };
  const entry = { id: "m-1", childId: "a", date: "2026-11-09", photos: [], recordId: "t-1" };
  setDailyColumns(false);
  assert.equal("enjoyed" in toRow("records", record, { userId: "u" }), false, "an older server never receives it");
  assert.equal("record_id" in toRow("entries", entry, { userId: "u" }), false);
  assert.equal("enjoyed" in clientRow("records", { enjoyed: "loved" }), false);
  // A row from a server without the column keeps what the device has.
  const back = fromRow("records", toRow("records", record, { userId: "u" }), record);
  assert.equal(back.enjoyed, "loved");
  setDailyColumns(true);
  try {
    assert.equal(toRow("records", record, { userId: "u" }).enjoyed, "loved");
    assert.equal(toRow("records", { ...record, enjoyed: undefined }, { userId: "u" }).enjoyed, null);
    assert.equal(toRow("records", { ...record, enjoyed: "meh" }, { userId: "u" }).enjoyed, null, "only the two answers");
    assert.equal(toRow("entries", entry, { userId: "u" }).record_id, "t-1");
    assert.equal(clientRow("entries", { record_id: "t-1" }).record_id, "t-1");
    // The server's answer wins, including "no answer".
    assert.equal(fromRow("records", { ...toRow("records", record, { userId: "u" }), enjoyed: null }, record).enjoyed, undefined);
    assert.equal(fromRow("entries", { ...toRow("entries", entry, { userId: "u" }), record_id: "t-9" }, entry).recordId, "t-9");
  } finally {
    setDailyColumns(false);
  }
});

test("whether the server has the daily loop: a missing table means no; other errors are retried", async () => {
  const client = (error: unknown) => ({ from: () => ({ select: () => ({ limit: async () => ({ error }) }) }) }) as never;
  assert.equal(await dailyLoopOnServer(client(null)), true);
  assert.equal(await dailyLoopOnServer(client({ code: "PGRST205" })), false);
  assert.equal(await dailyLoopOnServer(client({ code: "42P01" })), false);
  await assert.rejects(dailyLoopOnServer(client({ code: "", message: "Failed to fetch" })));
});

test("Our routine across the family's devices: adopt what changed on the server, else send this device's change", () => {
  const v = (routines: string[], at: string) => ({ routines, answeredAt: at });
  const a = v(["cooking"], "1"), b = v(["bedtime"], "2");
  assert.deepEqual(nextRoutineAction(null, null, null), { kind: "none" }, "nobody has answered");
  assert.deepEqual(nextRoutineAction(null, null, a), { kind: "push", value: a }, "first answer");
  assert.deepEqual(nextRoutineAction(a, null, null), { kind: "adopt", value: a }, "a new device takes the family's answer");
  assert.deepEqual(nextRoutineAction(a, null, b), { kind: "adopt", value: a }, "first sync of a device: the family's answer wins");
  assert.deepEqual(nextRoutineAction(a, a, b), { kind: "push", value: b }, "only this device changed");
  assert.deepEqual(nextRoutineAction(b, a, v(["after-dinner"], "3")), { kind: "adopt", value: b }, "both changed: the server's (first) wins");
  assert.deepEqual(nextRoutineAction(a, a, a), { kind: "none" });
  assert.equal(routineValue({ routines: [] }), null, "unanswered");
  assert.deepEqual(routineValue({ routines: ["bedtime", "cooking"], answeredAt: "x" }), { routines: ["cooking", "bedtime"], answeredAt: "x" }, "usual order");
});
