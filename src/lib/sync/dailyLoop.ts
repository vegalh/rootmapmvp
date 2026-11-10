import type { SupabaseClient } from "@supabase/supabase-js";
import { chosenRoutines, type RoutineSetting } from "../todayIdeas";

// The daily loop's shared data (migration 20261110000100, docs/data-architecture-phase2.md section 21):
// - whether this server has it at all (`dailyLoopOnServer`): until it does, nothing new is sent or read, and
//   "enjoyed", Moment links and the routine stay on the device, exactly as before;
// - "Our routine", a family preference (table `family_settings`, key "routine"), synced like the parent's profile
//   (profile.ts): pull first; adopt what the server has if it changed since this device last saw it, otherwise push
//   this device's change. Whichever change reached the server first wins, without trusting device clocks. Only the
//   user's own family: someone who shares a child with another family never reads or writes that family's routine.

// The server row's value: the routines chosen and when the question was answered (dismissing it is an answer).
export type RoutineValue = { routines: string[]; answeredAt: string };

// Postgres and PostgREST codes for "no such table / column": the migration isn't on this server.
const MISSING = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

// Whether the server has the daily loop migration. Throws on any other error (offline, signed out), so the round's
// usual retry applies.
export async function dailyLoopOnServer(client: SupabaseClient): Promise<boolean> {
  const { error } = await client.from("family_settings").select("key").limit(0);
  if (!error) return true;
  if (MISSING.has(error.code ?? "")) return false;
  throw error;
}

// Only the parts that matter, in a fixed order, so the same answer always compares equal.
export function routineValue(s: RoutineSetting | undefined): RoutineValue | null {
  return s?.answeredAt ? { routines: chosenRoutines(s), answeredAt: s.answeredAt } : null;
}
const same = (a: RoutineValue | null, b: RoutineValue | null) => JSON.stringify(a) === JSON.stringify(b);

export type RoutineAction =
  | { kind: "adopt"; value: RoutineValue } // another device of the family changed it: use it here
  | { kind: "push"; value: RoutineValue } // only this device changed it: send it
  | { kind: "none" };

// Pure decision (tests/unit/daily-loop.test.ts). `known`: what this device last knew the server to hold (null before
// its first sync). No row on the server: this device's answer is sent, if it has one; nothing else is ever deleted.
export function nextRoutineAction(remote: RoutineValue | null, known: RoutineValue | null, current: RoutineValue | null): RoutineAction {
  if (remote && !same(remote, known)) return { kind: "adopt", value: remote };
  if (current && !same(current, remote)) return { kind: "push", value: current };
  return { kind: "none" };
}

export interface RoutineLocal {
  get(): RoutineSetting;
  set(next: RoutineSetting): void;
  known(): RoutineValue | null;
  setKnown(value: RoutineValue): void;
}

// A stored value as a routine, whatever it holds (a newer client may one day add fields; unknown routines are dropped).
function readValue(v: unknown): RoutineValue | null {
  const o = v as Partial<RoutineValue> | null;
  if (!o || typeof o.answeredAt !== "string" || !Array.isArray(o.routines)) return null;
  return routineValue({ routines: o.routines.filter((r): r is RoutineSetting["routines"][number] => typeof r === "string") as RoutineSetting["routines"], answeredAt: o.answeredAt });
}

// One round for the user's own family. Throws on a network or server error, like syncRound.
export async function syncRoutine(client: SupabaseClient, familyId: string, local: RoutineLocal): Promise<void> {
  const { data, error } = await client.from("family_settings").select("value").eq("family_id", familyId).eq("key", "routine").maybeSingle();
  if (error) throw error;
  const remote = data ? readValue(data.value) : null;
  const action = nextRoutineAction(remote, local.known(), routineValue(local.get()));
  if (action.kind === "adopt") {
    local.set({ routines: chosenRoutines(action.value as RoutineSetting), answeredAt: action.value.answeredAt });
    local.setKnown(action.value);
  } else if (action.kind === "push") {
    // An update when the row exists, else an insert. Two devices inserting at once: the second is refused (primary
    // key), and adopts the first one's answer on its next round.
    if (data) {
      const { error: e } = await client.from("family_settings").update({ value: action.value }).eq("family_id", familyId).eq("key", "routine");
      if (e) throw e;
    } else {
      const { error: e } = await client.from("family_settings").insert({ family_id: familyId, key: "routine", value: action.value });
      if (e) throw e;
    }
    local.setKnown(action.value);
  }
}
