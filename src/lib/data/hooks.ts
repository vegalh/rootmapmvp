import { useCallback, useMemo, useRef, useState } from "react";
import { reportStorageError, type StorageFailure } from "../storage";
import { applyChanges, diffCollection } from "./records";
import { defaults, getCollection, readSetting, write, type Change } from "./store";
import type { CollectionName, Collections } from "./schema";

// React bindings for the data layer. They mirror the old localStorage hook: screens get plain arrays and
// values, `set` updates at once and saves in the background (a failure is reported, see onStorageError), and
// `commit` resolves to null only after the change is stored, for saves that show a confirmation.

const seedIds: Partial<Record<CollectionName, Set<string>>> = {
  children: new Set(defaults.children.map(x => x.id)),
  records: new Set(defaults.records.map(x => x.id)),
  observations: new Set(defaults.observations.map(x => x.id)),
};
// Records created while the app runs are the parent's, except bundled demo items merged in by id.
const originFor = (name: CollectionName) => (r: { id: string }) => (seedIds[name]?.has(r.id) ? "demo" as const : "user" as const);

export function useCollection<K extends CollectionName>(name: K) {
  type T = Collections[K];
  const [all, setAll] = useState<T[]>(() => getCollection(name));
  // Latest records, including changes not rendered yet, so quick successive updates build on each other.
  const latest = useRef(all);
  const items = useMemo(() => all.filter(r => !r.deletedAt), [all]);
  // Soft-deleted records (for children: the Recently Deleted list).
  const deleted = useMemo(() => all.filter(r => r.deletedAt), [all]);

  const apply = useCallback((changed: T[]) => {
    latest.current = applyChanges(latest.current, changed);
    setAll(latest.current);
  }, []);

  const set = useCallback((next: T[] | ((current: T[]) => T[])) => {
    const visible = latest.current.filter(r => !r.deletedAt);
    const target = typeof next === "function" ? next(visible) : next;
    const changed = diffCollection(latest.current, target, new Date().toISOString(), originFor(name));
    if (!changed.length) return;
    apply(changed);
    void write({ collections: { [name]: changed } }).then(failure => { if (failure) reportStorageError(failure); });
  }, [name, apply]);

  // `also` is written in the same transaction (e.g. clearing the draft a new entry was written from).
  const commit = useCallback(async (next: T[], also?: Omit<Change, "collections">): Promise<StorageFailure | null> => {
    const changed = diffCollection(latest.current, next, new Date().toISOString(), originFor(name));
    if (!changed.length && !also) return null;
    const failure = await write({ ...also, collections: { [name]: changed } }, { rollback: true });
    if (!failure) apply(changed);
    return failure;
  }, [name, apply]);

  return { items, deleted, set, commit };
}

export function useSetting<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readSetting(key, fallback));
  const latest = useRef(value);
  const set = useCallback((next: T | ((current: T) => T)) => {
    const v = typeof next === "function" ? (next as (current: T) => T)(latest.current) : next;
    if (JSON.stringify(v) === JSON.stringify(latest.current)) return;
    latest.current = v;
    setValue(v);
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
