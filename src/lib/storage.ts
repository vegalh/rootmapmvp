import { useCallback, useEffect, useRef, useState } from "react";

export type StorageFailure = "full" | "failed";

// App-level listeners told when a background write fails, so the parent always sees an error instead of
// believing a change was saved.
const listeners = new Set<(kind: StorageFailure) => void>();

export function onStorageError(listener: (kind: StorageFailure) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const isQuotaError = (e: unknown) =>
  e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22);

// Writes a raw string, returning why it failed instead of throwing.
function writeRaw(key: string, raw: string): StorageFailure | null {
  try {
    localStorage.setItem(key, raw);
    return null;
  } catch (e) {
    return isQuotaError(e) ? "full" : "failed";
  }
}

// Reads a plain-text (non-JSON) value such as the personal notes pad.
export function readText(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

// Writes a string and tells the app-level listeners if it fails. For values saved straight from an input.
export function storeText(key: string, value: string): boolean {
  const failure = writeRaw(key, value);
  if (failure) listeners.forEach(l => l(failure));
  return !failure;
}

// Copies an unreadable value aside before anything can overwrite it, so corrupted data is never destroyed.
function backupCorrupt(key: string, raw: string) {
  try {
    const existing = localStorage.getItem(`${key}.corrupt`);
    if (existing === raw) return;
    writeRaw(existing === null ? `${key}.corrupt` : `${key}.corrupt-${Date.now()}`, raw);
  } catch {
    // Storage unreadable; nothing more can be done here.
  }
}

// Parses stored JSON. Anything unparseable, or of a different shape than `fallback` (array vs. object vs.
// primitive), is backed up and reported as missing.
export function readStored<T>(key: string, fallback: T): { value: T; raw: string | null } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return { value: fallback, raw: null };
  }
  if (raw === null) return { value: fallback, raw: null };
  try {
    const parsed = JSON.parse(raw);
    const sameShape = parsed !== null && Array.isArray(parsed) === Array.isArray(fallback) && typeof parsed === typeof fallback;
    if (sameShape) return { value: parsed as T, raw };
  } catch {
    // fall through
  }
  backupCorrupt(key, raw);
  return { value: fallback, raw: null };
}

// Persists state to localStorage under `key`, syncing on every change. A failed background write is reported
// through `onStorageError`. `commit` writes synchronously first and only updates state when the write succeeds,
// for saves that show a success message.
export function useStored<T>(key: string, initial: T) {
  const [loaded] = useState(() => readStored(key, initial));
  const [value, setValue] = useState<T>(loaded.value);
  // Last JSON known to be in storage; nothing is written until the value actually changes, so an unreadable
  // stored value is never replaced by the default on load.
  const written = useRef(loaded.raw ?? JSON.stringify(loaded.value));

  useEffect(() => {
    const json = JSON.stringify(value);
    if (json === written.current) return;
    const failure = writeRaw(key, json);
    if (failure) listeners.forEach(l => l(failure));
    else written.current = json;
  }, [key, value]);

  const commit = useCallback((next: T): StorageFailure | null => {
    const json = JSON.stringify(next);
    const failure = writeRaw(key, json);
    if (failure) return failure;
    written.current = json;
    setValue(next);
    return null;
  }, [key]);

  return [value, setValue, commit] as const;
}

// Writes JSON to localStorage, returning false instead of throwing when storage is full or unavailable.
export function tryStore(key: string, value: unknown): boolean {
  return !writeRaw(key, JSON.stringify(value));
}
