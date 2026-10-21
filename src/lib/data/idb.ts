import { ACCOUNT_DB_VERSION, CHILD_INDEXED, COLLECTIONS, DB_VERSION, GUEST, databaseName, type Space } from "./schema";

// Minimal promise helpers over IndexedDB; no library needed for what RootMap does.

export const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

// Resolves once the transaction has committed (data is on disk as far as the browser reports), rejects if it aborts.
export const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new DOMException("Transaction aborted", "AbortError"));
    tx.onerror = () => { /* reported through onabort */ };
  });

function upgrade(db: IDBDatabase, oldVersion: number, space: Space) {
  if (oldVersion < 1) {
    for (const name of COLLECTIONS.filter(n => n !== "savedCollections")) {
      const store = db.createObjectStore(name, { keyPath: "id" });
      if (CHILD_INDEXED.includes(name)) store.createIndex("childId", "childId");
      if (name === "plans") store.createIndex("childIds", "childIds", { multiEntry: true });
    }
    db.createObjectStore("photos", { keyPath: "id" });
    db.createObjectStore("photoBlobs", { keyPath: "id" });
    db.createObjectStore("drafts", { keyPath: "key" });
    db.createObjectStore("settings", { keyPath: "key" });
    db.createObjectStore("archive", { keyPath: "id" });
    db.createObjectStore("meta", { keyPath: "key" });
    if (space.kind === "account") {
      db.createObjectStore("outbox", { keyPath: "key" }).createIndex("seq", "seq");
      db.createObjectStore("syncRecords", { keyPath: "key" });
    }
  }
  if (oldVersion < 2) db.createObjectStore("savedCollections", { keyPath: "id" });
}

// Opens (creating or upgrading) a space's database; the guest database by default. Rejects instead of hanging if
// the browser never answers.
export function openDatabase(space: Space = GUEST, timeoutMs = 8000): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB unavailable")); return; }
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error("IndexedDB open timed out")); }, timeoutMs);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(databaseName(space), space.kind === "guest" ? DB_VERSION : ACCOUNT_DB_VERSION);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
      return;
    }
    req.onupgradeneeded = e => upgrade(req.result, e.oldVersion, space);
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      // Another tab is upgrading to a newer version: step aside so it isn't blocked.
      db.onversionchange = () => db.close();
      if (settled) db.close();
      else resolve(db);
    };
    req.onerror = () => { clearTimeout(timer); if (!settled) reject(req.error); };
  });
}

export const getAll = <T>(db: IDBDatabase, store: string) => request<T[]>(db.transaction(store).objectStore(store).getAll() as IDBRequest<T[]>);

// Opens a database only if it already exists, at its current version, for reading. A database that doesn't exist
// is not created: the open is cancelled before anything is written, and this resolves to null.
export function openExisting(name: string, timeoutMs = 8000): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    let creating = false;
    const timer = setTimeout(() => reject(new Error("IndexedDB open timed out")), timeoutMs);
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => { creating = true; req.transaction?.abort(); };
    req.onsuccess = () => { clearTimeout(timer); req.result.onversionchange = () => req.result.close(); resolve(req.result); };
    req.onerror = () => { clearTimeout(timer); if (creating) resolve(null); else reject(req.error); };
  });
}
