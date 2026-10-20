import { activities } from "../data/activities";
import { musicActivities } from "../data/music";
import defaultMusicCover from "../assets/music/cover-sage.svg";
import type { Activity, ActivitySetting, AgeRange, Book, DiscoverCategory, Lang, MaterialType, MusicActivity } from "../types";
import { categoryOptionLabel, copy, discoverCategoryLabel, topicOptionLabel, type Copy } from "./i18n";

// The one activity catalog: Discover activities (src/data/activities.ts) and Music activities (src/data/music.ts).
// Both live in one id space: a saved activity, a My Week plan or an activity record may refer to either, so
// screens resolve ids through `findActivity`, list them with `catalogItems` and search them with `searchCatalog`.
// Nothing else keeps a copy of activity titles or categories: adding an activity to either data file makes it
// appear everywhere (Discover, Add Activity, Recently Used, history).

export const AGE_RANGES: AgeRange[] = ["0–2", "2–3", "3–6", "6+"];

// "2–4 years" / "2–4岁", "4+ years" / "4岁+": the span covered by an item's age ranges.
export function agesLabel(ranges: AgeRange[], lang: Lang): string {
  const bounds = ranges.map(r => (r === "6+" ? [6, Infinity] : r.split("–").map(Number)));
  if (!bounds.length) return "";
  const low = Math.min(...bounds.map(b => b[0]));
  const high = Math.max(...bounds.map(b => b[1]));
  if (high === Infinity) return lang === "zh" ? `${low}岁+` : `${low}+ years`;
  return lang === "zh" ? `${low}–${high}岁` : `${low}–${high} years`;
}

export const matchesAge = (ranges: AgeRange[], age: string) => age === "All Ages" || ranges.includes(age as AgeRange);

// Case-insensitive search across both languages, so a parent can type an English or a Chinese title.
export const matchesQuery = (q: string, fields: (string | undefined)[]) => {
  const query = q.trim().toLowerCase();
  return !query || fields.some(f => f?.toLowerCase().includes(query));
};

// The cover to show for a music activity (its own image, or the default illustration).
export const musicCover = (m: MusicActivity) => m.coverImage || defaultMusicCover;

// Age filters an age span overlaps: 1–3 → 0–2 and 2–3; 2–6 → 2–3 and 3–6; 4+ → 3–6 and 6+. Spans and filters
// are read the same way, so an activity for ages 1–3 is listed under 0–2 as well as 2–3.
export function spanAgeRanges(from: number, to: number): AgeRange[] {
  return AGE_RANGES.filter(r => {
    const [low, high] = r === "6+" ? [6, Infinity] : r.split("–").map(Number);
    return from < high && to > low;
  });
}

// Age filters a book's recommended reading age overlaps (2–5 → 2–3 and 3–6; 4–6+ → 3–6 and 6+).
export function bookAgeRanges(b: Book): AgeRange[] {
  return spanAgeRanges(b.readingAge.from, b.readingAge.plus ? Infinity : b.readingAge.to);
}

// The ages an activity suits, from its age text ("1–3 years", "4+ years"); its `ageKey` when the text has no span.
export function activityAgeSpan(a: Pick<Activity, "age" | "ageKey">): [number, number] {
  const span = a.age.match(/(\d+)\s*[–-]\s*(\d+)/);
  if (span) return [Number(span[1]), Number(span[2])];
  const plus = a.age.match(/(\d+)\s*\+/) || a.ageKey.match(/(\d+)\s*\+/);
  if (plus) return [Number(plus[1]), Infinity];
  const key = a.ageKey.match(/(\d+)\s*[–-]\s*(\d+)/);
  return key ? [Number(key[1]), Number(key[2])] : [0, Infinity];
}

// Age filters an activity is listed under (overlapping, see spanAgeRanges).
export function activityAgeRanges(a: Pick<Activity, "age" | "ageKey">): AgeRange[] {
  return spanAgeRanges(...activityAgeSpan(a));
}

// The age filter that holds a child's current age (in years, fractional).
export function ageRangeForYears(years: number): AgeRange {
  return years < 2 ? "0–2" : years < 3 ? "2–3" : years < 6 ? "3–6" : "6+";
}

// Only the age filters that have something to show, in their usual order ("All Ages" first).
export function ageOptionsFor(rangesOfEach: AgeRange[][]): string[] {
  return ["All Ages", ...AGE_RANGES.filter(r => rangesOfEach.some(x => x.includes(r)))];
}

// "2–5 years" / "2–5岁", "4–6+ years" / "4–6+岁".
export function readingAgeLabel(b: Book, lang: Lang): string {
  const span = `${b.readingAge.from}–${b.readingAge.to}${b.readingAge.plus ? "+" : ""}`;
  return lang === "zh" ? `${span}岁` : `${span} years`;
}

// Display text and cover in the current language. Text falls back to English when a Chinese field is absent; the
// cover never does (each edition has its own design), so `cover` is undefined when that edition's is missing.
export function localizeBook(b: Book, t: Copy) {
  const zh = t.code === "zh";
  return {
    title: (zh && b.titleZh) || b.title,
    author: (zh && b.authorZh) || b.author,
    description: (zh && b.descriptionZh) || b.description,
    whyWeRecommend: (zh && b.whyWeRecommendZh) || b.whyWeRecommend,
    ages: readingAgeLabel(b, zh ? "zh" : "en"),
    cover: zh ? b.coverZh : b.coverEn,
  };
}

export function localizeMusic(m: MusicActivity, t: Copy) {
  const zh = t.code === "zh";
  return {
    title: (zh && m.titleZh) || m.title,
    description: (zh && m.descriptionZh) || m.description,
    howToPlay: (zh && m.howToPlayZh?.length ? m.howToPlayZh : m.howToPlay),
    whatChildrenExplore: (zh && m.whatChildrenExploreZh?.length ? m.whatChildrenExploreZh : m.whatChildrenExplore),
    ages: agesLabel(m.ageRanges, zh ? "zh" : "en"),
  };
}

export const findMusic = (id: string): MusicActivity | undefined => musicActivities.find(m => m.id === id);
export const isMusicId = (id: string | undefined) => !!id && musicActivities.some(m => m.id === id);

// A music activity in the shape the shared activity rows, plan and "Mark as Tried" sheets already render.
export function musicAsActivity(m: MusicActivity): Activity {
  return {
    id: m.id,
    title: m.title,
    age: agesLabel(m.ageRanges, "en"),
    ageKey: m.ageRanges[0] ?? "",
    area: "Music",
    topic: "",
    category: "art-creativity",
    minutes: m.duration,
    // "Optional" when a parent can just as well sing or call it out (see materialType in data/music.ts).
    materialsLabel: m.materialType === "none" ? "Optional audio guide" : "Audio guide",
    image: musicCover(m),
    description: m.description,
    domains: m.whatChildrenExplore,
    materials: [],
    steps: m.howToPlay,
    keywords: "",
    settings: m.settings,
    materialType: m.materialType,
    zh: {
      title: m.titleZh,
      age: agesLabel(m.ageRanges, "zh"),
      materialsLabel: m.materialType === "none" ? "可选音频引导" : "音频引导",
      description: m.descriptionZh,
      domains: m.whatChildrenExploreZh,
      steps: m.howToPlayZh,
    },
  };
}

// The Discover activity or music activity with this id.
export function findActivity(id: string | undefined): Activity | undefined {
  if (!id) return undefined;
  const activity = activities.find(a => a.id === id);
  if (activity) return activity;
  const music = findMusic(id);
  return music ? musicAsActivity(music) : undefined;
}

export type CatalogType = "activity" | "music";
// A catalog entry in the shared activity shape (music is converted with `musicAsActivity`, category Art & Creativity).
export type CatalogItem = Activity & { type: CatalogType };

// `extra` spread evenly through `main`, each list keeping its own order: with 61 and 5, one after every ~10. The
// same input always gives the same order.
export function spreadEvenly<T>(main: T[], extra: T[]): T[] {
  const out = [...main];
  extra.forEach((x, i) => out.splice(Math.round(((i + 1) * main.length) / (extra.length + 1)) + i, 0, x));
  return out;
}

let items: CatalogItem[] | undefined;
// Every activity and music activity, in Discover and Add Activity order: the data files' order, with music spread
// evenly through the activities rather than after them all.
export function catalogItems(): CatalogItem[] {
  items ??= spreadEvenly<CatalogItem>(
    activities.map(a => ({ ...a, type: "activity" as const })),
    musicActivities.map(m => ({ ...musicAsActivity(m), type: "music" as const })),
  );
  return items;
}

// The parent-facing categories (Discover's Category filter and Add Activity's chips), in their usual order. `inUse`
// keeps only categories with activities (filters never offer an empty one, so Math stays hidden until it has some);
// without it all six are offered (a custom activity's category).
export function catalogCategories({ inUse = false } = {}): DiscoverCategory[] {
  return inUse ? DISCOVER_CATEGORIES.filter(c => catalogItems().some(a => a.category === c)) : DISCOVER_CATEGORIES;
}

// Lower-case text a search query is matched against: titles, categories, topics, keywords, what children explore and
// materials, in English and Chinese whatever the interface language. Built once per activity.
const searchIndex = new Map<string, string>();
export function searchText(a: Activity): string {
  const cached = searchIndex.get(a.id);
  if (cached !== undefined) return cached;
  const music = musicActivities.find(m => m.id === a.id);
  const text = [
    a.title, a.zh?.title,
    a.area, discoverCategoryLabel(a.area, copy.en), discoverCategoryLabel(a.area, copy.zh),
    a.topic, a.topic && topicOptionLabel(a.topic, copy.zh),
    categoryOptionLabel(a.category, copy.en), categoryOptionLabel(a.category, copy.zh),
    a.keywords, a.zh?.keywords, music?.keywords, music?.keywordsZh,
    ...a.domains, ...(a.zh?.domains ?? []),
    ...a.materials, ...(a.zh?.materials ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
  searchIndex.set(a.id, text);
  return text;
}

// Case-insensitive, partial match; with several words, each must appear ("water pour").
export function matchesCatalogQuery(a: Activity, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = searchText(a);
  return words.every(w => text.includes(w));
}

// Discover's Category, Setting and Materials filters, in the order they're offered. "All" is the default of each.
export const DISCOVER_CATEGORIES: DiscoverCategory[] = ["practical-life", "language", "math", "art-creativity", "nature-culture", "sensory-movement"];
export const ACTIVITY_SETTINGS: ActivitySetting[] = ["home", "restaurant", "waiting", "airplane", "train", "walking", "park", "grocery"];
export const MATERIAL_TYPES: MaterialType[] = ["none", "everyday"];

// An activity without setting or materials metadata is only listed under "All".
export const matchesSetting = (a: Pick<Activity, "settings">, setting: string) => setting === "All" || !!a.settings?.includes(setting as ActivitySetting);
export const matchesMaterials = (a: Pick<Activity, "materialType">, materials: string) => materials === "All" || a.materialType === materials;

export type DiscoverFilters = { q: string; setting: string; age: string; category: string; materials: string };
export const DEFAULT_DISCOVER_FILTERS: DiscoverFilters = { q: "", setting: "All", age: "All Ages", category: "All", materials: "All" };

// Discover's Activities tab (activities and music, see catalogItems): search and every filter together, in catalog order.
export function filterDiscoverActivities<A extends Activity>(list: A[], f: DiscoverFilters): A[] {
  return list.filter(a =>
    matchesCatalogQuery(a, f.q) &&
    (f.age === "All Ages" || activityAgeRanges(a).includes(f.age as AgeRange)) &&
    (f.category === "All" || a.category === f.category) &&
    matchesSetting(a, f.setting) &&
    matchesMaterials(a, f.materials)
  );
}

// Catalog search shared by Discover and Add Activity: query and category together, title matches first.
export function searchCatalog(query: string, { category = "All", within = catalogItems() }: { category?: string; within?: CatalogItem[] } = {}): CatalogItem[] {
  const q = query.trim().toLowerCase();
  const found = within.filter(a => (category === "All" || a.category === category) && matchesCatalogQuery(a, q));
  if (!q) return found;
  const inTitle = (a: Activity) => a.title.toLowerCase().includes(q) || !!a.zh?.title?.toLowerCase().includes(q);
  return [...found.filter(inTitle), ...found.filter(a => !inTitle(a))];
}
