import { findActivity } from "./catalog";
import type { Plan } from "../types";

// My Week plans as Today and Mark as Tried read them.

// Today's plan: the open (not completed) plans for `date` whose activity is still in the catalog, in the order they
// were added. With `childId`, only that child's.
export function todaysPlans(plans: Plan[], date: string, childId?: string): Plan[] {
  return plans.filter(p => !p.completed && p.date === date && (!childId || p.childIds.includes(childId)) && !!findActivity(p.activityId));
}

// The open plans that marking `activityId` as tried for `childIds` on `date` completes: those for that activity on
// that date that include one of the children.
export function plansTriedBy(plans: Plan[], activityId: string, childIds: string[], date: string): Plan[] {
  return plans.filter(p => !p.completed && p.activityId === activityId && p.date === date && p.childIds.some(id => childIds.includes(id)));
}

// The planning note Mark as Tried starts its Notes with ("" when no such plan has one).
export function plannedNote(plans: Plan[], activityId: string, childIds: string[], date: string): string {
  return plansTriedBy(plans, activityId, childIds, date).map(p => p.note?.trim()).find(Boolean) ?? "";
}
