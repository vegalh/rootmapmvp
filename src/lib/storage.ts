import { useEffect, useState } from "react";

// Persists state to localStorage under `key`, syncing on every change.
export function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    // A full quota (e.g. many journal photos) must not crash the app; callers that care use `tryStore` first.
    tryStore(key, value);
  }, [key, value]);
  return [value, setValue] as const;
}

// Writes JSON to localStorage, returning false instead of throwing when storage is full or unavailable.
export function tryStore(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
