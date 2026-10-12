import type { KeyValueStore, Platform } from "./index";

// Website adapters.

// Session keys live under their own prefix. It deliberately does not start with "rootmap-": that prefix marks the
// app's legacy data keys, which the localStorage migration and backups read.
export const SESSION_PREFIX = "rootmap.session:";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// localStorage-backed session storage. A storage that can't be read counts as "no session"; a failed save is
// reported to the caller (Supabase Auth then keeps the session in memory for this visit).
export function webSessionStore(storage: () => StorageLike = () => localStorage): KeyValueStore {
  return {
    async getItem(key) {
      try { return storage().getItem(SESSION_PREFIX + key); } catch { return null; }
    },
    async setItem(key, value) {
      storage().setItem(SESSION_PREFIX + key, value);
    },
    async removeItem(key) {
      try { storage().removeItem(SESSION_PREFIX + key); } catch { /* nothing stored */ }
    },
  };
}

// Hands a file to the browser's download manager. Runs synchronously, so a refusal throws to the caller at once.
function saveFile(fileName: string, blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoking immediately can cancel the download in some browsers.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return Promise.resolve();
}

export const webPlatform = (): Omit<Platform, "kind"> => ({ sessionStore: webSessionStore(), saveFile });
