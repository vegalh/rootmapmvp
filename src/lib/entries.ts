import type { Child, Entry, Lang, Observation } from "../types";
import { localIsoToday } from "./dates";

// Entries are the one canonical collection of childhood memories (data layer collection "entries"; it was
// localStorage "rootmap-journal" before IndexedDB). Seed-version resets never touch it.
// Ids of legacy records already copied into the entries ("obs:<id>", "notes:<childId>"). Lets the import
// run on every load without duplicating, and keeps a deleted imported entry from coming back.
export const MIGRATED_KEY = "rootmap-migrated-legacy";

export const newestFirst = (a: Entry, b: Entry) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);

// Seed observations carry a Chinese translation; show it until the parent edits the text.
export const entryText = (e: Entry, lang: Lang) => (lang === "zh" && e.textZh ? e.textZh : e.text);

export function matchesQuery(e: Entry, query: string) {
  const q = query.trim().toLowerCase();
  return !q || [e.title, e.text, e.textZh].some(s => s?.toLowerCase().includes(q));
}

// Groups a shared moment (one entry per child, saved together by "Who is this moment about?" or a Quick Add with
// several children) back into a single card for display: entries with the same createdAt, date, title, text and
// photos (same ids, same order) are one group. Each group keeps only its first entry (in the input's order); every
// child in the group is listed in `childrenOf`, keyed by that kept entry's id. This is display-only — each child's
// own Journal/Moments list is built from their own, still-separate entry, and editing or deleting one child's copy
// never touches another's.
export function mergeShared(entries: Entry[]): { entries: Entry[]; childrenOf: Map<string, string[]> } {
  const groups = new Map<string, Entry[]>();
  const order: string[] = [];
  for (const e of entries) {
    const key = JSON.stringify([e.createdAt, e.date, e.title ?? "", e.text ?? "", e.photos]);
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
      order.push(key);
    }
    group.push(e);
  }
  const merged: Entry[] = [];
  const childrenOf = new Map<string, string[]>();
  for (const key of order) {
    const group = groups.get(key)!;
    merged.push(group[0]);
    childrenOf.set(group[0].id, group.map(e => e.childId));
  }
  return { entries: merged, childrenOf };
}

// Groups already-sorted entries into consecutive [YYYY-MM, entries] buckets.
export function groupByMonth(entries: Entry[]): [string, Entry[]][] {
  const groups: [string, Entry[]][] = [];
  for (const e of entries) {
    const month = e.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last[0] === month) last[1].push(e);
    else groups.push([month, [e]]);
  }
  return groups;
}

// Copies every legacy observation not yet imported into the entry collection. The observation itself is
// left in its own collection untouched. Returns null when there is nothing new to import.
export function importObservations(entries: Entry[], observations: Observation[], migrated: string[]) {
  const done = new Set(migrated);
  const ids = new Set(entries.map(e => e.id));
  const fresh = observations.filter(o => !done.has(`obs:${o.id}`) && !ids.has(`obs-${o.id}`));
  if (!fresh.length) return null;
  const imported: Entry[] = fresh.map(o => {
    // Observations have no timestamps; use their date so ordering within a day stays stable.
    const stamp = `${o.date}T12:00:00.000Z`;
    return {
      id: `obs-${o.id}`,
      childId: o.childId,
      date: o.date,
      text: o.notes || undefined,
      textZh: o.notesZh || undefined,
      photos: [],
      createdAt: stamp,
      updatedAt: stamp,
      legacyObservation: o,
    };
  });
  return {
    entries: [...entries, ...imported],
    migrated: [...migrated, ...fresh.map(o => `obs:${o.id}`)],
  };
}

// A child's legacy `notes` field is only offered (never auto-imported) until it has been saved once.
export function hasPendingNotes(child: Child, entries: Entry[], migrated: string[]) {
  return Boolean(child.notes?.trim()) && !migrated.includes(`notes:${child.id}`) && !entries.some(e => e.childId === child.id && e.fromNotes);
}

export function notesEntry(child: Child): Entry {
  const now = new Date().toISOString();
  return { id: `notes-${child.id}`, childId: child.id, date: localIsoToday(), text: child.notes?.trim(), photos: [], createdAt: now, updatedAt: now, fromNotes: true };
}
