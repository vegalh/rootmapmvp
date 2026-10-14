import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, firstRecapWeek, isDemoEntry, isPastMemory, pickMemory, recapEntries, recapWeekForToday, weekEntries, weekHighlights, weekStart } from "../../src/lib/memories";
import { formatRoute, parseRoute } from "../../src/lib/routes";
import { initialObservations } from "../../src/data/progress";
import type { Entry, LessonRecord } from "../../src/types";

const TODAY = "2026-10-13"; // a Tuesday
const entry = (id: string, date: string, fields: Partial<Entry> = {}): Entry => ({ id, childId: "a", date, photos: [], createdAt: `${date}T10:00:00.000Z`, updatedAt: `${date}T10:00:00.000Z`, ...fields });
const tried = (id: string, date: string, fields: Partial<LessonRecord> = {}): LessonRecord => ({ id, childId: "a", lesson: "Pouring", kind: "tried", activityId: "water-pouring", date, createdAt: `${date}T10:00:00.000Z`, ...fields });
const anyPhoto = () => true;
const anyActivity = () => true;

test("dates: days and Monday-start weeks follow the calendar, across months and years", () => {
  assert.equal(addDays("2026-10-13", -7), "2026-10-06");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(weekStart("2026-10-13"), "2026-10-12"); // Tuesday → Monday
  assert.equal(weekStart("2026-10-12"), "2026-10-12"); // Monday stays
  assert.equal(weekStart("2026-10-18"), "2026-10-12"); // Sunday belongs to the week before it
  assert.equal(weekStart("2027-01-01"), "2026-12-28");
  // Across the end of daylight saving time (a 25-hour day in many zones).
  assert.equal(addDays("2026-11-01", 1), "2026-11-02");
});

test("a past memory is at least 7 days old and wasn't written today", () => {
  assert.equal(isPastMemory({ date: "2026-10-07" }, TODAY), false, "6 days ago");
  assert.equal(isPastMemory({ date: "2026-10-06" }, TODAY), true, "7 days ago");
  assert.equal(isPastMemory({ date: TODAY }, TODAY), false, "today");
  // Backdated a month, but written just now: not presented as looking back yet.
  // (A local time without a zone: written this morning on the device's own calendar.)
  assert.equal(isPastMemory({ date: "2026-09-01", createdAt: "2026-10-13T09:00:00" }, TODAY), false, "backdated, written today");
  assert.equal(isPastMemory({ date: "2026-09-01", createdAt: "2026-09-01T10:00:00.000Z" }, TODAY), true);
  assert.equal(isPastMemory({ date: "2026-09-01", createdAt: null }, TODAY), true, "no creation time (older records)");
});

test("Looking Back: only memories a week old or more, never a removed child's, nothing when there are none", () => {
  const recent = [entry("m-today", TODAY, { photos: ["p1"] }), entry("m-3", "2026-10-10", { text: "three days ago" })];
  assert.equal(pickMemory(recent, [], ["a"], TODAY, anyPhoto, anyActivity), undefined, "nothing old enough → the section is hidden");

  const old = entry("m-old", "2026-09-20", { text: "a month ago" });
  assert.deepEqual(pickMemory([...recent, old], [], ["a"], TODAY, anyPhoto, anyActivity), { kind: "text", entry: old });
  // A photo Moment is preferred, but only an old one.
  const oldPhoto = entry("m-old-photo", "2026-10-01", { photos: ["p2"] });
  assert.deepEqual(pickMemory([...recent, old, oldPhoto], [], ["a"], TODAY, anyPhoto, anyActivity), { kind: "photo", entry: oldPhoto, photo: "p2" });
  // A photo that can't be shown on this device doesn't count as one.
  assert.deepEqual(pickMemory([...recent, old, oldPhoto], [], ["a"], TODAY, p => p !== "p2", anyActivity), { kind: "text", entry: old });
  // Not a removed child's.
  assert.equal(pickMemory([{ ...old, childId: "gone" }], [], ["a"], TODAY, anyPhoto, anyActivity), undefined);
});

test("Looking Back: a tried activity only when it is old enough and its activity still exists", () => {
  assert.equal(pickMemory([], [tried("t-new", "2026-10-11")], ["a"], TODAY, anyPhoto, anyActivity), undefined);
  const record = tried("t-old", "2026-09-30");
  assert.deepEqual(pickMemory([], [record], ["a"], TODAY, anyPhoto, anyActivity), { kind: "tried", record });
  assert.equal(pickMemory([], [record], ["a"], TODAY, anyPhoto, () => false), undefined);
  assert.equal(pickMemory([], [{ ...record, kind: undefined }], ["a"], TODAY, anyPhoto, anyActivity), undefined, "only Mark as Tried records");
});

test("Looking Back and the recap never use an unedited demo Moment; once the parent edits it, it is theirs", () => {
  const seed = initialObservations[0];
  const demo = entry(`obs-${seed.id}`, "2026-09-01", { text: seed.notes });
  assert.equal(isDemoEntry(demo), true);
  assert.equal(pickMemory([demo], [], ["a"], TODAY, anyPhoto, anyActivity), undefined);
  assert.deepEqual(recapEntries([demo], ["a"]), []);
  const edited = { ...demo, text: `${seed.notes} She was so proud.` };
  assert.equal(isDemoEntry(edited), false);
  assert.deepEqual(pickMemory([edited], [], ["a"], TODAY, anyPhoto, anyActivity), { kind: "text", entry: edited });
});

test("weekly recap: one week's Moments in order, a few highlights, and the week Today offers", () => {
  const all = [
    entry("m-mon", "2026-10-05", { text: "words only" }),
    entry("m-wed", "2026-10-07", { photos: ["p"], text: "photo and words" }),
    entry("m-thu", "2026-10-08", { photos: ["p"] }),
    entry("m-sun", "2026-10-11", { title: "title only" }),
    entry("m-next", "2026-10-12", { text: "this week" }),
    entry("m-empty", "2026-10-06"),
    entry("m-other", "2026-10-06", { childId: "b", text: "sibling" }),
  ];
  const mine = recapEntries(all, ["a", "b"]);
  assert.ok(!mine.some(e => e.id === "m-empty"), "an empty Moment isn't something to revisit");
  const week = weekEntries(mine, "2026-10-05");
  assert.deepEqual(week.map(e => e.id), ["m-mon", "m-other", "m-wed", "m-thu", "m-sun"], "Monday to Sunday, oldest first");
  // The fullest three, shown in the order they happened.
  assert.deepEqual(weekHighlights(week, anyPhoto).map(e => e.id), ["m-wed", "m-thu", "m-sun"]);
  // One child at a time.
  assert.deepEqual(weekEntries(recapEntries(all, ["a", "b"], "b"), "2026-10-05").map(e => e.id), ["m-other"]);
  // Today offers last week when it has Moments, else this week so far, else nothing.
  assert.equal(recapWeekForToday(mine, TODAY), "2026-10-05");
  assert.equal(recapWeekForToday(mine.filter(e => e.date >= "2026-10-12"), TODAY), "2026-10-12");
  assert.equal(recapWeekForToday(mine.filter(e => e.date < "2026-10-01"), TODAY), undefined);
  assert.equal(firstRecapWeek(mine), "2026-10-05");
  assert.equal(firstRecapWeek([]), undefined);
});

test("routes: the weekly recap has its own address, with a week and a child", () => {
  assert.equal(formatRoute({ screen: "recap", week: "2026-10-05", child: "emma" }), "#/moments-week/2026-10-05?child=emma");
  assert.equal(formatRoute({ screen: "recap" }), "#/moments-week");
  assert.deepEqual(parseRoute("#/moments-week/2026-10-05?child=emma"), { screen: "recap", week: "2026-10-05", child: "emma" });
  assert.deepEqual(parseRoute("#/moments-week/not-a-date"), { screen: "recap", week: undefined, child: undefined });
});
