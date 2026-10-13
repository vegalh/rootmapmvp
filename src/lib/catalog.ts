import { activities } from "../data/activities";
import { musicActivities } from "../data/music";
import defaultMusicCover from "../assets/music/cover-sage.svg";
import type { Activity, AgeRange, Book, Lang, MusicActivity } from "../types";
import type { Copy } from "./i18n";

// Lookups shared by Discover activities and Music activities. Both live in one id space: a saved activity, a
// My Week plan or a "Mark as Tried" record may refer to either, so screens resolve ids through `findActivity`.

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

// Display text in the current language; each Chinese field falls back to English when absent.
export function localizeBook(b: Book, t: Copy) {
  const zh = t.code === "zh";
  return {
    title: (zh && b.titleZh) || b.title,
    author: (zh && b.authorZh) || b.author,
    description: (zh && b.descriptionZh) || b.description,
    whyWeRecommend: (zh && b.whyWeRecommendZh) || b.whyWeRecommend,
    ages: agesLabel(b.ageRanges, zh ? "zh" : "en"),
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
