import { useCallback, useState } from "react";

// State a page keeps while the app stays open: a page is unmounted when the parent opens another one, so plain
// `useState` would forget (say) Discover's search and filters by the time they come back from an activity.
// Kept in memory only: a reload or a new visit starts fresh. Not for anything personal or worth saving.
const kept = new Map<string, unknown>();

export function useKeptState<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => (kept.has(key) ? (kept.get(key) as T) : initial));
  const set = useCallback((next: T) => { kept.set(key, next); setValue(next); }, [key]);
  return [value, set];
}
