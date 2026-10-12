import type { EntryDraft } from "../types";
import { allDrafts, readDraftValue, rescueDraft, write } from "./data/store";

// Unsaved editor state, one draft per "<childId>:<entryId|new>" (IndexedDB store "drafts", see lib/data).
// Drafts never touch published entries; they are only applied when the parent taps Save.

export const draftKey = (childId: string, entryId?: string) => `${childId}:${entryId || "new"}`;

export function readDraft(key: string): EntryDraft | undefined {
  return readDraftValue(key);
}

// Most recent unfinished new entry for any of `childIds`, so the Moments page can offer to continue it.
export function latestNewDraft(childIds: string[]): { childId: string; draft: EntryDraft } | undefined {
  return allDrafts()
    .filter(([k]) => k.endsWith(":new") && childIds.includes(k.slice(0, -4)))
    .map(([k, draft]) => ({ childId: k.slice(0, -4), draft }))
    .sort((a, b) => b.draft.savedAt.localeCompare(a.draft.savedAt))[0];
}

// Stores (or with `null`, clears) a draft. Resolves to false when it could not be stored.
export async function writeDraft(key: string, draft: EntryDraft | null): Promise<boolean> {
  return !(await write({ drafts: [[key, draft]] }));
}

// For a page that is being hidden or closed: also keeps a synchronous copy, in case the browser ends the page
// before the stored write finishes. The copy is applied on the next start only if it is the newer one.
export function flushDraft(key: string, draft: EntryDraft | null) {
  rescueDraft(key, draft);
  void writeDraft(key, draft);
}
