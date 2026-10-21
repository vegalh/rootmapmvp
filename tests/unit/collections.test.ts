import { test } from "node:test";
import assert from "node:assert/strict";
import { collections } from "../../src/data/collections.ts";
import { activities } from "../../src/data/activities.ts";
import { DESCRIPTIVE_DOMAINS, ageTagLabel, buildsDomains, catalogItems, matchesTime, suitableFirst, timeBand } from "../../src/lib/catalog.ts";
import { MIN_COLLECTION_SIZE, collectionActivities, collectionImages, findShownCollection, isCollectionShown, shownCollections } from "../../src/lib/collections.ts";
import { TABLE, fromRow, toRow } from "../../src/lib/sync/mapping.ts";
import type { Activity, Child } from "../../src/types.ts";

const base = activities[0];
const make = (id: string, extra: Partial<Activity> = {}): Activity => ({
  ...base, id, title: id, topic: "Everyday Life", category: "practical-life", minutes: 10, domains: [], keywords: "", zh: undefined, settings: undefined, materialType: undefined, ...extra,
});
const byId = (id: string) => collections.find(c => c.id === id)!;
const matching = (id: string, list: Activity[]) => list.filter(byId(id).match).map(a => a.id);
const october = new Date(2026, 9, 20);

test("collections: after-work is 15 minutes or less, at home", () => {
  const list = [
    make("home-15", { minutes: 15, settings: ["home"] }),
    make("home-16", { minutes: 16, settings: ["home"] }),
    make("park-5", { minutes: 5, settings: ["park"] }),
    make("unreviewed-5", { minutes: 5 }),
  ];
  assert.deepEqual(matching("after-work", list), ["home-15"]);
});

test("collections: nothing-to-buy is nothing needed or everyday things", () => {
  const list = [make("none", { materialType: "none" }), make("everyday", { materialType: "everyday" }), make("special")];
  assert.deepEqual(matching("nothing-to-buy", list), ["none", "everyday"]);
});

test("collections: rainy-day is at home, but not Nature & Culture", () => {
  const list = [
    make("home-art", { settings: ["home"], category: "art-creativity" }),
    make("home-nature", { settings: ["home"], category: "nature-culture" }),
    make("park-art", { settings: ["park"], category: "art-creativity" }),
  ];
  assert.deepEqual(matching("rainy-day", list), ["home-art"]);
});

test("collections: waiting-for-food is anything done at a restaurant", () => {
  const list = [make("restaurant", { settings: ["home", "restaurant"] }), make("home", { settings: ["home"] })];
  assert.deepEqual(matching("waiting-for-food", list), ["restaurant"]);
});

test("collections: calm-and-focused is concentration or self-regulation, 10 minutes or less", () => {
  const list = [
    make("focus-10", { domains: ["Fine Motor Coordination", "Concentration"], minutes: 10 }),
    make("calm-5", { domains: ["Self-Regulation"], minutes: 5 }),
    make("focus-12", { domains: ["Concentration"], minutes: 12 }),
    make("other-5", { domains: ["Independence"], minutes: 5 }),
  ];
  assert.deepEqual(matching("calm-and-focused", list), ["focus-10", "calm-5"]);
});

test("collections: weekend-kitchen is the Food Preparation topic", () => {
  const list = [make("food", { topic: "Food Preparation" }), make("food-domain", { domains: ["Food Preparation"] })];
  assert.deepEqual(matching("weekend-kitchen", list), ["food"]);
});

test("collections: autumn is the Seasons topic or a fall/autumn keyword (whole words only)", () => {
  const list = [
    make("seasons", { topic: "Seasons" }),
    make("fall", { keywords: "leaves fall art" }),
    make("autumn", { keywords: "Autumn harvest" }),
    make("waterfall", { keywords: "waterfall falling" }),
  ];
  assert.deepEqual(matching("autumn", list), ["seasons", "fall", "autumn"]);
});

test("collections: built from the whole catalog, music included, so new activities join automatically", () => {
  const ids = collectionActivities(byId("after-work")).map(a => a.id);
  assert.ok(ids.includes("music-freeze-dance"), "music activities are part of collections");
  assert.ok(ids.includes("mopping"));
  for (const c of collections) {
    assert.deepEqual(collectionActivities(c).map(a => a.id), catalogItems().filter(c.match).map(a => a.id), c.id);
  }
});

test("collections: one with fewer than 3 activities is hidden", () => {
  assert.equal(MIN_COLLECTION_SIZE, 3);
  const restaurant = (id: string) => make(id, { settings: ["restaurant"] });
  const two = [restaurant("a"), restaurant("b")];
  const three = [...two, restaurant("c")];
  assert.equal(isCollectionShown(byId("waiting-for-food"), { date: october, items: two }), false);
  assert.equal(isCollectionShown(byId("waiting-for-food"), { date: october, items: three }), true);
  assert.deepEqual(shownCollections({ date: october, items: three }).map(c => c.id), ["waiting-for-food"]);
  assert.deepEqual(shownCollections({ date: october, items: two }).map(c => c.id), []);
  assert.deepEqual(shownCollections({ date: october, items: [] }), []);
});

test("collections: autumn is shown only from September through November", () => {
  const autumn = byId("autumn");
  const shownOn = (y: number, m: number, d: number) => isCollectionShown(autumn, { date: new Date(y, m - 1, d) });
  assert.equal(shownOn(2026, 8, 31), false);
  assert.equal(shownOn(2026, 9, 1), true);
  assert.equal(shownOn(2026, 10, 20), true);
  assert.equal(shownOn(2026, 11, 30), true);
  assert.equal(shownOn(2026, 12, 1), false);
  assert.equal(shownOn(2027, 3, 15), false);
  assert.equal(findShownCollection("autumn", new Date(2026, 6, 1)), undefined);
  assert.equal(findShownCollection("autumn", october)?.id, "autumn");
  // The other collections are shown all year.
  for (const c of collections.filter(x => x.id !== "autumn")) assert.ok(isCollectionShown(c, { date: new Date(2026, 6, 1) }), c.id);
});

test("collections: ids are unique and every one has English and Chinese text", () => {
  assert.equal(new Set(collections.map(c => c.id)).size, collections.length);
  for (const c of collections) assert.ok(c.title && c.subtitle && c.zh.title && c.zh.subtitle, c.id);
});

test("builds line: the first two abilities, skipping descriptions of the activity", () => {
  assert.deepEqual(DESCRIPTIVE_DOMAINS, ["Food Preparation", "Nature Awareness", "Creativity", "Sequencing"]);
  const a = make("x", {
    domains: ["Food Preparation", "Concentration", "Sequencing", "Fine Motor Coordination", "Independence"],
    zh: { domains: ["食物准备", "专注力", "顺序感", "精细动作协调", "独立性"] },
  });
  assert.deepEqual(buildsDomains(a, "en"), ["Concentration", "Fine Motor Coordination"]);
  assert.deepEqual(buildsDomains(a, "zh"), ["专注力", "精细动作协调"]);
  assert.deepEqual(buildsDomains(make("one", { domains: ["Creativity", "Observation"] }), "en"), ["Observation"]);
  assert.deepEqual(buildsDomains(make("none", { domains: ["Creativity", "Nature Awareness"] }), "en"), [], "no line when nothing is left");
  // Without a Chinese list the English name is shown.
  assert.deepEqual(buildsDomains(make("en-only", { domains: ["Balance"] }), "zh"), ["Balance"]);
  // Nothing excluded ever reaches a card, in either language.
  for (const item of catalogItems()) {
    assert.ok(buildsDomains(item, "en").length <= 2);
    assert.ok(!buildsDomains(item, "en").some(d => DESCRIPTIVE_DOMAINS.includes(d)), item.id);
    if (item.zh?.domains) assert.ok(!buildsDomains(item, "zh").includes("食物准备"), item.id);
  }
});

test("quick facts: age tag and time bands", () => {
  assert.equal(ageTagLabel({ age: "2–4 years", ageKey: "" }, "en"), "2–4 yrs");
  assert.equal(ageTagLabel({ age: "2–4 years", ageKey: "" }, "zh"), "2–4岁");
  assert.equal(ageTagLabel({ age: "4+ years", ageKey: "" }, "en"), "4+ yrs");
  assert.equal(ageTagLabel({ age: "4+ years", ageKey: "" }, "zh"), "4岁+");
  assert.deepEqual([5, 10, 11, 15, 16, 20].map(timeBand), ["upTo10", "upTo10", "10to15", "10to15", "over15", "over15"]);
  assert.equal(matchesTime({ minutes: 12 }, "All"), true);
  assert.equal(matchesTime({ minutes: 12 }, "upTo10"), false);
});

test("collection page order: activities that suit a child come first, as on Discover", () => {
  const toddler = make("toddler", { age: "1–2 years", ageKey: "0–2" });
  const preschool = make("preschool", { age: "3–6 years", ageKey: "3–6" });
  const fourYears = new Date();
  fourYears.setFullYear(fourYears.getFullYear() - 4);
  const kid = { id: "c-1", first: "Mia", last: "", dob: fourYears.toISOString().slice(0, 10) } as Child;
  assert.deepEqual(suitableFirst([toddler, preschool], [kid]).map(a => a.id), ["preschool", "toddler"]);
  assert.deepEqual(suitableFirst([toddler, preschool], []).map(a => a.id), ["toddler", "preschool"]);
});

test("saved collections sync like saved activities, to their own table", () => {
  assert.equal(TABLE.savedCollections, "saved_collections");
  const rec = { id: "after-work", createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z", deletedAt: null, origin: "user", position: 0 };
  const row = toRow("savedCollections", rec, { userId: "u" });
  assert.equal(row.id, "after-work");
  assert.equal(fromRow("savedCollections", row, undefined).id, "after-work");
});

test("collection cards: each shown collection gets its own picture", () => {
  const list = shownCollections({ date: october });
  const pictures = collectionImages(list);
  const images = list.map(c => pictures.get(c.id));
  assert.ok(images.every(Boolean));
  assert.equal(new Set(images).size, images.length, "no picture repeats down the list");
});
