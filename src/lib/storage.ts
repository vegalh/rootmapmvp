// localStorage primitives and storage error reporting. The app itself reads and writes through the data layer
// (src/lib/data); localStorage is only used directly as the pre-migration source and the fallback backend.

export type StorageFailure = "full" | "failed";

// App-level listeners told when a background write fails, so the parent always sees an error instead of
// believing a change was saved.
const listeners = new Set<(kind: StorageFailure) => void>();

export function onStorageError(listener: (kind: StorageFailure) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function reportStorageError(kind: StorageFailure) {
  listeners.forEach(l => l(kind));
}

export const isQuotaError = (e: unknown) =>
  e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22);

// Writes a raw string, returning why it failed instead of throwing.
export function writeRaw(key: string, raw: string): StorageFailure | null {
  try {
    localStorage.setItem(key, raw);
    return null;
  } catch (e) {
    return isQuotaError(e) ? "full" : "failed";
  }
}

// Copies an unreadable value aside before anything can overwrite it, so corrupted data is never destroyed.
export function backupCorrupt(key: string, raw: string) {
  try {
    const existing = localStorage.getItem(`${key}.corrupt`);
    if (existing === raw) return;
    writeRaw(existing === null ? `${key}.corrupt` : `${key}.corrupt-${Date.now()}`, raw);
  } catch {
    // Storage unreadable; nothing more can be done here.
  }
}
