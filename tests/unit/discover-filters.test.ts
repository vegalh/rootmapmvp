import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_SETTINGS, DEFAULT_DISCOVER_FILTERS, DISCOVER_CATEGORIES, MATERIAL_TYPES, catalogItems, filterDiscoverActivities, findActivity, matchesMaterials, matchesSetting } from "../../src/lib/catalog.ts";
import { activities } from "../../src/data/activities.ts";
import { musicActivities } from "../../src/data/music.ts";
import { categoryOptionLabel, copy, materialsOptionLabel, settingOptionLabel } from "../../src/lib/i18n.ts";
import type { Activity } from "../../src/types.ts";

const base = activities[0];
const make = (id: string, extra: Partial<Activity>): Activity => ({ ...base, id, title: id, keywords: "", zh: undefined, settings: undefined, materialType: undefined, ...extra });
const listening = make("listening-walk", { settings: ["walking", "park", "train", "waiting"], materialType: "none", category: "sensory-movement" });
const napkin = make("napkin-fold", { settings: ["restaurant", "home"], materialType: "everyday", category: "practical-life" });
const unreviewed = make("unreviewed", { category: "art-creativity" });
const sample = [listening, napkin, unreviewed];
const ids = (list: Activity[]) => list.map(a => a.id);
const filter = (f: Partial<typeof DEFAULT_DISCOVER_FILTERS>, list: Activity[] = sample) => ids(filterDiscoverActivities(list, { ...DEFAULT_DISCOVER_FILTERS, ...f }));
const musicIds = musicActivities.map(m => m.id);

test("discover filters: a setting lists only the activities done there", () => {
  assert.deepEqual(filter({ setting: "restaurant" }), ["napkin-fold"]);
  assert.deepEqual(filter({ setting: "airplane" }), []);
});

test("discover filters: an activity with several settings is listed under each, once", () => {
  for (const s of ["walking", "park", "train", "waiting"]) assert.deepEqual(filter({ setting: s }), ["listening-walk"], s);
  assert.equal(filter({}).filter(id => id === "listening-walk").length, 1);
});

test("discover filters: materials", () => {
  assert.deepEqual(filter({ materials: "none" }), ["listening-walk"]);
  assert.deepEqual(filter({ materials: "everyday" }), ["napkin-fold"]);
});

test("discover filters: category", () => {
  assert.deepEqual(filter({ category: "practical-life" }), ["napkin-fold"]);
  assert.deepEqual(filter({ category: "art-creativity" }), ["unreviewed"]);
  assert.deepEqual(filter({ category: "math" }), []);
});

test("discover filters: missing metadata stays visible under All only", () => {
  assert.ok(filter({}).includes("unreviewed"));
  for (const s of ACTIVITY_SETTINGS) assert.equal(matchesSetting(unreviewed, s), false, s);
  for (const m of MATERIAL_TYPES) assert.equal(matchesMaterials(unreviewed, m), false, m);
  assert.equal(matchesSetting(unreviewed, "All"), true);
  assert.equal(matchesMaterials(unreviewed, "All"), true);
});

test("discover filters: setting, age, category, materials and search combine", () => {
  assert.deepEqual(filter({ setting: "home", materials: "everyday", category: "practical-life" }), ["napkin-fold"]);
  assert.deepEqual(filter({ setting: "home", category: "sensory-movement" }), []);
  assert.deepEqual(filter({ setting: "home", materials: "none" }), []);
  assert.deepEqual(filter({ setting: "park", q: "listening" }), ["listening-walk"]);
  assert.deepEqual(filter({ setting: "park", q: "napkin" }), []);
  // Against the real catalog: every result satisfies every filter.
  const found = filterDiscoverActivities(catalogItems(), { ...DEFAULT_DISCOVER_FILTERS, setting: "home", age: "2–3", category: "practical-life", materials: "everyday", q: "wash" });
  assert.ok(found.length > 0);
  for (const a of found) assert.ok(a.settings?.includes("home") && a.materialType === "everyday" && a.category === "practical-life", a.id);
});

test("discover filters: clearing a filter, or all of them, brings every activity back", () => {
  assert.deepEqual(filter({}), ids(sample));
  assert.deepEqual(filter({ setting: "restaurant", materials: "All" }), filter({ setting: "restaurant" }));
  assert.deepEqual(filter({ setting: "All", category: "All", materials: "everyday" }), filter({ materials: "everyday" }));
  assert.deepEqual(ids(filterDiscoverActivities(catalogItems(), DEFAULT_DISCOVER_FILTERS)), ids(catalogItems()));
});

test("unified catalog: every activity and music activity, once each, with their ids", () => {
  const all = ids(catalogItems());
  assert.equal(all.length, activities.length + musicActivities.length);
  assert.equal(new Set(all).size, all.length);
  for (const id of [...ids(activities), ...musicIds]) assert.ok(all.includes(id), id);
  // A saved music id still resolves (Saved, My Week, records), and stays a music item with its recording field.
  for (const m of musicActivities) assert.equal(findActivity(m.id)?.title, m.title);
});

test("music: Art & Creativity, works with every filter, and is found by search in English and Chinese", () => {
  const music = catalogItems().filter(a => a.type === "music");
  assert.equal(music.length, musicActivities.length);
  for (const m of music) {
    assert.equal(m.category, "art-creativity", m.id);
    assert.ok(m.settings?.length, `${m.id}: settings`);
    assert.ok(m.materialType, `${m.id}: materials`);
  }
  assert.deepEqual(filter({ category: "art-creativity" }, catalogItems()).filter(id => musicIds.includes(id)), musicIds);
  const m = musicActivities[0];
  assert.ok(filter({ q: m.title.toLowerCase() }, catalogItems()).includes(m.id));
  assert.ok(filter({ q: m.titleZh! }, catalogItems()).includes(m.id));
  assert.ok(filter({ q: "艺术" }, catalogItems()).includes(m.id), "category name in Chinese");
  for (const s of m.settings!) assert.ok(filter({ setting: s }, catalogItems()).includes(m.id), s);
  assert.ok(filter({ age: m.ageRanges[0] }, catalogItems()).includes(m.id));
  // Music is never suggested for quiet public places.
  for (const x of music) for (const s of ["restaurant", "waiting", "airplane", "train"]) assert.ok(!x.settings?.includes(s as never), `${x.id} ${s}`);
});

test("music materials: only activities a parent can sing or call out are Nothing Needed", () => {
  const byId = Object.fromEntries(musicActivities.map(m => [m.id, m.materialType]));
  assert.deepEqual(byId, {
    "music-freeze-dance": "everyday", // music has to play and stop: a phone or speaker
    "music-clap-the-beat": "none",
    "music-animal-walks": "none",
    "music-fast-and-slow": "everyday", // the music speeds up and slows down: a phone or speaker
    "music-echo-song": "none",
  });
  // A "Nothing Needed" music activity says how to do it without the recording, and its card says the audio is optional.
  for (const m of musicActivities.filter(x => x.materialType === "none")) {
    const text = [m.description, ...m.howToPlay].join(" ");
    assert.ok(/sing|call (one|them) out/i.test(text), m.id);
    assert.equal(findActivity(m.id)?.materialsLabel, "Optional audio guide", m.id);
    assert.equal(findActivity(m.id)?.zh?.materialsLabel, "可选音频引导", m.id);
  }
  assert.equal(findActivity("music-freeze-dance")?.materialsLabel, "Audio guide");
  assert.deepEqual(filter({ materials: "none", category: "art-creativity" }, catalogItems()).filter(id => id.startsWith("music-")).sort(), ["music-animal-walks", "music-clap-the-beat", "music-echo-song"]);
});

test("discover data: one known category per activity; settings and materials use known ids", () => {
  for (const a of catalogItems()) {
    assert.ok(DISCOVER_CATEGORIES.includes(a.category), `${a.id}: ${a.category}`);
    for (const s of a.settings ?? []) assert.ok(ACTIVITY_SETTINGS.includes(s), `${a.id}: ${s}`);
    assert.equal(new Set(a.settings).size, a.settings?.length ?? 0, `${a.id}: repeated setting`);
    if (a.materialType) assert.ok(MATERIAL_TYPES.includes(a.materialType), a.id);
  }
  for (const s of ACTIVITY_SETTINGS) assert.ok(catalogItems().some(a => a.settings?.includes(s)), s);
  for (const m of MATERIAL_TYPES) assert.ok(catalogItems().some(a => a.materialType === m), m);
});

test("discover data: water, blades and heat stay out of on-the-go settings", () => {
  const onTheGo = ["restaurant", "waiting", "airplane", "train", "walking"];
  for (const a of activities) {
    const risky = a.materials.some(m => /water|basin|knife|cutter|scissors|iron|cooker|sink/i.test(m));
    if (risky) assert.deepEqual(a.settings?.filter(s => onTheGo.includes(s)) ?? [], [], a.id);
  }
});

test("discover filters: English and Chinese labels", () => {
  const options = ["All", ...ACTIVITY_SETTINGS];
  assert.deepEqual(options.map(o => settingOptionLabel(o, copy.en)), ["All Settings", "Home", "Restaurant", "Waiting in Line", "Airplane", "Train", "Walking", "Park", "Grocery Store"]);
  assert.deepEqual(options.map(o => settingOptionLabel(o, copy.zh)), ["全部场景", "家里", "餐厅", "排队等候", "飞机上", "火车上", "散步途中", "公园", "超市"]);
  assert.deepEqual(DISCOVER_CATEGORIES.map(c => categoryOptionLabel(c, copy.en)), ["Practical Life", "Language", "Math", "Art & Creativity", "Nature & Culture", "Sensory & Movement"]);
  assert.deepEqual(DISCOVER_CATEGORIES.map(c => categoryOptionLabel(c, copy.zh)), ["日常生活", "语言", "数学", "艺术与创造", "自然与文化", "感官与运动"]);
  assert.deepEqual(["All", ...MATERIAL_TYPES].map(o => materialsOptionLabel(o, copy.en)), ["All", "Nothing Needed", "Everyday Items"]);
  assert.deepEqual(["All", ...MATERIAL_TYPES].map(o => materialsOptionLabel(o, copy.zh)), ["全部", "无需材料", "日常物品"]);
  assert.deepEqual([copy.en.setting, copy.en.age, copy.en.category, copy.en.materialsFilter], ["Setting", "Age", "Category", "Materials"]);
  assert.deepEqual([copy.zh.setting, copy.zh.age, copy.zh.category, copy.zh.materialsFilter], ["场景", "年龄", "类别", "所需材料"]);
});

test("every catalog activity has a category label in both languages (the one every screen shows)", () => {
  for (const a of catalogItems()) {
    for (const t of [copy.en, copy.zh]) {
      const label = categoryOptionLabel(a.category, t);
      assert.ok(label && label !== a.category, `${a.id} ${t.code}`);
    }
  }
});

test("Mixing Juice: the step cards are optional, in English and Chinese; materials unchanged", () => {
  const a = activities.find(x => x.id === "mixing-juice")!;
  assert.match(a.steps[0], /step cards together if you have them/);
  assert.match(a.zh!.steps![0], /如果有步骤卡片/);
  assert.deepEqual(a.materials, ["Pitcher of juice", "Pitcher of water", "Small measuring cup", "Cups", "Tray"]);
  assert.equal(a.materialType, "everyday");
  assert.equal(a.steps.length, a.zh!.steps!.length);
});

test("discover data: on-the-go activities are complete in both languages", () => {
  const withSafety = ["statue-game", "setting-my-place", "tape-peeling-tray"];
  const added = ["i-spy-a-color", "copy-my-hands", "statue-game", "whats-that-sound", "setting-my-place", "menu-picture-hunt", "picture-shopping-list", "grocery-color-hunt", "tape-peeling-tray", "family-photo-stories"];
  for (const id of added) {
    const a = activities.find(x => x.id === id);
    assert.ok(a, id);
    assert.ok(a.image, `${id}: image`);
    assert.equal(a.zh?.materials?.length, a.materials.length, `${id}: materials`);
    assert.equal(a.zh?.steps?.length, a.steps.length, `${id}: steps`);
    assert.equal(a.zh?.domains?.length, a.domains.length, `${id}: domains`);
    assert.equal(Boolean(a.safety), withSafety.includes(id), `${id}: safety`);
    assert.equal(Boolean(a.zh?.safety), withSafety.includes(id), `${id}: zh safety`);
  }
  for (const s of ["waiting", "restaurant", "grocery", "airplane", "train"]) assert.ok(filter({ setting: s }, activities).length >= 5, s);
});
