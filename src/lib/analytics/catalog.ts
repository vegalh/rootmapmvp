// The usage events RootMap may count (docs/data-architecture-phase2.md section 20). Each feature has an impression
// (it was shown, at most once per page visit) and a click (the parent used it). The server accepts exactly these
// keys: keep FEATURES in step with `features` in supabase/migrations/20261027000100_usage_analytics.sql (a unit
// test compares them). An event carries only its feature, its kind and a count: never a child, an activity id,
// text, a photo or a time.
export const FEATURES = [
  "today.inspiration", // impression: Today shown · click: Today's Inspiration opened
  "today.lookingBack", // impression: Looking Back shown on Today · click: a memory opened from it
  "discover.activities", // impression: Discover › Activities shown · click: an activity opened
  "discover.books", // impression: Discover › Books shown · click: a book opened
  "discover.collections", // impression: Discover › Collections shown · click: a collection opened
  "activity.detail", // impression: an activity or music page shown · click: any of its actions (save, My Week, tried)
  "activity.save", // impression: activity / music page shown · click: saved (not unsaved)
  "activity.addToWeek", // impression: activity / music page shown · click: Add to My Week
  "activity.markTried", // impression: activity / music page shown · click: Mark as Tried
  "music.play", // impression: music page shown · click: play
  "collection.save", // impression: collection page shown · click: collection saved
  "myWeek.saved", // impression: My Week shown · click: a saved activity or collection opened
  "moments.add", // impression: Moments shown · click: Capture a Moment
] as const;

export type Feature = (typeof FEATURES)[number];
export type UsageKind = "impression" | "click";

// Click rate = clicks ÷ impressions. null (shown as "—") when there were no impressions, or when either number is
// hidden as "<3" (null), since a rate would reveal it.
export function clickRate(clicks: number | null, impressions: number | null): number | null {
  if (clicks === null || impressions === null || impressions === 0) return null;
  return clicks / impressions;
}

// Average active time per person per day: total seconds ÷ person-days (admin_usage_summary's `time`). null when
// either is hidden or there were none.
export function secondsPerPerson(time: { seconds: number | null; personDays: number | null }): number | null {
  if (time.seconds === null || !time.personDays) return null;
  return time.seconds / time.personDays;
}
