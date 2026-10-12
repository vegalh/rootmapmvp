import type { Child, Entry, EntryDraft, Goal, LessonRecord, Observation, Plan, SyncMeta } from "../../types";

// IndexedDB layout for RootMap's local data. See docs/data-architecture.md for the full picture.
export const DB_NAME = "rootmap";
export const DB_VERSION = 1;

// A saved Discover activity; the record id is the activity id.
export type SavedActivity = SyncMeta & { id: string };

// Record collections: one IndexedDB object store each, one record per item, keyed by `id`.
export type Collections = {
  children: Child;
  records: LessonRecord;
  observations: Observation;
  entries: Entry;
  plans: Plan;
  goals: Goal;
  saved: SavedActivity;
};
export type CollectionName = keyof Collections;
export type AnyRecord = Collections[CollectionName];

export const COLLECTIONS: CollectionName[] = ["children", "records", "observations", "entries", "plans", "goals", "saved"];
// Collections whose records belong to one child, indexed by `childId` for per-child queries.
export const CHILD_INDEXED: CollectionName[] = ["records", "observations", "entries"];

// The localStorage key each collection lived under before IndexedDB. The migration only ever reads these.
export const LEGACY_KEYS: Record<CollectionName, string> = {
  children: "rootmap-children",
  records: "rootmap-records",
  observations: "rootmap-observations",
  entries: "rootmap-journal",
  plans: "rootmap-plans",
  goals: "rootmap-goals",
  saved: "rootmap-saved",
};
// Legacy list of removed profiles; now soft-deleted records in `children`.
export const LEGACY_DELETED_CHILDREN_KEY = "rootmap-deleted-children";
export const LEGACY_DRAFTS_KEY = "rootmap-journal-drafts";

type Shape = "array" | "object" | "number" | "string" | "boolean" | "text";

// Settings and other single values are stored under their legacy localStorage key names, so both storage
// backends and the migration use the same keys. "text" values were stored raw rather than as JSON.
export const SETTING_SHAPES: Record<string, Shape> = {
  "rootmap-profile": "object",
  "rootmap-language": "string",
  "rootmap-appearance": "string",
  "rootmap-child-view": "string",
  "rootmap-child-filters": "object",
  "rootmap-seed-version": "number",
  "rootmap-seed-ids": "array",
  "rootmap-migrated-legacy": "array",
  "rootmap-last-backup": "string",
  "rootmap-personal-notes": "text",
  "rootmap-read-notifications": "array",
};
// Notification toggles ("rootmap-pref-<label>").
export const PREF_PREFIX = "rootmap-pref-";

export const settingShape = (key: string): Shape | undefined => SETTING_SHAPES[key] ?? (key.startsWith(PREF_PREFIX) ? "boolean" : undefined);

export function hasShape(value: unknown, shape: Shape) {
  if (shape === "array") return Array.isArray(value);
  if (shape === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  if (shape === "number") return typeof value === "number" && Number.isFinite(value);
  if (shape === "boolean") return typeof value === "boolean";
  return typeof value === "string";
}

// Image metadata, kept apart from the image bytes (store "photoBlobs") so lists of photos stay light.
// Shaped for a future private cloud bucket: `storagePath`/`uploadedAt` stay null until a photo is uploaded.
export type PhotoMeta = {
  id: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  // When the photo was added. null for photos copied out of legacy records (their original time is unknown).
  createdAt: string | null;
  updatedAt: string;
  deletedAt: string | null;
  source: "upload" | "migrated" | "restored";
  storagePath: string | null;
  uploadedAt: string | null;
};
export type PhotoBlob = { id: string; blob: Blob };

// Unsaved editor state, keyed "<childId>:<entryId|new>" (see lib/journalDrafts.ts). Drafts are device-local.
export type StoredDraft = EntryDraft & { key: string };
export type StoredSetting = { key: string; value: unknown; updatedAt: string };

// Anything the migration could not place safely (unreadable values, conflicting duplicates) is kept here
// instead of being dropped.
export type ArchiveItem = { id: string; source: string; reason: string; value: unknown; archivedAt: string };

export type MigrationMeta = {
  key: "migration";
  state: "complete";
  version: number;
  startedAt: string;
  completedAt: string;
  report: MigrationReport;
};
export type MigrationReport = { counts: Record<string, number>; photos: number; photoBytes: number; archived: number; warnings: string[] };

export const STORE_NAMES = [...COLLECTIONS, "photos", "photoBlobs", "drafts", "settings", "archive", "meta"] as const;
export type StoreName = (typeof STORE_NAMES)[number];

// Photo ids look like "photo-<uuid>"; anything else in a photo field is an image URL (bundled asset, remote
// image, or a legacy data URL that could not be converted) and is used as-is.
export const isPhotoId = (ref: unknown): ref is string => typeof ref === "string" && /^photo-[0-9a-f-]{36}$/.test(ref);

// RFC 4122 v4 UUID. crypto.randomUUID needs a secure context, which a LAN preview over http is not.
export function uuid(): string {
  if (typeof crypto.randomUUID === "function") {
    try { return crypto.randomUUID(); } catch { /* fall through */ }
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const newPhotoId = () => `photo-${uuid()}`;
// Stable, globally unique record id. The prefix keeps ids readable ("m-…" entry, "c-…" child).
export const newRecordId = (prefix: string) => `${prefix}-${uuid()}`;
