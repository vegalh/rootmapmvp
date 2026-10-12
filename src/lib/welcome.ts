import { getCollection, readSetting } from "./data/store";
import { COLLECTIONS } from "./data/schema";

// Whether this device still has to see the Welcome screen (Phase 2B-2 M2). Only builds with cloud features ask:
// the public website opens straight into RootMap, as it always has.
//
// "pending": a new device, shown Welcome until the parent signs in or continues without an account.
// "done":    the parent has made that choice. Existing devices are never marked; they simply never qualify.
export const WELCOME_KEY = "rootmap-welcome";
export type WelcomeState = "" | "pending" | "done";

// A device that has already used RootMap: the app has run here before (it records the seed version on its first
// start), or the parent has added something of their own. Demo content alone doesn't count.
export function hasLocalHistory(): boolean {
  if (readSetting<number>("rootmap-seed-version", 0) > 0) return true;
  return COLLECTIONS.some(name => getCollection(name).some(r => r.origin === "user"));
}

// The rule itself, kept pure for the tests.
export function welcomeDecision(state: WelcomeState, hasHistory: () => boolean): "show" | "skip" {
  if (state === "pending") return "show";
  if (state === "done") return "skip";
  return hasHistory() ? "skip" : "show";
}

// Decided once at start-up, before the app records its first run.
export const welcomeAtStart = () => welcomeDecision(readSetting<WelcomeState>(WELCOME_KEY, ""), hasLocalHistory);
