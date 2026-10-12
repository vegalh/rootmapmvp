import type { Child, Entry, EntryDraft, Goal, LessonRecord, Observation, Plan, SyncMeta } from "../../types";

// IndexedDB layout for RootMap's local data. See docs/data-architecture.md for the full picture.
//
// Each "space" is its own database (Phase 2B-2 M3), so one account's data can never be read from another's:
// - guest:   "rootmap", the database RootMap has always used. Its name and layout never change, and nothing done
//            while signed in writes to it.
// - account: "rootmap-account-<userId>", one per signed-in account on this device. Same stores, plus the outbox
//            (local changes waiting for sync) and per-record sync state.
export const DB_NAME = "rootmap";
export const DB_VERSION = 1;
export const ACCOUNT_DB_PREFIX = "rootmap-account-";
export const ACCOUNT_DB_VERSION = 1;

export type Space = { kind: "guest" } | { kind: "account"; userId: string };
export const GUEST: Space = { kind: "guest" };

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUserId = (value: unknown): value is string => typeof value === "string" && USER_ID.test(value);

export function databaseName(space: Space): string {
  if (space.kind === "guest") return DB_NAME;
  if (!isUserId(space.userId)) throw new Error("invalid account id");
  return ACCOUNT_DB_PREFIX + space.userId;
}

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
  // Whether this device still shows the Welcome screen (lib/welcome.ts). Device-only: not in backups.
  "rootmap-welcome": "string",
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
  // Sync (M4, M5): the SHA-256 of the bytes once computed, and when the server confirmed it holds them. A photo is
  // backed up only when `verifiedAt` is set.
  sha256?: string;
  verifiedAt?: string | null;
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
// Account spaces only.
export const ACCOUNT_STORES = ["outbox", "syncRecords"] as const;
export type StoreName = (typeof STORE_NAMES)[number] | (typeof ACCOUNT_STORES)[number];

// What sync uploads (Phase 2B-2 M4) is decided from the outbox, never from what the screens show. One entry per
// record with local changes not yet confirmed by the server, written in the same transaction as the record itself,
// so a record change and its outbox entry are stored together or not at all. Nothing is uploaded in M3.
// "versions": a version that lost a conflict found while downloading, waiting to be kept in record_versions.
export type OutboxCollection = CollectionName | "photos" | "versions";
export type OutboxEntry = {
  key: string; // "<collection>:<id>"
  collection: OutboxCollection;
  id: string;
  // "delete" = the record is soft-deleted (the server keeps a tombstone); "put" = created or changed.
  op: "put" | "delete";
  // Local order of changes on this device (increasing).
  seq: number;
  // When this record first had a change waiting, and when it last changed.
  queuedAt: string;
  changedAt: string;
  deviceId: string;
  // "versions" entries only: what to keep (see lib/sync).
  payload?: { table: string; recordId: string; version: Record<string, unknown>; baseRev: number | null; reason: string };
};
export const outboxKey = (collection: OutboxCollection, id: string) => `${collection}:${id}`;

// Per-record sync state, filled by sync (M4): the server revision and the last version both sides agreed on.
export type SyncRecord = { key: string; collection: OutboxCollection; id: string; rev: number; syncedAt: string; syncBase: Record<string, unknown> };

// The account space's own description, in "meta".
// `cursors`: per server table, the highest change number applied on this device (sync, M4).
export type SpaceMeta = { key: "space"; userId: string; deviceId: string; createdAt: string; familyId: string | null; cursor: number; cursors?: Record<string, number> };

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
