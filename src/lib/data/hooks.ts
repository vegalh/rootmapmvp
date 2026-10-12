import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { reportStorageError, type StorageFailure } from "../storage";
import { diffCollection } from "./records";
import { defaults, publishedCollection, publishedSetting, subscribe, write, type Change } from "./store";
import type { CollectionName, Collections } from "./schema";

// React bindings for the data layer. They mirror the old localStorage hook: screens get plain arrays and
// values, `set` updates at once and saves in the background (a failure is reported, see onStorageError), and
// `commit` resolves to null only after the change is stored, for saves that show a confirmation.
//
// Screens read the store's published state, so a change made anywhere (another screen, a restore, a future
// cloud sync calling `write`) appears on every mounted screen without a reload.

const seedIds: Partial<Record<CollectionName, Set<string>>> = {
  children: new Set(defaults.children.map(x => x.id)),
  records: new Set(defaults.records.map(x => x.id)),
  observations: new Set(defaults.observations.map(x => x.id)),
};
// Records created while the app runs are the parent's, except bundled demo items merged in by id.
const originFor = (name: CollectionName) => (r: { id: string }) => (seedIds[name]?.has(r.id) ? "demo" as const : "user" as const);

export function useCollection<K extends CollectionName>(name: K) {
  type T = Collections[K];
  const getSnapshot = useCallback(() => publishedCollection(name), [name]);
  const all = useSyncExternalStore(subscribe, getSnapshot);
  const items = useMemo(() => all.filter(r => !r.deletedAt), [all]);
  // Soft-deleted records (for children: the Recently Deleted list).
  const deleted = useMemo(() => all.filter(r => r.deletedAt), [all]);

  // Changes are worked out against the published records, which already include earlier `set` calls that have
  // not rendered yet, so quick successive updates build on each other.
  const set = useCallback((next: T[] | ((current: T[]) => T[])) => {
    const current = publishedCollection(name);
    const visible = current.filter(r => !r.deletedAt);
    const target = typeof next === "function" ? next(visible) : next;
    const changed = diffCollection(current, target, new Date().toISOString(), originFor(name));
    if (!changed.length) return;
    void write({ collections: { [name]: changed } }).then(failure => { if (failure) reportStorageError(failure); });
  }, [name]);

  // `also` is written in the same transaction (e.g. clearing the draft a new entry was written from).
  const commit = useCallback(async (next: T[], also?: Omit<Change, "collections">): Promise<StorageFailure | null> => {
    const changed = diffCollection(publishedCollection(name), next, new Date().toISOString(), originFor(name));
    if (!changed.length && !also) return null;
    return write({ ...also, collections: { [name]: changed } }, { rollback: true });
  }, [name]);

  return { items, deleted, set, commit };
}

export function useSetting<T>(key: string, fallback: T) {
  // The first fallback is kept, so a literal passed on every render (e.g. `[]`) doesn't count as a change.
  const fallbackRef = useRef(fallback);
  const getSnapshot = useCallback(() => publishedSetting(key, fallbackRef.current), [key]);
  const value = useSyncExternalStore(subscribe, getSnapshot);
  const set = useCallback((next: T | ((current: T) => T)) => {
    const current = publishedSetting(key, fallbackRef.current);
    const v = typeof next === "function" ? (next as (current: T) => T)(current) : next;
    if (JSON.stringify(v) === JSON.stringify(current)) return;
    void write({ settings: [[key, v]] }).then(failure => { if (failure) reportStorageError(failure); });
  }, [key]);
  return [value, set] as const;
}

// Saves a setting outside React state (e.g. the notes pad, saved on every keystroke). Resolves to whether it was
// stored; a failure is also reported.
export async function saveSetting(key: string, value: unknown): Promise<boolean> {
  const failure = await write({ settings: [[key, value]] });
  if (failure) reportStorageError(failure);
  return !failure;
}
