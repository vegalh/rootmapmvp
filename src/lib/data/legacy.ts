import type { Child, EntryDraft, LessonRecord, Observation, SyncMeta } from "../../types";
import {
  COLLECTIONS, LEGACY_DELETED_CHILDREN_KEY, LEGACY_DRAFTS_KEY, LEGACY_KEYS,
  hasShape, settingShape, type ArchiveItem, type CollectionName, type Collections, type PhotoMeta,
} from "./schema";

// Turns the pre-IndexedDB localStorage data (or a backup file, which has the same keys) into IndexedDB records.
// Pure: no browser storage is touched here, so it can be tested in isolation. Nothing in the input is modified.

// What the app showed when a collection had never been written: the bundled demo data.
export type Defaults = { children: Child[]; records: LessonRecord[]; observations: Observation[]; saved: string[] };

export type LegacySource = {
  // Parsed values by key; "text" settings hold the raw string.
  values: Record<string, unknown>;
  // Stored values that could not be read (or other RootMap keys with no place in the new layout), kept verbatim.
  unplaced: { key: string; raw: string; reason: string }[];
};

export type Built = {
  collections: { [K in CollectionName]: Collections[K][] };
  settings: Record<string, unknown>;
  drafts: Record<string, EntryDraft>;
  photos: { meta: PhotoMeta; blob: Blob }[];
  archive: ArchiveItem[];
  warnings: string[];
};

export type BuildOptions = {
  // UTC timestamp used for updatedAt where a legacy record has none (the moment of migration).
  now: string;
  defaults: Defaults;
  // Move inline data-URL images into the photo store (IndexedDB) or leave them in place (localStorage mode).
  extractPhotos: boolean;
  newPhotoId: () => string;
  // Set by the migration; a restore from backup leaves it out.
  migratedAt?: string;
  photoSource: PhotoMeta["source"];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";

// Keys that are device signals, not data.
const SIGNAL_KEYS = new Set(["rootmap-restored-at", "rootmap-data-store", "rootmap-draft-rescue"]);

function expectedShape(key: string) {
  if (Object.values(LEGACY_KEYS).includes(key) || key === LEGACY_DELETED_CHILDREN_KEY) return "array" as const;
  if (key === LEGACY_DRAFTS_KEY) return "object" as const;
  return settingShape(key);
}

// Reads every RootMap key. A value is accepted only if it parses and has the shape the app expects, exactly as
// the app itself decided (lib/storage.ts readStored); anything else is set aside verbatim for the archive.
export function readLegacyStorage(storage: Storage): LegacySource {
  const values: Record<string, unknown> = {};
  const unplaced: LegacySource["unplaced"] = [];
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith("rootmap-") && !SIGNAL_KEYS.has(key)) keys.push(key);
  }
  for (const key of keys) {
    const raw = storage.getItem(key);
    if (raw === null) continue;
    const shape = expectedShape(key);
    if (!shape) {
      unplaced.push({ key, raw, reason: key.includes(".corrupt") ? "earlier-unreadable-copy" : "unrecognized-key" });
      continue;
    }
    if (shape === "text") { values[key] = raw; continue; }
    try {
      const value = JSON.parse(raw);
      if (hasShape(value, shape)) { values[key] = value; continue; }
    } catch {
      // falls through to unplaced
    }
    unplaced.push({ key, raw, reason: "unreadable" });
  }
  return { values, unplaced };
}

// Decodes a data URL into a Blob holding the exact same bytes (no re-encoding, so no quality loss).
export function dataUrlToBlob(url: string): Blob | null {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) return null;
  const header = url.slice(5, comma);
  const body = url.slice(comma + 1);
  const base64 = /;base64$/i.test(header);
  const type = (base64 ? header.slice(0, -7) : header).split(";")[0] || "application/octet-stream";
  try {
    if (base64) {
      const bin = atob(body.replace(/\s/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type });
    }
    return new Blob([new TextEncoder().encode(decodeURIComponent(body))], { type });
  } catch {
    return null;
  }
}

const USER_ID = /^(c|r|t|m|p|g)-(\d{12,}|[0-9a-f]{8}-)/;

export function buildFromLegacy(source: LegacySource, opt: BuildOptions): Built {
  const { now, defaults } = opt;
  const archive: ArchiveItem[] = [];
  const warnings: string[] = [];
  const archiveTag = opt.migratedAt ? "migration" : "restore";
  const keep = (from: string, reason: string, value: unknown) =>
    archive.push({ id: `${archiveTag}:${now}:${archive.length + 1}`, source: from, reason, value, archivedAt: now });
  for (const u of source.unplaced) keep(u.key, u.reason, u.raw);

  // Inline images become photo records; the same image used twice (e.g. an entry and its edit draft) is stored once.
  const photoIds = new Map<string, string>();
  const photos: Built["photos"] = [];
  const photo = (ref: unknown, where: string): unknown => {
    if (!opt.extractPhotos || !str(ref) || !ref.startsWith("data:")) return ref;
    const known = photoIds.get(ref);
    if (known) return known;
    const blob = dataUrlToBlob(ref);
    if (!blob) {
      warnings.push(`${where}: an image could not be decoded and was kept inline`);
      return ref;
    }
    const id = opt.newPhotoId();
    photoIds.set(ref, id);
    photos.push({
      meta: { id, mimeType: blob.type, byteSize: blob.size, width: null, height: null, createdAt: null, updatedAt: now, deletedAt: null, source: opt.photoSource, storagePath: null, uploadedAt: null },
      blob,
    });
    return id;
  };

  const seed = {
    children: new Set(defaults.children.map(x => x.id)),
    records: new Set(defaults.records.map(x => x.id)),
    observations: new Set(defaults.observations.map(x => x.id)),
  };
  // Only labels a record when its id says so reliably; everything else is "unknown" rather than a guess.
  const originOf = (name: CollectionName, id: string): NonNullable<SyncMeta["origin"]> => {
    if ((name === "children" || name === "records" || name === "observations") && seed[name].has(id)) return "demo";
    if (name === "entries" && id.startsWith("obs-")) return seed.observations.has(id.slice(4)) ? "demo" : "unknown";
    if (name === "entries" && id.startsWith("notes-")) return seed.children.has(id.slice(6)) ? "unknown" : "user";
    return USER_ID.test(id) ? "user" : "unknown";
  };

  const stamp = (name: CollectionName, item: Obj, position: number, deletedAt: string | null) => ({
    ...item,
    createdAt: str(item.createdAt) ? item.createdAt : null,
    updatedAt: str(item.updatedAt) ? item.updatedAt : now,
    deletedAt,
    origin: item.origin === "demo" || item.origin === "user" || item.origin === "unknown" ? item.origin : originOf(name, str(item.legacyId) ? item.legacyId : (item.id as string)),
    ...(opt.migratedAt ? { migratedAt: opt.migratedAt } : {}),
    position,
  });

  // The list a collection showed: its stored value, or the built-in default when absent or unreadable.
  const listFor = (name: CollectionName): unknown[] => {
    const key = LEGACY_KEYS[name];
    if (key in source.values) return source.values[key] as unknown[];
    if (name === "children") return defaults.children;
    if (name === "records") return defaults.records;
    if (name === "observations") return defaults.observations;
    if (name === "saved") return defaults.saved;
    return [];
  };

  // Valid, uniquely keyed items. Two different records sharing one id are both kept: the later one gets a
  // suffixed id and remembers the original in `legacyId`. An exact repeat of a record is the same data and is dropped.
  const unique = (from: string, items: unknown[]): Obj[] => {
    const seen = new Map<string, string>();
    const out: Obj[] = [];
    for (const item of items) {
      if (!isObj(item) || !str(item.id) || !item.id) { keep(from, "invalid-record", item); continue; }
      const json = JSON.stringify(item);
      let rec = item;
      const prior = seen.get(item.id);
      if (prior !== undefined) {
        if (prior === json) { warnings.push(`${from}: exact duplicate of ${item.id} skipped`); continue; }
        let n = 2;
        while (seen.has(`${item.id}~${n}`)) n++;
        rec = { ...item, id: `${item.id}~${n}`, legacyId: item.id };
        warnings.push(`${from}: two different records shared id ${item.id}; the second is now ${rec.id}`);
      }
      seen.set(rec.id as string, json);
      out.push(rec);
    }
    return out;
  };

  const collections = {} as Built["collections"];
  for (const name of COLLECTIONS) {
    const from = LEGACY_KEYS[name];
    if (name === "saved") {
      const ids: string[] = [];
      for (const id of listFor("saved")) {
        if (!str(id)) keep(from, "invalid-record", id);
        else if (!ids.includes(id)) ids.push(id);
      }
      const fromDefault = !(from in source.values);
      collections.saved = ids.map((id, i) => ({
        id, createdAt: null, updatedAt: now, deletedAt: null,
        origin: fromDefault ? "demo" : defaults.saved.includes(id) ? "unknown" : "user",
        ...(opt.migratedAt ? { migratedAt: opt.migratedAt } : {}),
        position: i,
      }));
      continue;
    }
    const items = unique(from, listFor(name)).map(item => {
      if (name === "children") return { ...item, photo: photo(item.photo, `${from}/${item.id}`) };
      if (name === "entries") {
        // An entry without a photo list could not be shown at all; an empty list is the faithful repair.
        const list = Array.isArray(item.photos) ? item.photos.filter(str) : [];
        return { ...item, photos: list.map((p, i) => photo(p, `${from}/${item.id}#${i}`)) };
      }
      return item;
    });
    (collections as Record<string, unknown[]>)[name] = items.map((item, i) => stamp(name, item, i, null));
  }

  // Removed profiles join `children` as soft-deleted records, keeping their id, photo and deletion time.
  const activeIds = new Set(collections.children.map(c => c.id));
  const deleted = new Map<string, Obj>();
  for (const d of (source.values[LEGACY_DELETED_CHILDREN_KEY] as unknown[] | undefined) || []) {
    if (!isObj(d) || !str(d.id) || !d.id) { keep(LEGACY_DELETED_CHILDREN_KEY, "invalid-record", d); continue; }
    // Restored already (the old two-step restore could leave the snapshot behind): the live profile wins.
    if (activeIds.has(d.id)) { keep(LEGACY_DELETED_CHILDREN_KEY, "snapshot-of-active-child", d); continue; }
    const other = deleted.get(d.id);
    if (other) {
      const newer = String(d.deletedAt || "") > String(other.deletedAt || "") ? d : other;
      keep(LEGACY_DELETED_CHILDREN_KEY, "older-deleted-snapshot", newer === d ? other : d);
      deleted.set(d.id, newer);
      continue;
    }
    deleted.set(d.id, d);
  }
  let position = collections.children.length;
  for (const d of deleted.values()) {
    const deletedAt = str(d.deletedAt) ? d.deletedAt : now;
    if (!str(d.deletedAt)) warnings.push(`${LEGACY_DELETED_CHILDREN_KEY}/${d.id}: no deletion time, migration time used`);
    collections.children.push(stamp("children", { ...d, photo: photo(d.photo, `${LEGACY_DELETED_CHILDREN_KEY}/${d.id}`) }, position++, deletedAt) as unknown as Child);
  }

  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source.values)) {
    if (!settingShape(key)) continue;
    settings[key] = key === "rootmap-profile" && isObj(value) ? { ...value, photo: photo(value.photo, key) } : value;
  }

  const drafts: Record<string, EntryDraft> = {};
  for (const [key, d] of Object.entries((source.values[LEGACY_DRAFTS_KEY] as Obj | undefined) || {})) {
    if (!isObj(d)) { keep(LEGACY_DRAFTS_KEY, "invalid-draft", { key, value: d }); continue; }
    drafts[key] = {
      ...(d as Partial<EntryDraft>),
      ...(str(d.childId) ? { childId: d.childId } : {}),
      date: str(d.date) ? d.date : now.slice(0, 10),
      title: str(d.title) ? d.title : "",
      text: str(d.text) ? d.text : "",
      photos: (Array.isArray(d.photos) ? d.photos.filter(str) : []).map((p, i) => photo(p, `${LEGACY_DRAFTS_KEY}/${key}#${i}`) as string),
      savedAt: str(d.savedAt) ? d.savedAt : "",
    };
  }

  return { collections, settings, drafts, photos, archive, warnings };
}
