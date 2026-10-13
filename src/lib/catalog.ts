import { activities, categories } from "../data/activities";
import { musicActivities } from "../data/music";
import defaultMusicCover from "../assets/music/cover-sage.svg";
import type { Activity, AgeRange, Book, Lang, MusicActivity } from "../types";
import { copy, discoverCategoryLabel, topicOptionLabel, type Copy } from "./i18n";

// The one activity catalog: Discover activities (src/data/activities.ts) and Music activities (src/data/music.ts).
// Both live in one id space: a saved activity, a My Week plan or an activity record may refer to either, so
// screens resolve ids through `findActivity`, list them with `catalogItems` and search them with `searchCatalog`.
// Nothing else keeps a copy of activity titles or categories: adding an activity to either data file makes it
// appear everywhere (Discover, Add Activity, Recently Used, history).

export const AGE_RANGES: AgeRange[] = ["0–2", "2–3", "3–4", "4–6", "6+"];

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

// Age filters a book's recommended reading age overlaps (2–6 → 2–3, 3–4 and 4–6; 4–6+ → 4–6 and 6+).
export function bookAgeRanges(b: Book): AgeRange[] {
  const to = b.readingAge.plus ? Infinity : b.readingAge.to;
  return AGE_RANGES.filter(r => {
    const [low, high] = r === "6+" ? [6, Infinity] : r.split("–").map(Number);
    return b.readingAge.from < high && to > low;
  });
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
    minutes: m.duration,
    materialsLabel: "Audio guide",
    image: musicCover(m),
    description: m.description,
    domains: m.whatChildrenExplore,
    materials: [],
    steps: m.howToPlay,
    keywords: "",
    zh: {
      title: m.titleZh,
      age: agesLabel(m.ageRanges, "zh"),
      materialsLabel: "音频引导",
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
// A catalog entry in the shared activity shape (music is converted with `musicAsActivity`, category "Music").
export type CatalogItem = Activity & { type: CatalogType };

let items: CatalogItem[] | undefined;
// Every activity and music activity, in Discover order (activities first, then music).
export function catalogItems(): CatalogItem[] {
  items ??= [
    ...activities.map(a => ({ ...a, type: "activity" as const })),
    ...musicActivities.map(m => ({ ...musicAsActivity(m), type: "music" as const })),
  ];
  return items;
}

// Learning areas, from the Discover category list (its order), followed by any category an activity uses that
// the list doesn't name yet, so a new category is never hidden. `inUse` keeps only categories with activities
// (the picker's filters); without it every Discover category is offered (a custom activity's learning area).
export function catalogCategories({ inUse = false } = {}): string[] {
  const used = new Set(catalogItems().map(a => a.area).filter(Boolean));
  const listed = categories.map(c => c[0]);
  const all = [...listed, ...[...used].filter(c => !listed.includes(c))];
  return inUse ? all.filter(c => used.has(c)) : all;
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

// Catalog search shared by Discover and Add Activity: query and category together, title matches first.
export function searchCatalog(query: string, { category = "All", within = catalogItems() }: { category?: string; within?: CatalogItem[] } = {}): CatalogItem[] {
  const q = query.trim().toLowerCase();
  const found = within.filter(a => (category === "All" || a.area === category) && matchesCatalogQuery(a, q));
  if (!q) return found;
  const inTitle = (a: Activity) => a.title.toLowerCase().includes(q) || !!a.zh?.title?.toLowerCase().includes(q);
  return [...found.filter(inTitle), ...found.filter(a => !inTitle(a))];
}
