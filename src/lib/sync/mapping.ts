import type { Child, Entry, Goal, LessonRecord, Plan } from "../../types";
import { isPhotoId, type PhotoMeta, type SavedActivity, type SavedCollection } from "../data/schema";

// Local records ↔ server rows (Phase 2B-2 M4; docs/data-architecture-phase2.md, section 3). Pure.
//
// A "row" here holds only the client-owned columns of a table (never rev, change_seq, server_updated_at,
// updated_by, or the photo columns the server sets), so it can be sent, compared and kept as the last version
// both sides agreed on (`syncBase`). Converting a row back merges it onto the local record, so local-only fields
// survive a round trip.

export type SyncedCollection = "children" | "records" | "entries" | "plans" | "goals" | "saved" | "savedCollections" | "photos";
export type Table = "children" | "activity_records" | "entries" | "plans" | "goals" | "saved_activities" | "saved_collections" | "photos";
export type Row = Record<string, unknown>;

export const TABLE: Record<SyncedCollection, Table> = {
  children: "children", records: "activity_records", entries: "entries", plans: "plans", goals: "goals", saved: "saved_activities", savedCollections: "saved_collections", photos: "photos",
};
export const COLLECTION_OF = Object.fromEntries(Object.entries(TABLE).map(([c, t]) => [t, c])) as Record<Table, SyncedCollection>;
// Parents before the records that refer to them (photos ← children ← entries, records, plans).
export const SYNC_ORDER: SyncedCollection[] = ["photos", "children", "entries", "records", "plans", "goals", "saved", "savedCollections"];
export const isSyncedCollection = (c: string): c is SyncedCollection => c in TABLE;

// Columns that can't change after insert (sent on insert only).
export const INSERT_ONLY: Partial<Record<Table, string[]>> = { goals: ["owner_user_id"], photos: ["sha256", "mime_type", "byte_size"] };
// Written by the server, read by clients (e.g. a photo's verification). Not part of a row.
export const SERVER_COLUMNS = ["rev", "change_seq", "server_updated_at", "updated_by", "storage_path", "server_sha256", "verified_at"];

// The image a new child gets when the parent picks none (ModalOverlay). Stored on the server as a bundled key.
export const DEFAULT_CHILD_PHOTO = "https://images.unsplash.com/photo-1606386666595-d135abc1e3b2?auto=format&fit=crop&w=300&q=85";
const BUNDLED: Record<string, string> = { "bundled:default-child": DEFAULT_CHILD_PHOTO };
const bundledKey = (url: string) => Object.keys(BUNDLED).find(k => BUNDLED[k] === url);

const opt = <T>(v: T | undefined | null): T | null => (v === undefined || v === "" ? null : v);
const date = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const und = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
// Postgres returns timestamps in its own format; the app keeps ISO strings.
const iso = (v: unknown): string | null => (typeof v === "string" ? new Date(v).toISOString() : null);

type Meta = { createdAt?: string | null; updatedAt?: string; deletedAt?: string | null; origin?: string; position?: number; legacyId?: string; migratedAt?: string };
const metaToRow = (r: Meta) => ({
  created_at: r.createdAt ?? null,
  updated_at: r.updatedAt ?? new Date(0).toISOString(),
  deleted_at: r.deletedAt ?? null,
  origin: r.origin ?? null,
  position: r.position ?? null,
  legacy_id: r.legacyId ?? null,
  migrated_at: r.migratedAt ?? null,
});
const metaFromRow = (row: Row): Meta => ({
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at) ?? undefined,
  deletedAt: iso(row.deleted_at),
  origin: und(row.origin as Meta["origin"] | null),
  position: und(row.position as number | null),
  legacyId: und(row.legacy_id as string | null),
  migratedAt: und(iso(row.migrated_at)),
});

// Why a record can't be sent as it is (the server would refuse it). It stays on the device, marked "failed".
export class UnsyncableRecord extends Error {}

export function toRow(collection: SyncedCollection, r: Record<string, unknown>, ctx: { userId: string }): Row {
  const base = { id: r.id, ...metaToRow(r as Meta) };
  const need = (v: string | null, field: string) => {
    if (v === null) throw new UnsyncableRecord(`${collection} ${String(r.id)}: ${field} is missing or not a date`);
    return v;
  };
  switch (collection) {
    case "children": {
      const c = r as Child;
      const photo = c.photo || "";
      return { ...base, first: c.first ?? "", last: c.last ?? "", dob: date(c.dob), enrolled: opt(c.enrolled), enrolled_zh: opt(c.enrolledZh), lessons: c.lessons ?? null, group_name: opt(c.group), photo_ref: isPhotoId(photo) ? photo : bundledKey(photo) ?? null, notes: opt(c.notes), interests: c.interests ?? [] };
    }
    case "records": {
      const x = r as LessonRecord;
      return { ...base, child_id: x.childId, kind: x.kind === "tried" ? "tried" : "record", activity_id: opt(x.activityId), lesson: x.lesson ?? "", area: opt(x.area), stage: opt(x.stage), date: need(date(x.date), "date"), notes: opt(x.notes), next_steps: opt(x.nextSteps), skills: x.skills ?? [], notes_zh: opt(x.notesZh) };
    }
    case "entries": {
      const e = r as Entry;
      return { ...base, child_id: e.childId, date: need(date(e.date), "date"), title: opt(e.title), text: opt(e.text), text_zh: opt(e.textZh), photo_ids: (e.photos ?? []).filter(isPhotoId), from_notes: !!e.fromNotes, legacy: e.legacyObservation ?? null };
    }
    case "plans": {
      const p = r as Plan;
      return { ...base, activity_id: p.activityId, date: need(date(p.date), "date"), child_ids: p.childIds ?? [], note: opt(p.note), completed: !!p.completed, completed_date: date(p.completedDate), observation: opt(p.observation) };
    }
    case "goals": {
      const g = r as Goal;
      return { ...base, owner_user_id: ctx.userId, title: g.title ?? "", description: opt(g.description), completed: !!g.completed, completed_at: g.completedAt ?? null };
    }
    case "saved":
    case "savedCollections":
      return base;
    case "photos": {
      const p = r as PhotoMeta & { sha256?: string };
      if (!p.sha256) throw new UnsyncableRecord(`photo ${p.id}: no checksum yet`);
      return { ...base, mime_type: p.mimeType, byte_size: p.byteSize, width: p.width, height: p.height, sha256: p.sha256, uploaded_at: p.uploadedAt ?? null };
    }
  }
}

// The server row as a local record, on top of what the device has (local-only fields are kept).
export function fromRow(collection: SyncedCollection, row: Row, local: Record<string, unknown> | undefined): Record<string, unknown> {
  const base = { ...(local ?? {}), id: row.id, ...metaFromRow(row) };
  switch (collection) {
    case "children": {
      const ref = row.photo_ref as string | null;
      // A local image the server can't hold (e.g. a demo asset) stays as it is.
      const photo = ref === null ? (local?.photo as string | undefined) ?? DEFAULT_CHILD_PHOTO : (BUNDLED[ref] ?? ref);
      return { ...base, first: row.first, last: row.last, dob: row.dob ?? "", enrolled: row.enrolled ?? "", enrolledZh: und(row.enrolled_zh), lessons: row.lessons ?? 0, group: row.group_name ?? "", photo, notes: und(row.notes), interests: (row.interests as string[]).length || local?.interests ? row.interests : undefined };
    }
    case "records":
      return { ...base, childId: row.child_id, kind: row.kind === "tried" ? "tried" : undefined, activityId: und(row.activity_id), lesson: row.lesson, area: und(row.area), stage: und(row.stage), date: row.date, notes: und(row.notes), nextSteps: und(row.next_steps), skills: (row.skills as string[]).length || local?.skills ? row.skills : undefined, notesZh: und(row.notes_zh) };
    case "entries":
      return { ...base, childId: row.child_id, date: row.date, title: und(row.title), text: und(row.text), textZh: und(row.text_zh), photos: row.photo_ids, fromNotes: row.from_notes ? true : undefined, legacyObservation: und(row.legacy) };
    case "plans":
      return { ...base, activityId: row.activity_id, date: row.date, childIds: row.child_ids, note: und(row.note), completed: row.completed ? true : local && "completed" in local ? false : undefined, completedDate: und(row.completed_date), observation: und(row.observation) };
    case "goals":
      return { ...base, title: row.title, description: und(row.description), completed: !!row.completed, completedAt: und(iso(row.completed_at)) };
    case "saved":
    case "savedCollections":
      return base;
    case "photos":
      return { ...base, mimeType: row.mime_type, byteSize: Number(row.byte_size), width: row.width ?? null, height: row.height ?? null, sha256: row.sha256, uploadedAt: iso(row.uploaded_at), verifiedAt: iso(row.verified_at), source: (local?.source as string) ?? "upload", storagePath: (row.storage_path as string) ?? null };
  }
}

// The client-owned columns of a server row, normalised so the same content always compares equal: timestamps as
// ISO strings, and only the columns toRow produces.
export function clientRow(collection: SyncedCollection, row: Row): Row {
  const out: Row = {};
  const sample = SAMPLE_COLUMNS[collection];
  for (const k of sample) {
    let v = row[k] === undefined ? null : row[k];
    if (TIMESTAMP_COLUMNS.has(k) && typeof v === "string") v = new Date(v).toISOString();
    if (k === "byte_size" && v !== null) v = Number(v);
    out[k] = v;
  }
  return out;
}

const TIMESTAMP_COLUMNS = new Set(["created_at", "updated_at", "deleted_at", "migrated_at", "completed_at", "uploaded_at"]);
const META_COLUMNS = ["id", "created_at", "updated_at", "deleted_at", "origin", "position", "legacy_id", "migrated_at"];
const SAMPLE_COLUMNS: Record<SyncedCollection, string[]> = {
  children: [...META_COLUMNS, "first", "last", "dob", "enrolled", "enrolled_zh", "lessons", "group_name", "photo_ref", "notes", "interests"],
  records: [...META_COLUMNS, "child_id", "kind", "activity_id", "lesson", "area", "stage", "date", "notes", "next_steps", "skills", "notes_zh"],
  entries: [...META_COLUMNS, "child_id", "date", "title", "text", "text_zh", "photo_ids", "from_notes", "legacy"],
  plans: [...META_COLUMNS, "activity_id", "date", "child_ids", "note", "completed", "completed_date", "observation"],
  goals: [...META_COLUMNS, "owner_user_id", "title", "description", "completed", "completed_at"],
  saved: META_COLUMNS,
  savedCollections: META_COLUMNS,
  photos: [...META_COLUMNS, "mime_type", "byte_size", "width", "height", "sha256", "uploaded_at"],
};

// What to send: on insert every client column plus family_id; on update everything except the identity and the
// columns that can't change.
export function insertPayload(collection: SyncedCollection, row: Row, familyId: string): Row {
  return { ...row, family_id: familyId };
}
export function updatePayload(collection: SyncedCollection, row: Row): Row {
  const skip = new Set(["id", ...(INSERT_ONLY[TABLE[collection]] ?? [])]);
  return Object.fromEntries(Object.entries(row).filter(([k]) => !skip.has(k)));
}

// Photo ids a record needs on the server before it can be sent.
export function photoRefs(collection: SyncedCollection, row: Row): string[] {
  if (collection === "children") return isPhotoId(row.photo_ref) ? [row.photo_ref as string] : [];
  if (collection === "entries") return (row.photo_ids as string[]) ?? [];
  return [];
}

export type { Child, Entry, Goal, LessonRecord, Plan, PhotoMeta, SavedActivity, SavedCollection };
