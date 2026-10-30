import { areaLessons } from "../data/progress";
import { findActivity, isMusicId } from "./catalog";
import { categoryOptionLabel, learningAreaLabel, lessonLabel, localizeActivity, stageLabel, type Copy } from "./i18n";
import type { Activity, LessonRecord, Plan, Stage } from "../types";

// The one way an activity record is made, whichever screen it comes from: Add Activity (a catalog or a custom
// activity, with optional stage, notes and skills) and Mark as Tried (kind "tried": a catalog activity, a date
// and an optional note). See LessonRecord in types.ts for the record shapes.

export type RecordInput = {
  childId: string;
  date: string;
  kind?: "tried";
  // A catalog activity (Discover or Music)…
  activityId?: string;
  // …or the parent's own activity (Add Activity › Other / Custom Activity).
  customTitle?: string;
  customArea?: string;
  stage?: Stage;
  notes?: string;
  skills?: string[];
  // My Week: the plan this record completes (see LessonRecord.planId).
  planId?: string;
};

// What's missing when a record can't be built.
export type RecordProblem = "child" | "date" | "activity" | "name" | "area";

// `activeChildIds`: the children currently in My Children. When given, a record for any other id (a removed child,
// or one that never existed) is refused, so nothing is ever saved to a child the parent can't see.
export function buildActivityRecord(input: RecordInput, id: string, now: string, activeChildIds?: string[]): { record: LessonRecord } | { problem: RecordProblem } {
  if (!input.childId || (activeChildIds && !activeChildIds.includes(input.childId))) return { problem: "child" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { problem: "date" };
  let lesson: string;
  let activityId: string | undefined;
  let area: string | undefined;
  if (input.activityId) {
    const activity = findActivity(input.activityId);
    if (!activity) return { problem: "activity" };
    activityId = activity.id;
    // English title and category as they are today: shown only if the activity is later removed from Discover.
    lesson = activity.title;
    // Mark as Tried records keep their original shape (no area); the category is read from the catalog instead.
    // `area` stays the activity's learning area (the record's stored shape is unchanged); it's shown only if the
    // activity is later removed from the catalog. A custom activity stores the parent-facing category id chosen.
    area = input.kind === "tried" ? undefined : activity.area;
  } else {
    if (input.kind === "tried") return { problem: "activity" };
    lesson = input.customTitle?.trim() ?? "";
    if (!lesson) return { problem: "name" };
    area = input.customArea || undefined;
    if (!area) return { problem: "area" };
  }
  const notes = input.notes?.trim();
  const record: LessonRecord = {
    id,
    childId: input.childId,
    ...(input.kind ? { kind: input.kind } : {}),
    ...(activityId ? { activityId } : {}),
    lesson,
    ...(area ? { area } : {}),
    ...(input.stage ? { stage: input.stage } : {}),
    date: input.date,
    ...(notes ? { notes } : {}),
    ...(input.skills?.length ? { skills: input.skills } : {}),
    ...(input.planId ? { planId: input.planId } : {}),
    createdAt: now,
  };
  return { record };
}

export function problemMessage(problem: RecordProblem, t: Copy): string {
  return problem === "child" ? t.chooseChildFirst
    : problem === "date" ? t.chooseDateFirst
    : problem === "name" ? t.enterActivityName
    : problem === "area" ? t.chooseAreaFirst
    : t.activityUnavailable;
}

// A record made by the first Record form: no catalog link and one of its fixed lessons. Only these lesson names
// are translated; every other name (custom ones included) is shown exactly as stored.
const isLegacyLesson = (r: LessonRecord) => !r.activityId && !!r.area && !!areaLessons[r.area]?.includes(r.lesson);

export type RecordView = {
  title: string;
  // Localized learning area, when the record has one.
  area?: string;
  stage?: string;
  // The catalog activity, while it still exists.
  activity?: Activity;
  music: boolean;
};

// How a record reads in the child's history, never blank: the current (localized) catalog title and category
// while the activity exists, otherwise what the record stored.
export function recordView(r: LessonRecord, t: Copy): RecordView {
  const activity = findActivity(r.activityId);
  const stored = isLegacyLesson(r) ? lessonLabel(r.lesson, t) : r.lesson?.trim();
  const title = (activity && localizeActivity(activity, t).title) || stored || t.lessonActivityLabel;
  // Tried records have never shown a learning area. A catalog activity shows its current category, as Discover and
  // Add Activity do; otherwise the record's stored area (never rewritten) is shown.
  const area = r.kind === "tried" ? undefined : activity ? categoryOptionLabel(activity.category, t) : r.area && learningAreaLabel(r.area, t);
  return {
    title,
    area: area || undefined,
    stage: r.stage ? stageLabel(r.stage, t) : undefined,
    activity,
    music: isMusicId(r.activityId),
  };
}

// Catalog activities recorded most recently, without repeats: this child's first, then other children's.
// Derived from the records themselves; activities no longer in the catalog are skipped.
export function recentActivityIds(records: LessonRecord[], childId: string | undefined, limit = 4): string[] {
  const newest = [...records]
    .filter(r => r.activityId && !r.deletedAt && findActivity(r.activityId))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
  const ordered = [...newest.filter(r => r.childId === childId), ...newest.filter(r => r.childId !== childId)];
  return [...new Set(ordered.map(r => r.activityId!))].slice(0, limit);
}

// My Week › complete: the records a completed plan adds to its children's activity history, one per child still in
// My Children, dated `date`. A child who already has a record for this plan gets no second one, so completing
// twice (a double tap, or a retry after a failed save) never duplicates history. A child who already has a live
// record for this same activity on this same date (e.g. Mark as Tried earlier that day) also gets no second one;
// a record for another date, another activity, or one that's been deleted never blocks it.
export function planCompletionRecords(plan: Plan, records: LessonRecord[], activeChildIds: string[], date: string, now: string, newId: () => string): LessonRecord[] {
  const out: LessonRecord[] = [];
  for (const childId of new Set(plan.childIds)) {
    const already = records.some(r => !r.deletedAt && r.childId === childId
      && (r.planId === plan.id || (r.activityId === plan.activityId && r.date === date)));
    if (already) continue;
    const built = buildActivityRecord({ kind: "tried", childId, date, activityId: plan.activityId, planId: plan.id }, newId(), now, activeChildIds);
    if ("record" in built) out.push(built.record);
  }
  return out;
}
