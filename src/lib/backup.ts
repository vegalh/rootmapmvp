// Backup & Restore: a versioned JSON snapshot of the parent's RootMap data in localStorage.
// Framework-agnostic and dependency-free (it takes the Storage to use), so it can be tested outside the browser.

export const BACKUP_FORMAT = "rootmap-backup";
export const BACKUP_VERSION = 1;
// When this device last exported a backup. Device metadata, so it is never part of a backup itself.
export const LAST_BACKUP_KEY = "rootmap-last-backup";
// Bumped after a restore so other open RootMap tabs reload instead of writing stale data back.
export const RESTORED_AT_KEY = "rootmap-restored-at";

type Shape = "array" | "object" | "number" | "string" | "text";

// Every key a backup carries, with the JSON shape it must have. Anything else in localStorage (view
// preferences, notification read-state, `.corrupt` copies, other sites' data) is never exported or written.
// "text" values are stored raw (not JSON). A key absent from a backup was absent on the exporting device,
// and the app shows its default for it, so restoring removes it here too.
export const BACKUP_KEYS: Record<string, Shape> = {
  "rootmap-children": "array",
  "rootmap-deleted-children": "array",
  "rootmap-records": "array",
  "rootmap-observations": "array",
  "rootmap-journal": "array",
  "rootmap-journal-drafts": "object",
  "rootmap-migrated-legacy": "array",
  "rootmap-saved": "array",
  "rootmap-plans": "array",
  "rootmap-goals": "array",
  "rootmap-profile": "object",
  "rootmap-personal-notes": "text",
  "rootmap-language": "string",
  "rootmap-appearance": "string",
  "rootmap-seed-version": "number",
  "rootmap-seed-ids": "array",
};

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  // Parsed values keyed by storage key ("text" keys hold the raw string).
  data: Record<string, unknown>;
  // Integrity check over JSON.stringify(data); detects truncated or altered files.
  checksum: string;
};

export type BackupError = "notJson" | "notBackup" | "newerVersion" | "badVersion" | "corrupted" | "invalidData";

export type BackupSummary = { exportedAt: string; children: number; entries: number; photos: number; records: number; goals: number; plans: number };

// FNV-1a (32-bit), hex. Not cryptographic; it only has to catch accidental damage.
export function checksum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string";
const strs = (v: unknown) => Array.isArray(v) && v.every(str);

function hasShape(v: unknown, shape: Shape) {
  if (shape === "array") return Array.isArray(v);
  if (shape === "object") return isObj(v);
  if (shape === "number") return typeof v === "number" && Number.isFinite(v);
  return str(v);
}

// The fields the app relies on to render each collection; anything missing would crash or orphan data.
const itemChecks: Record<string, (x: Record<string, unknown>) => boolean> = {
  "rootmap-children": x => str(x.id) && str(x.first) && str(x.photo),
  "rootmap-deleted-children": x => str(x.id) && str(x.first),
  "rootmap-records": x => str(x.id) && str(x.childId) && str(x.date) && str(x.lesson),
  "rootmap-observations": x => str(x.id) && str(x.childId) && str(x.date),
  "rootmap-journal": x => str(x.id) && str(x.childId) && str(x.date) && strs(x.photos) && str(x.createdAt),
  "rootmap-plans": x => str(x.id) && str(x.activityId) && str(x.date) && strs(x.childIds),
  "rootmap-goals": x => str(x.id) && str(x.title) && typeof x.completed === "boolean",
};

function validData(data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    const shape = BACKUP_KEYS[key];
    if (!shape) continue; // ignored on restore
    if (!hasShape(value, shape)) return false;
    const check = itemChecks[key];
    if (check && !(value as unknown[]).every(x => isObj(x) && check(x))) return false;
  }
  if ("rootmap-profile" in data) {
    const p = data["rootmap-profile"] as Record<string, unknown>;
    if (!str(p.name) || !str(p.photo)) return false;
  }
  if ("rootmap-saved" in data && !strs(data["rootmap-saved"])) return false;
  if ("rootmap-language" in data && !["en", "zh"].includes(data["rootmap-language"] as string)) return false;
  return true;
}

// Reads every backed-up key from storage. The app only writes a value once it changes, so a key never written
// yet (e.g. untouched demo children) is taken from `shown`, what the app currently displays for it. Unreadable
// (non-JSON) stored values are left out rather than exported broken.
export function collectBackup(storage: Storage, now = new Date(), shown: Record<string, unknown> = {}): BackupFile {
  const data: Record<string, unknown> = {};
  for (const [key, shape] of Object.entries(BACKUP_KEYS)) {
    const raw = storage.getItem(key);
    if (raw === null) {
      if (key in shown && hasShape(shown[key], shape)) data[key] = shown[key];
      continue;
    }
    if (shape === "text") { data[key] = raw; continue; }
    try {
      const value = JSON.parse(raw);
      if (hasShape(value, shape)) data[key] = value;
    } catch {
      // skipped: see storage.ts, which keeps a `.corrupt` copy of such values
    }
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), data, checksum: checksum(JSON.stringify(data)) };
}

export function serializeBackup(backup: BackupFile) {
  return JSON.stringify(backup, null, 2);
}

// Parses and fully validates a backup file's text. Nothing is written; restore only accepts the result.
export function parseBackup(text: string): { ok: true; backup: BackupFile } | { ok: false; error: BackupError } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "notJson" };
  }
  if (!isObj(parsed) || parsed.format !== BACKUP_FORMAT) return { ok: false, error: "notBackup" };
  const { version, data, exportedAt } = parsed;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return { ok: false, error: "badVersion" };
  if (version > BACKUP_VERSION) return { ok: false, error: "newerVersion" };
  if (!isObj(data) || !str(exportedAt) || Number.isNaN(Date.parse(exportedAt as string))) return { ok: false, error: "corrupted" };
  if (parsed.checksum !== checksum(JSON.stringify(data))) return { ok: false, error: "corrupted" };
  if (!validData(data)) return { ok: false, error: "invalidData" };
  return { ok: true, backup: parsed as BackupFile };
}

export function summarize(backup: BackupFile): BackupSummary {
  const list = (key: string) => (backup.data[key] as Record<string, unknown>[] | undefined) || [];
  const entries = list("rootmap-journal");
  return {
    exportedAt: backup.exportedAt,
    children: list("rootmap-children").length,
    entries: entries.length,
    photos: entries.reduce((n, e) => n + (e.photos as string[]).length, 0),
    records: list("rootmap-records").length,
    goals: list("rootmap-goals").length,
    plans: list("rootmap-plans").length,
  };
}

const encode = (value: unknown, shape: Shape) => (shape === "text" ? (value as string) : JSON.stringify(value));

// Replaces every backed-up key with the backup's values, all or nothing. localStorage has no transactions, so:
// the current values are kept in memory, every write is read back and compared, and on any failure each touched
// key is first removed (freeing space) and then rewritten with its original value, which fitted before.
// Keys outside BACKUP_KEYS are never touched.
export function applyBackup(storage: Storage, backup: BackupFile): { ok: true } | { ok: false; rolledBack: boolean } {
  const keys = Object.keys(BACKUP_KEYS);
  const original = new Map<string, string | null>();
  try {
    for (const key of keys) original.set(key, storage.getItem(key));
  } catch {
    return { ok: false, rolledBack: true }; // nothing written yet
  }
  const touched: string[] = [];
  try {
    for (const key of keys) {
      touched.push(key);
      if (key in backup.data) {
        const next = encode(backup.data[key], BACKUP_KEYS[key]);
        storage.setItem(key, next);
        if (storage.getItem(key) !== next) throw new Error(`verify ${key}`);
      } else {
        storage.removeItem(key);
        if (storage.getItem(key) !== null) throw new Error(`verify ${key}`);
      }
    }
    return { ok: true };
  } catch {
    let rolledBack = true;
    for (const key of touched) {
      try { storage.removeItem(key); } catch { rolledBack = false; }
    }
    for (const key of touched) {
      const value = original.get(key);
      if (value === null || value === undefined) continue;
      try {
        storage.setItem(key, value);
        if (storage.getItem(key) !== value) rolledBack = false;
      } catch {
        rolledBack = false;
      }
    }
    return { ok: false, rolledBack };
  }
}

export const backupFileName = (prefix: string, now = new Date()) =>
  `${prefix}-${now.toISOString().slice(0, 19).replace(/[T:]/g, "-")}.json`;

// Hands a file to the browser's download manager. Throws if the browser refuses; browsers do not report
// whether the file was actually saved, so callers ask the parent to confirm when that matters.
export function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
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
}

// Builds a backup of the current data, checks it reads back as a valid backup, and downloads it.
// Throws (and downloads nothing) if any step fails.
export function exportBackup(storage: Storage, prefix: string, shown: Record<string, unknown> = {}): { backup: BackupFile; fileName: string } {
  const now = new Date();
  const backup = collectBackup(storage, now, shown);
  const text = serializeBackup(backup);
  const check = parseBackup(text);
  if (!check.ok) throw new Error(`backup self-check failed: ${check.error}`);
  const fileName = backupFileName(prefix, now);
  downloadText(fileName, text);
  return { backup, fileName };
}
