import { test } from "node:test";
import assert from "node:assert/strict";
import { booksOn, placeBook, shelfOf } from "../../src/lib/bookshelf.ts";
import { agesLabel, findActivity, isMusicId, matchesAge, matchesQuery, musicAsActivity } from "../../src/lib/catalog.ts";
import { activities } from "../../src/data/activities.ts";
import { books } from "../../src/data/books.ts";
import { musicActivities } from "../../src/data/music.ts";
import { settingShape } from "../../src/lib/data/schema.ts";
import type { ShelfItem } from "../../src/types.ts";

const t0 = "2026-10-01T10:00:00.000Z", t1 = "2026-10-02T10:00:00.000Z", t2 = "2026-10-03T10:00:00.000Z";

test("bookshelf: adding puts the book on one shelf", () => {
  const items = placeBook([], "b1", "owned", t0);
  assert.deepEqual(items, [{ bookId: "b1", shelf: "owned", addedAt: t0 }]);
  assert.equal(shelfOf(items, "b1"), "owned");
  assert.equal(shelfOf(items, "b2"), null);
});

test("bookshelf: moving between My Books and Wishlist never duplicates", () => {
  let items = placeBook([], "b1", "owned", t0);
  items = placeBook(items, "b1", "wishlist", t1);
  items = placeBook(items, "b1", "owned", t2);
  items = placeBook(items, "b1", "owned", t2);
  assert.equal(items.length, 1);
  assert.equal(shelfOf(items, "b1"), "owned");
  assert.deepEqual(booksOn(items, "wishlist"), []);
});

test("bookshelf: removing takes it off either shelf and leaves the others", () => {
  let items = placeBook([], "b1", "owned", t0);
  items = placeBook(items, "b2", "wishlist", t1);
  items = placeBook(items, "b1", null, t2);
  assert.deepEqual(items.map(i => i.bookId), ["b2"]);
  items = placeBook(items, "b2", null, t2);
  assert.deepEqual(items, []);
});

test("bookshelf: shelves list the most recently added first", () => {
  let items = placeBook([], "b1", "owned", t0);
  items = placeBook(items, "b2", "owned", t2);
  items = placeBook(items, "b3", "owned", t1);
  assert.deepEqual(booksOn(items, "owned"), ["b2", "b3", "b1"]);
});

test("bookshelf: malformed or repeated stored items are dropped on the next change", () => {
  const stored = [
    { bookId: "b1", shelf: "owned", addedAt: t0 },
    { bookId: "b1", shelf: "wishlist", addedAt: t1 },
    { bookId: 5, shelf: "owned", addedAt: t0 },
    { bookId: "b3", shelf: "elsewhere", addedAt: t0 },
    null,
  ] as unknown as ShelfItem[];
  const items = placeBook(stored, "b2", "wishlist", t2);
  assert.deepEqual(items.map(i => [i.bookId, i.shelf]), [["b2", "wishlist"], ["b1", "owned"]]);
});

test("bookshelf: stored with the existing settings, as an array", () => {
  assert.equal(settingShape("rootmap-bookshelf"), "array");
});

test("catalog: age labels span the ranges in both languages", () => {
  assert.equal(agesLabel(["2–3", "3–4"], "en"), "2–4 years");
  assert.equal(agesLabel(["2–3", "3–4"], "zh"), "2–4岁");
  assert.equal(agesLabel(["0–2"], "en"), "0–2 years");
  assert.equal(agesLabel(["4–6", "6+"], "en"), "4+ years");
  assert.equal(agesLabel(["6+"], "zh"), "6岁+");
});

test("catalog: an item can match several age filters", () => {
  assert.ok(matchesAge(["2–3", "3–4"], "2–3"));
  assert.ok(matchesAge(["2–3", "3–4"], "3–4"));
  assert.ok(!matchesAge(["2–3", "3–4"], "4–6"));
  assert.ok(matchesAge(["6+"], "All Ages"));
});

test("catalog: search matches English or Chinese, ignoring case and spaces", () => {
  assert.ok(matchesQuery("freeze", ["Freeze Dance", "音乐停，我也停"]));
  assert.ok(matchesQuery("音乐停", ["Freeze Dance", "音乐停，我也停"]));
  assert.ok(matchesQuery("  ", ["Anything"]));
  assert.ok(!matchesQuery("piano", ["Freeze Dance", undefined]));
});

test("catalog: music and activity ids resolve through one lookup and never collide", () => {
  const ids = [...activities.map(a => a.id), ...musicActivities.map(m => m.id)];
  assert.equal(new Set(ids).size, ids.length, "ids are unique across activities and music");
  for (const a of activities) assert.equal(findActivity(a.id), a, "Discover activities resolve to themselves");
  const m = musicActivities[0];
  assert.ok(isMusicId(m.id));
  assert.ok(!isMusicId(activities[0].id));
  const asActivity = findActivity(m.id)!;
  assert.equal(asActivity.title, m.title);
  assert.equal(asActivity.minutes, m.duration);
  assert.equal(asActivity.area, "Music");
  assert.ok(asActivity.image, "has a cover to show in My Week rows");
  assert.equal(asActivity.zh?.title, m.titleZh);
  assert.equal(findActivity("no-such-id"), undefined);
});

test("catalog: book and music data are complete", () => {
  const bookIds = books.map(b => b.id);
  assert.equal(new Set(bookIds).size, bookIds.length, "book ids are unique");
  for (const b of books) {
    assert.ok(b.title && b.author && b.description && b.whyWeRecommend, `${b.id} has its text`);
    assert.ok(b.ageRanges.length, `${b.id} has an age range`);
  }
  for (const m of musicActivities) {
    assert.ok(m.title && m.description && m.howToPlay.length && m.whatChildrenExplore.length, `${m.id} has its text`);
    assert.ok(m.ageRanges.length && m.duration > 0, `${m.id} has ages and a duration`);
    assert.deepEqual(musicAsActivity(m).steps, m.howToPlay);
  }
});
