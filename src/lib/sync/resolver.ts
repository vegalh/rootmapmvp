import type { Row, SyncedCollection } from "./mapping";

// Conflict resolution (docs/data-architecture-phase2.md, section 6). Pure.
//
// Three versions of one record, as client rows (mapping.ts): `base`, the last version this device and the server
// agreed on (null if the device never had one, e.g. an id that already existed on the server); `local`, this
// device's version; `server`, the server's current version. The result is the version both sides should hold,
// plus every version that lost something, which sync keeps in `record_versions`. Nothing is dropped silently.

export type LoserReason = "field_conflict" | "text_conflict" | "edited_after_delete";
export type Resolution = { merged: Row; losers: { version: Row; reason: LoserReason }[] };

// Long text: when both sides changed it, the server's version stays and the local one is kept as a version.
const LONG_TEXT: Partial<Record<SyncedCollection, string[]>> = {
  children: ["notes"],
  records: ["notes", "next_steps", "notes_zh"],
  entries: ["title", "text", "text_zh"],
  plans: ["note", "observation"],
  goals: ["description"],
};
// Bookkeeping that never makes a conflict on its own: display time and display order.
const QUIET = new Set(["updated_at", "position"]);
const IDENTITY = new Set(["id", "created_at", "origin", "legacy_id", "migrated_at"]);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isDeleted = (r: Row | null) => !!r?.deleted_at;

// Content fields that differ between two versions (bookkeeping excluded).
function changed(from: Row | null, to: Row): string[] {
  return Object.keys(to).filter(k => !QUIET.has(k) && k !== "deleted_at" && !IDENTITY.has(k) && (from === null || !same(from[k], to[k])));
}

export function resolve(collection: SyncedCollection, base: Row | null, local: Row, server: Row): Resolution {
  const losers: Resolution["losers"] = [];
  const later = (a: unknown, b: unknown) => (String(a ?? "") > String(b ?? "") ? a : b);

  // Deleted on one side, edited on the other: it stays deleted; the edited version is kept.
  const localDeleted = isDeleted(local) && !isDeleted(base);
  const serverDeleted = isDeleted(server) && !isDeleted(base);
  if (localDeleted !== serverDeleted && base !== null) {
    if (localDeleted) {
      const serverEdits = changed(base, server);
      if (serverEdits.length) losers.push({ version: server, reason: "edited_after_delete" });
      return { merged: { ...server, deleted_at: local.deleted_at, updated_at: later(local.updated_at, server.updated_at) }, losers };
    }
    const localEdits = changed(base, local);
    if (localEdits.length) losers.push({ version: local, reason: "edited_after_delete" });
    return { merged: server, losers };
  }

  // Field by field: a field changed on one side only takes that side; changed on both, the server's value stays.
  const merged: Row = { ...server };
  let lostText = false, lostField = false;
  for (const k of Object.keys(local)) {
    const localChanged = base === null ? !same(local[k], server[k]) : !same(base[k], local[k]);
    const serverChanged = base === null ? true : !same(base[k], server[k]);
    if (!localChanged) continue;
    if (!serverChanged || same(local[k], server[k])) { merged[k] = local[k]; continue; }
    // Both changed, to different values.
    if (k === "updated_at") { merged[k] = later(local[k], server[k]); continue; }
    if (k === "position" || IDENTITY.has(k)) continue; // server's
    if (k === "photo_ids") {
      // Both kept: the local order first, then what the server added.
      const l = (local[k] as string[]) ?? [], s = (server[k] as string[]) ?? [], b = (base?.[k] as string[]) ?? [];
      const removedHere = new Set(b.filter(id => !l.includes(id)));
      merged[k] = [...l, ...s.filter(id => !l.includes(id) && !removedHere.has(id))];
      continue;
    }
    if (k === "deleted_at") { merged[k] = server[k]; continue; } // deleted on both sides: the server's time
    if (LONG_TEXT[collection]?.includes(k)) lostText = true;
    else lostField = true;
  }
  if (lostText) losers.push({ version: local, reason: "text_conflict" });
  else if (lostField) losers.push({ version: local, reason: "field_conflict" });
  return { merged, losers };
}

// True when a resolution leaves the server's version unchanged (nothing to send back).
export const sameContent = (a: Row, b: Row) => Object.keys({ ...a, ...b }).every(k => k === "updated_at" || same(a[k], b[k]));
