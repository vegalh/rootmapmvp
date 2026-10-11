import type { EntryDraft } from "../types";
import { readStored, tryStore } from "./storage";

// Unsaved editor state lives under one localStorage key, keyed by "<childId>:<entryId|new>".
// Drafts never touch published entries; they are only applied when the parent taps Save.
const KEY = "rootmap-journal-drafts";

export const draftKey = (childId: string, entryId?: string) => `${childId}:${entryId || "new"}`;

// An unreadable drafts value is backed up (see readStored) before the next write replaces it.
function readAll(): Record<string, EntryDraft> {
  return readStored<Record<string, EntryDraft>>(KEY, {}).value;
}

export function readDraft(key: string): EntryDraft | undefined {
  return readAll()[key];
}

// Most recent unfinished new entry for any of `childIds`, so the Moments page can offer to continue it.
export function latestNewDraft(childIds: string[]): { childId: string; draft: EntryDraft } | undefined {
  return Object.entries(readAll())
    .filter(([k]) => k.endsWith(":new") && childIds.includes(k.slice(0, -4)))
    .map(([k, draft]) => ({ childId: k.slice(0, -4), draft }))
    .sort((a, b) => b.draft.savedAt.localeCompare(a.draft.savedAt))[0];
}

// Stores (or with `null`, clears) a draft. Returns false when storage is full.
export function writeDraft(key: string, draft: EntryDraft | null): boolean {
  const all = readAll();
  if (draft) all[key] = draft;
  else delete all[key];
  return tryStore(KEY, all);
}
