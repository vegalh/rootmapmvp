import { uuid } from "./schema";

// This device's id (Phase 2B-2 M3): one per browser profile (later, per iOS install), shared by every space on it.
// Sync records it with each change so the server can tell devices apart. Kept outside the spaces' databases, so
// creating it never writes to the guest database; the key deliberately doesn't start with "rootmap-" (that prefix
// marks the legacy data keys the migration and backups read).
export const DEVICE_KEY = "rootmap.device-id";

const DEVICE_ID = /^d-[0-9a-f-]{36}$/;
let cached: string | undefined;

export function deviceId(storage: Pick<Storage, "getItem" | "setItem"> | undefined = typeof localStorage !== "undefined" ? localStorage : undefined): string {
  if (cached) return cached;
  try {
    const stored = storage?.getItem(DEVICE_KEY);
    if (stored && DEVICE_ID.test(stored)) return (cached = stored);
  } catch {
    // unreadable: a new id below
  }
  const id = `d-${uuid()}`;
  try { storage?.setItem(DEVICE_KEY, id); } catch { /* kept for this visit only */ }
  return (cached = id);
}
