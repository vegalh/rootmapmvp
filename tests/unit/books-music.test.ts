import { test } from "node:test";
import assert from "node:assert/strict";
import { booksOn, placeBook, savedBooks, shelfOf, validItems } from "../../src/lib/bookshelf.ts";
import { agesLabel, bookAgeRanges, findActivity, localizeBook, readingAgeLabel, isMusicId, matchesAge, matchesQuery, musicAsActivity } from "../../src/lib/catalog.ts";
import { activities } from "../../src/data/activities.ts";
import { books } from "../../src/data/books.ts";
import { musicActivities } from "../../src/data/music.ts";
import { settingShape } from "../../src/lib/data/schema.ts";
import { copy } from "../../src/lib/i18n.ts";
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
    assert.ok(bookAgeRanges(b).length, `${b.id} has an age range`);
  }
  for (const m of musicActivities) {
    assert.ok(m.title && m.description && m.howToPlay.length && m.whatChildrenExplore.length, `${m.id} has its text`);
    assert.ok(m.ageRanges.length && m.duration > 0, `${m.id} has ages and a duration`);
    assert.deepEqual(musicAsActivity(m).steps, m.howToPlay);
  }
});

test("books: the curated books, one record per book with both editions' titles", () => {
  assert.deepEqual(books.map(b => [b.id, b.title, b.titleZh, b.author]), [
    ["guess-how-much-i-love-you", "Guess How Much I Love You", "猜猜我有多爱你", "Sam McBratney"],
    ["the-carrot-seed", "The Carrot Seed", "胡萝卜种子", "Ruth Krauss"],
    ["a-pocketful-of-kisses", "A Pocketful of Kisses", "一口袋的吻", "Angela McAllister"],
    ["something-from-nothing", "Something from Nothing", "爷爷一定有办法", "Phoebe Gilman"],
    ["the-runaway-bunny", "The Runaway Bunny", "逃家小兔", "Margaret Wise Brown"],
    ["the-giving-tree", "The Giving Tree", "爱心树", "Shel Silverstein"],
    ["charlie-needs-a-cloak", "Charlie Needs a Cloak", "阿利的红斗篷", "Tomie dePaola"],
    ["a-squash-and-a-squeeze", "A Squash and a Squeeze", "小房子变大房子", "Julia Donaldson"],
    ["the-smartest-giant-in-town", "The Smartest Giant in Town", "城里最漂亮的巨人", "Julia Donaldson"],
    ["lazy-ozzie", "Lazy Ozzie", "懒奥西", "Michael Coleman"],
    ["the-reason-for-being-late", "The Reason for Being Late", "迟到的理由", "Yao Jia"],
    ["badgers-parting-gifts", "Badger's Parting Gifts", "獾的礼物", "Susan Varley"],
    ["the-cat-that-lived-a-million-times", "The Cat That Lived a Million Times", "活了一百万次的猫", "Yoko Sano"],
    ["little-mouse-series", "The Little Mouse Series", "可爱的鼠小弟", "Yoshio Nakae and Noriko Ueno"],
    ["where-does-thursday-go", "Where Does Thursday Go?", "“星期四”要去哪里呢？", "Janeen Brian"],
    ["happy-birthday-moon", "Happy Birthday, Moon", "月亮生日快乐", "Frank Asch"],
    ["little-bears-special-wish", "Little Bear's Special Wish", "小熊的特别愿望", "Gillian Lobel"],
    ["the-crocodile-and-the-dentist", "The Crocodile and the Dentist", "鳄鱼怕怕牙医怕怕", "Taro Gomi"],
    ["the-color-monster", "The Color Monster", "我的情绪小怪兽", "Anna Llenas"],
    ["dotty-and-scaly", "Dotty and Scaly", "花点点和鳞片片", "Daniela Kulot"],
    ["just-like-my-mum", "Just Like My Mum", "像妈妈一样", "David Melling"],
    ["just-like-my-dad", "Just Like My Dad", "像爸爸一样", "David Melling"],
    ["a-child-of-books", "A Child of Books", "书之子", "Oliver Jeffers and Sam Winston"],
    ["delicious", "Delicious!", "最好喝的汤", "Helen Cooper"],
    ["little-polar-bear-and-the-brave-little-hare", "Little Polar Bear and the Brave Little Hare", "小北极熊和勇敢的小野兔", "Hans de Beer"],
    ["lots", "Lots: The Diversity of Life on Earth", "数不清！大自然的生物多样性", "Nicola Davies"],
    ["tiny-creatures", "Tiny Creatures: The World of Microbes", "微生物：看不见的魔术师", "Nicola Davies"],
    ["musical-max", "Musical Max", "爱音乐的马可", "Robert Kraus"],
    ["guess-how-much-i-love-you-counting", "Guess How Much I Love You: Counting", "猜猜我有多爱你（数一数）", "Sam McBratney"],
    ["guess-how-much-i-love-you-colors", "Guess How Much I Love You: Colors", "猜猜我有多爱你（颜色）", "Sam McBratney"],
    ["little-bear-and-the-best-dad", "Little Bear and the Best Dad", "小熊和最好的爸爸", "Arend van Dam"],
    ["the-storm-seal", "The Storm Seal", "暴风雨后的小海豹", "Judy Waite"],
    ["the-snowman", "The Snowman", "雪人", "Raymond Briggs"],
    ["mole-and-the-baby-bird", "Mole and the Baby Bird", "鼹鼠与小鸟", "Marjorie Newman"],
    ["tanya-books", "The Tanya Books", "爱跳舞的孩子", "Patricia Lee Gauch"],
  ]);
  assert.ok(!books.some(b => b.id.startsWith("sample-")), "no sample books left");
  for (const b of books) assert.ok(b.authorZh && b.descriptionZh && b.whyWeRecommendZh, `${b.id} has Chinese text`);
});

test("books: listed under every age filter the reading age overlaps", () => {
  const ranges = (id: string) => bookAgeRanges(books.find(b => b.id === id)!);
  assert.deepEqual(ranges("guess-how-much-i-love-you"), ["2–3", "3–4", "4–6"]);
  assert.deepEqual(ranges("the-carrot-seed"), ["2–3", "3–4", "4–6"]);
  assert.deepEqual(ranges("a-squash-and-a-squeeze"), ["3–4", "4–6"]);
  assert.deepEqual(ranges("the-giving-tree"), ["4–6", "6+"]);
  const carrot = books.find(b => b.id === "the-carrot-seed")!;
  assert.equal(readingAgeLabel(carrot, "en"), "2–5 years");
  assert.equal(readingAgeLabel(books.find(b => b.id === "the-giving-tree")!, "zh"), "4–6+岁");
});

test("books: each edition's cover is its own file; editions without one have none", () => {
  const editions = (lang: "en" | "zh") => books.filter(b => lang === "en" ? b.coverEn : b.coverZh).map(b => b.id);
  const withBoth = ["guess-how-much-i-love-you", "a-pocketful-of-kisses", "something-from-nothing", "the-runaway-bunny", "the-giving-tree", "charlie-needs-a-cloak", "the-smartest-giant-in-town"];
  assert.deepEqual(editions("en"), withBoth);
  assert.deepEqual(editions("zh"), [...withBoth, "lazy-ozzie"]);
  for (const b of books) {
    if (b.coverEn) assert.match(b.coverEn, new RegExp(`${b.id}-en\\.jpg`), `${b.id} English cover`);
    if (b.coverZh) assert.match(b.coverZh, new RegExp(`${b.id}-zh\\.jpg`), `${b.id} Chinese cover`);
  }
});

test("books: each language shows its own edition's cover, never the other one's", () => {
  const b = { ...books[1], coverEn: "/en.jpg", coverZh: "/zh.jpg" };
  assert.equal(localizeBook(b, copy.en).cover, "/en.jpg");
  assert.equal(localizeBook(b, copy.zh).cover, "/zh.jpg");
  assert.equal(localizeBook({ ...b, coverZh: undefined }, copy.zh).cover, undefined, "no English cover in Chinese");
  assert.equal(localizeBook({ ...b, coverEn: undefined }, copy.en).cover, undefined, "no Chinese cover in English");
  assert.equal(localizeBook(b, copy.zh).title, "胡萝卜种子");
  assert.equal(localizeBook(b, copy.en).title, "The Carrot Seed");
});

test("bookshelf: a removed sample book stays stored but is not a catalog book", () => {
  const stored = [{ bookId: "sample-book-1", shelf: "owned", addedAt: t0 }, { bookId: "the-carrot-seed", shelf: "wishlist", addedAt: t1 }];
  assert.deepEqual(validItems(stored), stored, "kept as stored");
  const items = placeBook(stored as never, "the-giving-tree", "owned", t2);
  assert.ok(items.some(i => i.bookId === "sample-book-1"), "untouched by other changes");
  assert.deepEqual(booksOn(items, "owned").filter(id => books.some(b => b.id === id)), ["the-giving-tree"]);
});

test("wishlist: one list of every saved book, newest first, including books saved to My Books before", () => {
  const stored = [{ bookId: "b-old", shelf: "owned" as const, addedAt: t0 }, { bookId: "b-new", shelf: "wishlist" as const, addedAt: t1 }];
  assert.deepEqual(savedBooks(validItems(stored)), ["b-new", "b-old"]);
  // Saving a book now puts it on the Wishlist; earlier entries keep their stored shelf.
  const next = placeBook(stored, "b-3", "wishlist", "2026-12-01T00:00:00.000Z");
  assert.deepEqual(next.map(i => [i.bookId, i.shelf]), [["b-3", "wishlist"], ["b-old", "owned"], ["b-new", "wishlist"]]);
});
