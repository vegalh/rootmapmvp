import { activities } from "../data/activities";
import { songs } from "../data/music";
import { activityAgeRanges, ageRangeForYears, findActivity, musicAsActivity, suitsAge } from "./catalog";
import { dayHash } from "./memories";
import type { Activity, Child, DiscoverCategory, LessonRecord, Plan } from "../types";
import type { Copy } from "./i18n";

// Today's idea for one child (pages/TodayPage.tsx): which activities fit the family's routine today, the day's few
// ideas ("Show me another"), "Again?" for something the child loved, and the interests their loved activities
// suggest. Pure, so the rules are tested on their own. Nothing here scores, counts or compares children.

// "When are you usually together?" (setting ROUTINE_KEY). Until the parent answers (or dismisses the question,
// which saves no routines) there is no `answeredAt`, and Today asks.
export type Routine = "cooking" | "after-dinner" | "bedtime" | "weekend-morning";
export const ROUTINES: Routine[] = ["cooking", "after-dinner", "bedtime", "weekend-morning"];
export const ROUTINE_KEY = "rootmap-routine";
export type RoutineSetting = { routines: Routine[]; answeredAt?: string };
export const NO_ROUTINE: RoutineSetting = { routines: [] };
export const isRoutine = (v: unknown): v is Routine => ROUTINES.includes(v as Routine);
// The routines chosen, in their usual order, whatever a stored value holds.
export const chosenRoutines = (s: RoutineSetting | undefined): Routine[] => (Array.isArray(s?.routines) ? ROUTINES.filter(r => s.routines.includes(r)) : []);

const asDate = (iso: string) => new Date(`${iso}T12:00:00`);
// Calendar days from `from` to `to` (local dates).
export const daysBetween = (from: string, to: string) => Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000);
const isWeekend = (iso: string) => [0, 6].includes(asDate(iso).getDay());
// Days since 1970-01-01, so consecutive days rotate through the routines in turn.
const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

const FOOD = "Food Preparation";
const BEDTIME_DOMAINS = ["Concentration", "Self-Regulation", "Listening"];
let songList: Activity[] | undefined;
const songActivities = () => (songList ??= songs.map(musicAsActivity));

// The activities that fit a routine moment, in catalog order. Only bedtime takes songs.
export function routinePool(routine: Routine, list: Activity[] = activities): Activity[] {
  if (routine === "cooking") return list.filter(a => a.topic === FOOD);
  if (routine === "after-dinner") return list.filter(a => !!a.settings?.includes("home") && a.minutes <= 15 && a.topic !== FOOD);
  if (routine === "bedtime") return [...list.filter(a => a.minutes <= 10 && a.domains.some(d => BEDTIME_DOMAINS.includes(d))), ...songActivities()];
  return list;
}

// Today's routine moment: one of those chosen, in turn day by day. Weekend mornings only on Saturday and Sunday.
export function routineForDay(routines: Routine[] | null | undefined, today: string): Routine | undefined {
  const fits = ROUTINES.filter(r => routines?.includes(r) && (r !== "weekend-morning" || isWeekend(today)));
  return fits.length ? fits[dayNumber(today) % fits.length] : undefined;
}

// Activities made for the child's own age first (a 4-month-old gets a 3–6 month activity, not a 9–12 month one),
// then any in the child's age filter; [] when none.
export function forAge(list: Activity[], years: number): Activity[] {
  const own = list.filter(a => suitsAge(a, years));
  if (own.length) return own;
  const range = ageRangeForYears(years);
  return list.filter(a => activityAgeRanges(a).includes(range));
}

// "Not today" keeps an activity out of the child's idea for 14 days, counting the day it was marked. Discover still
// lists it.
export const NOT_TODAY_DAYS = 14;
export function notTodayIds(records: LessonRecord[], childId: string, today: string): Set<string> {
  return new Set(records
    .filter(r => !r.deletedAt && r.childId === childId && r.activityId && r.enjoyed === "not-today")
    .filter(r => { const d = daysBetween(r.date, today); return d >= 0 && d < NOT_TODAY_DAYS; })
    .map(r => r.activityId!));
}

// What the child already has today: activities tried today, and those in today's plans for them (done or not).
export function doneOrPlannedToday(records: LessonRecord[], plans: Plan[], childId: string, today: string): Set<string> {
  return new Set([
    ...records.filter(r => !r.deletedAt && r.childId === childId && r.date === today && r.activityId).map(r => r.activityId!),
    ...plans.filter(p => !p.deletedAt && p.date === today && p.childIds.includes(childId)).map(p => p.activityId),
  ]);
}

// A per-day order for a list: dayHash mixed further, since dayHash alone keeps nearly the same order day after day.
function dayRank(today: string, key: string): number {
  let h = dayHash(today, key);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const easy = (a: Activity) => a.materialType === "none" || a.materialType === "everyday";

// The day's ideas from `pool` (up to `count`): the day's pick first (the same all day), then others that need nothing
// or everyday things, then the rest, in an order that changes day by day. Activities in `avoid` are skipped unless
// that would leave nothing.
export function dayIdeas(pool: Activity[], avoid: Set<string>, today: string, salt: string, count = 3): Activity[] {
  const open = pool.filter(a => !avoid.has(a.id));
  const list = open.length ? open : pool;
  if (!list.length) return [];
  const first = list[dayHash(today, salt) % list.length];
  const rest = list
    .filter(a => a.id !== first.id)
    .map(a => ({ a, rank: dayRank(today, `${salt}:${a.id}`) }))
    .sort((x, y) => Number(easy(y.a)) - Number(easy(x.a)) || x.rank - y.rank)
    .map(x => x.a);
  return [first, ...rest].slice(0, count);
}

// Bedtime: the calm activities and a few of the songs (different ones each day), so the 50 songs don't crowd out the
// activities. Only songs when there are no activities for the child's age.
export function fewSongs(pool: Activity[], today: string, salt: string): Activity[] {
  const isSong = (a: Activity) => a.id.startsWith("song-");
  const calm = pool.filter(a => !isSong(a));
  const songsToday = pool.filter(isSong).sort((a, b) => dayRank(today, `${salt}:${a.id}`) - dayRank(today, `${salt}:${b.id}`));
  return [...calm, ...songsToday.slice(0, calm.length ? Math.max(2, Math.ceil(calm.length / 3)) : songsToday.length)];
}

export type TodayIdeas = {
  // The routine moment the ideas fit (the heading says it); undefined = Today's Inspiration as before.
  routine?: Routine;
  ideas: Activity[];
  // Whether the ideas were chosen for the child's age (Today then labels the idea "For {name} · {age}").
  suited: boolean;
};

// Today's ideas for one child (or for nobody, without children). With a routine for today, from its activities for
// the child's age; when it has none for that age, Today's Inspiration as before. Never an activity the child tried
// or has planned today, or marked "Not today" in the last 14 days, while there is another.
export function todaysIdeas({ childId, years, routines, records, plans, today }: {
  childId?: string;
  years?: number;
  routines?: Routine[] | null;
  records: LessonRecord[];
  plans: Plan[];
  today: string;
}): TodayIdeas {
  const avoid = childId ? new Set([...doneOrPlannedToday(records, plans, childId, today), ...notTodayIds(records, childId, today)]) : new Set<string>();
  const salt = `activity:${childId ?? ""}`;
  const routine = routineForDay(routines, today);
  if (routine) {
    const pool = routinePool(routine);
    const fitting = years === undefined ? pool : forAge(pool, years);
    const mixed = routine === "bedtime" ? fewSongs(fitting, today, salt) : fitting;
    if (mixed.length) return { routine, ideas: dayIdeas(mixed, avoid, today, `${salt}:${routine}`), suited: years !== undefined };
  }
  const suited = years === undefined ? [] : forAge(activities, years);
  return { ideas: dayIdeas(suited.length ? suited : activities, avoid, today, salt), suited: suited.length > 0 };
}

// "Show me another": which of the day's ideas each child is on (setting IDEA_KEY). Only today's counts, so it
// starts again from the day's pick tomorrow. Device-only.
export const IDEA_KEY = "rootmap-today-idea";
export type IdeaChoice = { date: string; shown: Record<string, number> };
const childKey = (childId?: string) => childId ?? "";

export function shownIdea(choice: IdeaChoice | null | undefined, childId: string | undefined, today: string, count: number): number {
  if (!choice || choice.date !== today || !count) return 0;
  return Math.min(Math.max(0, choice.shown[childKey(childId)] ?? 0), count - 1);
}

// The next idea; once on the last, it stays there (Today then offers Discover instead).
export function showAnother(choice: IdeaChoice | null | undefined, childId: string | undefined, today: string, count: number): IdeaChoice {
  const shown = choice?.date === today ? { ...choice.shown } : {};
  shown[childKey(childId)] = Math.min(shownIdea(choice, childId, today, count) + 1, Math.max(0, count - 1));
  return { date: today, shown };
}

// "Again?": something the child loved 3 to 14 days ago and hasn't done since (on a later day, today included). The
// most recent one, unless it's in `exclude` (today's idea, or already planned or tried today).
export const AGAIN_DAYS = { from: 3, to: 14 };
export function againIdea(records: LessonRecord[], childId: string, today: string, exclude: Set<string> = new Set()): { record: LessonRecord; days: number } | undefined {
  const mine = records.filter(r => !r.deletedAt && r.childId === childId && r.activityId && findActivity(r.activityId));
  const loved = mine
    .map(record => ({ record, days: daysBetween(record.date, today) }))
    .filter(({ record, days }) => record.enjoyed === "loved" && days >= AGAIN_DAYS.from && days <= AGAIN_DAYS.to)
    .filter(({ record }) => !exclude.has(record.activityId!) && !mine.some(o => o.activityId === record.activityId && o.date > record.date))
    .sort((a, b) => a.days - b.days || (b.record.createdAt || "").localeCompare(a.record.createdAt || ""));
  return loved[0];
}

// What a child seems to enjoy, from the activities they loved: up to three, most often loved first (then most
// recent). Used only when the child has no interests of their own on their profile.
export type InterestKey = "cooking" | "home" | "independence" | "senses" | "words" | "nature" | "making" | "music" | "numbers" | "moving";
const TOPIC_INTEREST: Record<string, InterestKey> = {
  "Food Preparation": "cooking", "Everyday Life": "home", Independence: "independence", "Sensory Exploration": "senses",
  "Language Development": "words", Nature: "nature", Seasons: "nature", Creativity: "making",
};
const CATEGORY_INTEREST: Record<DiscoverCategory, InterestKey> = {
  "practical-life": "home", language: "words", math: "numbers", "art-creativity": "making", music: "music", "nature-culture": "nature", "sensory-movement": "moving",
};

export function lovedInterests(records: LessonRecord[], childId: string, limit = 3): InterestKey[] {
  const tally = new Map<InterestKey, { n: number; last: string }>();
  for (const r of records) {
    if (r.deletedAt || r.childId !== childId || r.enjoyed !== "loved") continue;
    const a = findActivity(r.activityId);
    if (!a) continue;
    const key = TOPIC_INTEREST[a.topic] ?? CATEGORY_INTEREST[a.category];
    const t = tally.get(key);
    tally.set(key, { n: (t?.n ?? 0) + 1, last: !t || r.date > t.last ? r.date : t.last });
  }
  return [...tally].sort(([, a], [, b]) => b.n - a.n || b.last.localeCompare(a.last)).slice(0, limit).map(([k]) => k);
}

// The child's interests as their card shows them: their own, else those their loved activities suggest.
export function childInterests(child: Pick<Child, "id" | "interests">, records: LessonRecord[]): { own: string[] } | { derived: InterestKey[] } {
  if (child.interests?.length) return { own: child.interests };
  return { derived: lovedInterests(records, child.id) };
}

// "Interested in: trains" / "Enjoys: cooking, sensory play", as the Kids card and the child's page show it; undefined
// when there is nothing yet.
export function interestsLine(child: Pick<Child, "id" | "interests">, records: LessonRecord[], t: Copy): { label: string; text: string } | undefined {
  const found = childInterests(child, records);
  if ("own" in found) return { label: t.interestedInLabel, text: found.own.join("、") };
  return found.derived.length ? { label: t.enjoysLabel, text: found.derived.map(k => t.interestNames[k]).join(t.nameJoin) } : undefined;
}
