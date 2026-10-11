import type { JournalDraft } from "../types";
import { tryStore } from "./storage";

// Unsaved journal editor state lives under one localStorage key, keyed by "<childId>:<entryId|new>".
// Drafts never touch published entries; they are only applied when the parent taps Save.
const KEY = "rootmap-journal-drafts";

export const draftKey = (childId: string, entryId?: string) => `${childId}:${entryId || "new"}`;

function readAll(): Record<string, JournalDraft> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

export function readDraft(key: string): JournalDraft | undefined {
  return readAll()[key];
}

// Stores (or with `null`, clears) a draft. Returns false when storage is full.
export function writeDraft(key: string, draft: JournalDraft | null): boolean {
  const all = readAll();
  if (draft) all[key] = draft;
  else delete all[key];
  return tryStore(KEY, all);
}
