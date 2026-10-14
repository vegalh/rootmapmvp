import { fmtMonthDay, localIsoDate } from "./dates";
import { initialObservations } from "../data/progress";
import type { Entry, LessonRecord } from "../types";

// Looking Back (Today) and the weekly recap: which of the parent's own Moments to bring back, and when. Pure, so the
// rules are tested on their own; screens pass in what they need from the store (e.g. whether a photo can be shown).

// "October 6 – October 12" / "10月6日 – 10月12日" for the Monday-to-Sunday week starting `week`.
export function weekRange(week: string, lang: "en" | "zh"): string {
  return `${fmtMonthDay(week, lang)} – ${fmtMonthDay(addDays(week, 6), lang)}`;
}

// A memory resurfaces on Today only once it is at least this many days old (by the device's calendar), so something
// recorded this week is never presented as "looking back".
export const MEMORY_MIN_AGE_DAYS = 7;

const asDate = (iso: string) => new Date(`${iso}T12:00:00`);

// `iso` moved by `days` calendar days, as "YYYY-MM-DD" (noon avoids daylight-saving edges).
export function addDays(iso: string, days: number): string {
  const d = asDate(iso);
  d.setDate(d.getDate() + days);
  return localIsoDate(d);
}

// The Monday that starts the week `iso` falls in.
export function weekStart(iso: string): string {
  return addDays(iso, -((asDate(iso).getDay() + 6) % 7));
}

// The memory the app made from a bundled demo observation, never edited by the parent: not the parent's own.
export function isDemoEntry(e: Entry): boolean {
  const seed = initialObservations.find(o => `obs-${o.id}` === e.id);
  return !!seed && (e.text || "") === seed.notes && !e.title && !e.photos.length;
}

// Old enough to look back on: about a day at least a week ago, and not written today (a Moment backdated a month a
// few minutes ago is still new to the parent). Dates are local calendar dates.
export function isPastMemory(item: { date: string; createdAt?: string | null }, today: string): boolean {
  if (item.date > addDays(today, -MEMORY_MIN_AGE_DAYS)) return false;
  if (!item.createdAt) return true;
  const created = new Date(item.createdAt);
  return Number.isNaN(created.getTime()) || localIsoDate(created) < today;
}

// Small stable string hash, so each local calendar day picks the same item all day long.
export function dayHash(day: string, salt: string): number {
  let h = 5381;
  for (const ch of `${salt}:${day}`) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function pickForDay<T extends { id: string }>(items: T[], day: string, salt: string): T | undefined {
  if (!items.length) return undefined;
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  return sorted[dayHash(day, salt) % sorted.length];
}

export type Memory =
  | { kind: "photo"; entry: Entry; photo: string }
  | { kind: "text"; entry: Entry }
  | { kind: "tried"; record: LessonRecord };

// Looking Back: a photo Moment, else a text Moment, else a tried activity, each at least a week old and for a child
// in My Children. Nothing when there is none: Today then leaves the section out.
// `canShowPhoto` says whether a photo can be displayed on this device; `hasActivity` whether a record's activity is
// still in the catalog (so the card always opens something).
export function pickMemory(entries: Entry[], records: LessonRecord[], childIds: string[], today: string, canShowPhoto: (photo: string) => boolean, hasActivity: (id?: string) => boolean): Memory | undefined {
  const known = new Set(childIds);
  const mine = entries.filter(e => known.has(e.childId) && !isDemoEntry(e) && isPastMemory(e, today));
  const firstPhoto = (e: Entry) => e.photos.find(canShowPhoto);
  const withPhoto = mine.filter(e => firstPhoto(e));
  if (withPhoto.length) {
    const entry = pickForDay(withPhoto, today, "memory")!;
    return { kind: "photo", entry, photo: firstPhoto(entry)! };
  }
  const withText = mine.filter(e => (e.title || e.text || "").trim());
  if (withText.length) return { kind: "text", entry: pickForDay(withText, today, "memory")! };
  const tried = records.filter(r => r.kind === "tried" && known.has(r.childId) && hasActivity(r.activityId) && isPastMemory(r, today));
  const record = pickForDay(tried, today, "memory");
  return record ? { kind: "tried", record } : undefined;
}

// ── Weekly recap ─────────────────────────────────────────────────────────────────────────────────────────────
// A look back over one week's Moments (Monday to Sunday). Only what the parent saved: no counts, scores or streaks.

// The parent's own Moments for children in My Children, optionally for one child.
export function recapEntries(entries: Entry[], childIds: string[], child?: string): Entry[] {
  const known = new Set(childIds);
  return entries.filter(e => known.has(e.childId) && (!child || e.childId === child) && !isDemoEntry(e) && (e.photos.length || (e.title || e.text || "").trim()));
}

// That week's Moments, oldest first.
export function weekEntries(entries: Entry[], week: string): Entry[] {
  const end = addDays(week, 7);
  return entries.filter(e => e.date >= week && e.date < end).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || "").localeCompare(b.createdAt || ""));
}

// A few Moments to feature, in the order they happened: the fullest ones (a photo and words, then a photo, then
// words), so the recap opens on what the parent took the most care to keep.
export function weekHighlights(week: Entry[], canShowPhoto: (photo: string) => boolean, count = 3): Entry[] {
  const richness = (e: Entry) => (e.photos.some(canShowPhoto) ? 2 : 0) + ((e.title || e.text || "").trim() ? 1 : 0);
  const chosen = new Set([...week].sort((a, b) => richness(b) - richness(a) || b.date.localeCompare(a.date)).slice(0, count).map(e => e.id));
  return week.filter(e => chosen.has(e.id));
}

// The week Today offers to revisit: last week when it has Moments (a week just finished), else this week so far;
// none when neither has any, so Today doesn't show the recap.
export function recapWeekForToday(entries: Entry[], today: string): string | undefined {
  const thisWeek = weekStart(today);
  const lastWeek = addDays(thisWeek, -7);
  if (weekEntries(entries, lastWeek).length) return lastWeek;
  if (weekEntries(entries, thisWeek).length) return thisWeek;
  return undefined;
}

// The earliest week with a Moment: the recap goes back no further.
export function firstRecapWeek(entries: Entry[]): string | undefined {
  const first = entries.reduce<string | undefined>((min, e) => (!min || e.date < min ? e.date : min), undefined);
  return first ? weekStart(first) : undefined;
}
