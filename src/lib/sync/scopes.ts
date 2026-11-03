import type { SupabaseClient } from "@supabase/supabase-js";
import { isScopedId, outboxKey, scopedId, unscope, type ArchiveItem, type OutboxEntry, type SyncRecord } from "../data/schema";
import { CHILD_COLLECTIONS, syncRound, type RoundResult, type SyncBatch, type SyncLocal } from "./engine";
import type { SyncedCollection } from "./mapping";
import type { PhotoLocal } from "./photos";

// Sync scopes for children shared from other families (Shared Child Profiles Phase 2a;
// docs/shared-child-profiles-phase2a.md).
//
// A signed-in user syncs their own family (the "home" scope, exactly as before) and, once sharing is switched on, one
// "shared" scope per other family that has shared children with them: only those children and their own records
// (Moments, activity records, the photos they show). Everything stays in the user's one account space on the device.
//
// Local identity. The server identifies a record by (family_id, id), and ids are unique only inside a family: the seed
// child "emma" exists in many families. The user's own family keeps its plain ids, so nothing already stored changes.
// A shared family's records are stored under `scopedId(familyId, id)`, and their child references (`childId`) the same
// way. The separator is a control character, which the server refuses in every id, so a scoped id can never equal an
// id of the user's own family or of another family. Photo ids are already global ("photo-<uuid>", unique across the
// bucket) and keep them; a shared photo carries its `familyId`.
//
// Switched off unless the build sets VITE_ROOTMAP_SHARED_SYNC to exactly "on": a development server for the browser
// tests, and the testers' website once the owner sets the repository variable of that name (deploy-pages.yml; the
// database needs the sharing migrations first, docs/shared-child-profiles-tester-rollout.md). Otherwise the app syncs
// only its own family, as before.
const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env;
export const sharedSyncEnabled = env?.VITE_ROOTMAP_SHARED_SYNC === "on";

export { isScopedId, scopedId, unscope };

export type Role = "owner" | "editor" | "viewer";
export type Membership = { familyId: string; childId: string; role: Role };

// ---- The account space, as scopes see it ----------------------------------------------------------------------

// What the scopes need from the account space beyond plain record sync (lib/data/store.ts in the app; tests/db's
// in-memory device in the tests).
export interface ScopeBase extends SyncLocal {
  meta(): ReturnType<SyncLocal["meta"]> & { scopeCursors?: Record<string, Record<string, number>>; scopes?: unknown };
  // The family a stored photo belongs to when it isn't the user's own (null or undefined: the user's own family).
  photoFamily(id: string): string | null | undefined;
}

const collectionOf = (key: string) => key.slice(0, key.indexOf(":")) as SyncedCollection | "versions";
const idOf = (key: string) => key.slice(key.indexOf(":") + 1);

// Which family an outbox entry belongs to; null for the user's own family.
function entryFamily(base: ScopeBase, e: OutboxEntry): string | null {
  if (e.collection === "photos") return base.photoFamily(e.id) ?? null;
  return unscope(e.id)?.familyId ?? null;
}

// The user's own family: everything except shared families' records. Identical to `base` while nothing is shared.
export function homeLocal(base: ScopeBase): SyncLocal {
  return {
    outbox: () => base.outbox().filter(e => entryFamily(base, e) === null),
    syncRecord: key => base.syncRecord(key),
    record: (collection, id) => base.record(collection, id),
    photoChecksum: id => base.photoChecksum(id),
    meta: () => { const m = base.meta(); return { familyId: m.familyId, cursors: m.cursors, deviceId: m.deviceId }; },
    commit: batch => base.commit(batch),
    refresh: () => base.refresh(),
  };
}

// A record from the server's point of view (plain ids) to how it is stored here, and back.
function toLocal(collection: string, record: Record<string, unknown>, familyId: string): Record<string, unknown> {
  if (collection === "photos") return { ...record, familyId };
  const out: Record<string, unknown> = { ...record, id: scopedId(familyId, String(record.id)), familyId };
  if (typeof record.childId === "string") out.childId = scopedId(familyId, record.childId);
  return out;
}
function toServer(collection: string, record: Record<string, unknown>): Record<string, unknown> {
  const { familyId: _f, ...rest } = record;
  if (collection === "photos") return rest;
  const out: Record<string, unknown> = { ...rest, id: unscope(String(record.id))?.id ?? record.id };
  if (typeof record.childId === "string") out.childId = unscope(record.childId)?.id ?? record.childId;
  return out;
}

// A key as the engine sees it in a shared family's scope ("entries:m-1") to the key stored here.
const localKeyIn = (familyId: string, key: string) => {
  const c = collectionOf(key);
  return c === "photos" ? key : outboxKey(c, scopedId(familyId, idOf(key)));
};

// One shared family as a single-family space for the sync engine: the engine sees plain ids, its own cursors, and only
// this family's entries; whatever it stores is translated back to scoped ids.
export function scopedLocal(base: ScopeBase, familyId: string): SyncLocal {
  const localKey = (key: string) => localKeyIn(familyId, key);
  const serverEntry = (e: OutboxEntry): OutboxEntry => (e.collection === "photos" ? e : { ...e, id: unscope(e.id)!.id, key: outboxKey(e.collection, unscope(e.id)!.id) });
  const localEntry = (e: OutboxEntry): OutboxEntry => (e.collection === "photos" ? e : { ...e, id: scopedId(familyId, e.id), key: outboxKey(e.collection, scopedId(familyId, e.id)) });
  return {
    outbox: () => base.outbox().filter(e => entryFamily(base, e) === familyId && (e.collection === "versions" || CHILD_COLLECTIONS.includes(e.collection as SyncedCollection))).map(serverEntry),
    syncRecord: key => {
      const sr = base.syncRecord(localKey(key));
      return sr && { ...sr, key, id: idOf(key) };
    },
    record: async (collection, id) => {
      const r = await base.record(collection, collection === "photos" ? id : scopedId(familyId, id));
      return r && toServer(collection, r);
    },
    photoChecksum: id => base.photoChecksum(id),
    meta: () => { const m = base.meta(); return { familyId, cursors: m.scopeCursors?.[familyId] ?? {}, deviceId: m.deviceId }; },
    commit: batch => {
      const out: SyncBatch = {
        records: batch.records?.map(({ collection, record }) => ({ collection, record: toLocal(collection, record, familyId) })),
        syncRecords: batch.syncRecords?.map((r): SyncRecord => ({ ...r, key: localKey(r.key), id: idOf(localKey(r.key)) })),
        outboxRemove: batch.outboxRemove?.map(r => ({ ...r, key: localKey(r.key) })),
        outboxAdd: batch.outboxAdd?.map(localEntry),
        outboxMark: batch.outboxMark?.map(r => ({ ...r, key: localKey(r.key) })),
        expect: batch.expect?.map(r => ({ ...r, key: localKey(r.key) })),
      };
      if (batch.meta?.cursors) out.meta = { scopeCursors: { ...base.meta().scopeCursors, [familyId]: batch.meta.cursors } };
      return base.commit(out);
    },
    refresh: () => base.refresh(),
  };
}

// One family's photos for photo-file sync (lib/sync/photos.ts): the user's own (null) or a shared family's. Files go to
// and come from that family's folder, so a photo is only ever handled under the family it belongs to.
export function familyPhotos(local: PhotoLocal, familyId: string | null): PhotoLocal {
  return {
    photos: () => local.photos().filter(p => ((p as { familyId?: string }).familyId ?? null) === familyId),
    hasBytes: id => local.hasBytes(id),
    bytes: id => local.bytes(id),
    storeBytes: (id, blob) => local.storeBytes(id, blob),
    syncRecord: key => local.syncRecord(key),
    commit: batch => local.commit(batch),
  };
}

// A photo added on this device and not uploaded yet, shown only by records of one shared family, belongs to that
// family: it is uploaded into that family's folder, with the child it was added for (`childHint`), which the server
// checks against the user's membership. A photo the user's own records show stays the user's. Pure.
export function sharedPhotoAssignments(local: Pick<CleanupLocal, "all">, uploaded: (id: string) => boolean): { id: string; familyId: string; childHint: string }[] {
  const families = new Map<string, Set<string>>();
  const hints = new Map<string, string>();
  for (const collection of ["children", "entries"] as const) {
    for (const r of local.all(collection)) {
      const scope = unscope(String(r.id));
      const child = collection === "children" ? String(r.id) : String(r.childId ?? "");
      for (const p of photosOf(r)) {
        families.set(p, (families.get(p) ?? new Set()).add(scope?.familyId ?? ""));
        if (scope && !hints.has(p)) hints.set(p, unscope(child)?.id ?? "");
      }
    }
  }
  const out: { id: string; familyId: string; childHint: string }[] = [];
  for (const photo of local.all("photos")) {
    const id = String(photo.id);
    const used = [...(families.get(id) ?? [])];
    if (photo.familyId || uploaded(id) || used.length !== 1 || !used[0] || !hints.get(id)) continue;
    out.push({ id, familyId: used[0], childHint: hints.get(id)! });
  }
  return out;
}

// ---- Memberships: what the user can reach, and how that changes -------------------------------------------------

export type MembershipFetch = { ok: true; memberships: Membership[] } | { ok: false; reason: string };

// The user's own memberships (RLS returns only those). Any failure, including being offline, is "unknown", never "none".
export async function fetchMemberships(client: SupabaseClient, userId: string): Promise<MembershipFetch> {
  try {
    const { data, error } = await client.from("child_memberships").select("family_id, child_id, role").eq("user_id", userId).order("family_id").order("child_id");
    if (error || !data) return { ok: false, reason: error?.message ?? "no answer" };
    return { ok: true, memberships: data.map(m => ({ familyId: m.family_id, childId: m.child_id, role: m.role })) };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

// A membership is removed only after it has been missing from this many successful answers in a row, so one odd
// answer never deletes anything.
export const CONFIRM_REMOVAL_AFTER = 2;

// Removing a shared child's data from this device: "pending" until done in one atomic step with this state.
export type Revocation = { familyId: string; childId: string; since: string; state: "pending" | "done"; archived?: number; removed?: number };

// What sync knows about the user's shared children, kept in the account space (SpaceMeta.scopes).
export type ScopeState = {
  userId: string;
  homeFamilyId: string;
  // Shared children (scopedId(familyId, childId)) and the user's role for each, as last confirmed.
  shared: Record<string, Role>;
  // The user's own family's children (plain ids) whose profile someone else now manages (an ownership transfer),
  // and the user's role for each. A child of the user's own family not listed here is theirs to manage.
  home?: Record<string, Role>;
  // Shared children missing from the last successful answers, and how many in a row.
  absent: Record<string, number>;
  revoked: Record<string, Revocation>;
};

export type ScopeAction =
  | { kind: "fullResync"; familyId: string } // a child joined this family's scope: download the scope again from the start
  | { kind: "clearRejections"; familyId: string } // a role changed: refused changes may now be allowed
  | { kind: "revoke"; familyId: string; childId: string } // remove this child's data from the device
  | { kind: "dropScope"; familyId: string }; // nothing of this family is shared any more

export const initialScopeState = (userId: string, homeFamilyId: string): ScopeState => ({ userId, homeFamilyId, shared: {}, absent: {}, revoked: {} });

// A stored state for this user and family, or a fresh one. A state of another account is never used.
export function scopeStateFor(stored: unknown, userId: string, homeFamilyId: string): ScopeState {
  const s = stored as ScopeState | undefined;
  return s && s.userId === userId && s.homeFamilyId === homeFamilyId ? s : initialScopeState(userId, homeFamilyId);
}

// The next state after an answer about the user's memberships, and what to do about it. Pure.
//
// - unknown answer (offline, error): nothing changes
// - an answer that leaves out the user's own children (`homeChildren`, those stored here) can't be right (the user
//   owns them): nothing changes
// - new shared child: confirmed at once; that family's scope is downloaded again from the start, because records
//   older than its cursor were never sent for this child
// - role changed (including an ownership transfer): updated; refused changes for that family may be sent again
// - shared child missing: counted; removed (and its data with it) after CONFIRM_REMOVAL_AFTER answers in a row
// - the user's own family's children are never removed here; only the user's role for them is kept (`home`), for
//   the rare child whose profile was handed to someone else
export function observeMemberships(state: ScopeState, answer: MembershipFetch, opts: { userId: string; now: string; homeChildren?: string[] }): { state: ScopeState; actions: ScopeAction[] } {
  if (state.userId !== opts.userId) throw new Error("scope state belongs to another account");
  if (!answer.ok) return { state, actions: [] };
  const homeFamily = state.homeFamilyId;
  if (opts.homeChildren?.length && !answer.memberships.some(m => m.familyId === homeFamily)) return { state, actions: [] };

  const next: ScopeState = { ...state, shared: { ...state.shared }, absent: { ...state.absent }, revoked: { ...state.revoked } };
  // A child of the user's own family missing from the answer (its new owner deleted the profile) keeps its last role.
  const home: Record<string, Role> = Object.fromEntries(Object.entries(state.home ?? {}).filter(([id]) => !answer.memberships.some(m => m.familyId === homeFamily && m.childId === id)));
  const actions: ScopeAction[] = [];
  const add = (a: ScopeAction) => {
    if (!actions.some(x => JSON.stringify(x) === JSON.stringify(a))) actions.push(a);
  };
  const seen = new Set<string>();
  for (const m of answer.memberships) {
    if (m.familyId === homeFamily) {
      if (m.role !== "owner") home[m.childId] = m.role;
      continue;
    }
    const key = scopedId(m.familyId, m.childId);
    seen.add(key);
    delete next.absent[key];
    if (!(key in next.shared)) {
      next.shared[key] = m.role;
      delete next.revoked[key]; // shared again: a pending removal is cancelled; removed data comes back with the download
      add({ kind: "fullResync", familyId: m.familyId });
    } else if (next.shared[key] !== m.role) {
      next.shared[key] = m.role;
      add({ kind: "clearRejections", familyId: m.familyId });
    }
  }
  if (JSON.stringify(home) !== JSON.stringify(state.home ?? {})) {
    if (Object.keys(home).length) next.home = home;
    else delete next.home;
    add({ kind: "clearRejections", familyId: homeFamily });
  }
  for (const key of Object.keys(state.shared)) {
    if (seen.has(key)) continue;
    const count = (next.absent[key] ?? 0) + 1;
    if (count < CONFIRM_REMOVAL_AFTER) { next.absent[key] = count; continue; }
    const { familyId, id: childId } = unscope(key)!;
    delete next.absent[key];
    delete next.shared[key];
    next.revoked[key] = { familyId, childId, since: opts.now, state: "pending" };
    add({ kind: "revoke", familyId, childId });
    if (!Object.keys(next.shared).some(k => unscope(k)!.familyId === familyId)) add({ kind: "dropScope", familyId });
  }
  return { state: next, actions };
}

// The shared scopes to sync: per family, its shared children.
export function sharedScopes(state: ScopeState): { familyId: string; childIds: string[] }[] {
  const byFamily = new Map<string, string[]>();
  for (const key of Object.keys(state.shared)) {
    const { familyId, id } = unscope(key)!;
    byFamily.set(familyId, [...(byFamily.get(familyId) ?? []), id]);
  }
  return [...byFamily].map(([familyId, childIds]) => ({ familyId, childIds: childIds.sort() }));
}

// ---- Removing a child's data after access ends ------------------------------------------------------------------

type CleanupCollection = "children" | "entries" | "records" | "photos";

// The stored records cleanup looks at, and how it applies its result.
export interface CleanupLocal {
  all(collection: CleanupCollection): Record<string, unknown>[];
  outbox(): OutboxEntry[];
  // All-or-nothing, together with the new scope state; "stale" if the outbox changed meanwhile (nothing applied).
  commitCleanup(batch: CleanupBatch, scopes: ScopeState): Promise<"ok" | "stale">;
}

export type CleanupBatch = {
  deleteRecords: { collection: Exclude<CleanupCollection, "photos">; id: string }[];
  // Photo details and bytes.
  deletePhotos: string[];
  deleteSyncRecords: string[];
  // Removed only if the entry still has this seq.
  outboxRemove: { key: string; seq: number }[];
  // Changes never sent, kept on this device (store "archive"), never synced and never shown in lists.
  archive: ArchiveItem[];
};

const photosOf = (r: Record<string, unknown>) => [
  ...(Array.isArray(r.photos) ? (r.photos as string[]) : []),
  ...(typeof r.photo === "string" ? [r.photo] : []),
];

// What removing one shared child's data takes. Pure. Refuses the user's own family.
//
// Removed: the child, its Moments and activity records (only those of that family), their sync state, and the photos
// they show that no remaining record on this device shows (a Moment about two children keeps its photo while the other
// child is still shared). Unsent changes are not lost: each is copied to the archive, with its outbox entry, first.
export function planRevocation(local: Pick<CleanupLocal, "all" | "outbox">, state: ScopeState, familyId: string, childId: string, now: string): CleanupBatch {
  if (familyId === state.homeFamilyId) throw new Error("the user's own family is never removed");
  const child = scopedId(familyId, childId);
  const batch: CleanupBatch = { deleteRecords: [], deletePhotos: [], deleteSyncRecords: [], outboxRemove: [], archive: [] };
  const outbox = new Map(local.outbox().map(e => [e.key, e]));
  const removed = new Set<string>();
  const keep = (collection: string, r: Record<string, unknown>, entry: OutboxEntry) => batch.archive.push({
    id: `revoked:${entry.key}:${now}`, source: `access-revoked:${familyId}/${childId}`,
    reason: "unsent change to a child shared with this user, whose access was removed", value: { collection, record: r, outbox: entry }, archivedAt: now,
  });
  for (const collection of ["children", "entries", "records"] as const) {
    for (const r of local.all(collection)) {
      const id = String(r.id);
      if (unscope(id)?.familyId !== familyId || (collection === "children" ? id !== child : r.childId !== child)) continue;
      const key = outboxKey(collection, id);
      removed.add(key);
      batch.deleteRecords.push({ collection, id });
      batch.deleteSyncRecords.push(key);
      const entry = outbox.get(key);
      if (entry) {
        keep(collection, r, entry);
        batch.outboxRemove.push({ key, seq: entry.seq });
      }
    }
  }
  // Versions kept for those records and not yet sent.
  for (const e of outbox.values()) {
    if (e.collection !== "versions" || unscope(e.id)?.familyId !== familyId) continue;
    const tableCollection = e.payload?.table === "activity_records" ? "records" : e.payload?.table;
    if (!removed.has(outboxKey(tableCollection as CleanupCollection, scopedId(familyId, e.payload?.recordId ?? "")))) continue;
    keep("versions", {}, e);
    batch.outboxRemove.push({ key: e.key, seq: e.seq });
  }
  // Photos: of that family, shown by a removed record, and by nothing that stays.
  const remaining = new Set<string>();
  for (const collection of ["children", "entries", "records"] as const) {
    for (const r of local.all(collection)) if (!removed.has(outboxKey(collection, String(r.id)))) for (const p of photosOf(r)) remaining.add(p);
  }
  const candidates = new Set<string>();
  for (const collection of ["children", "entries"] as const) {
    for (const r of local.all(collection)) if (removed.has(outboxKey(collection, String(r.id)))) for (const p of photosOf(r)) candidates.add(p);
  }
  for (const p of local.all("photos")) {
    const id = String(p.id);
    if (p.familyId !== familyId || !candidates.has(id) || remaining.has(id)) continue;
    batch.deletePhotos.push(id);
    batch.deleteSyncRecords.push(outboxKey("photos", id));
    const entry = outbox.get(outboxKey("photos", id));
    if (entry) {
      keep("photos", p, entry);
      batch.outboxRemove.push({ key: entry.key, seq: entry.seq });
    }
  }
  return batch;
}

// Carries out every pending removal, each in one atomic step with its new state, so an interrupted device either
// removed a child completely or not at all, and does it (again) next time. Returns the latest state.
export async function runRevocations(local: CleanupLocal, state: ScopeState, now: string): Promise<ScopeState> {
  let current = state;
  for (const [key, r] of Object.entries(state.revoked)) {
    if (r.state !== "pending") continue;
    const batch = planRevocation(local, current, r.familyId, r.childId, now);
    const next: ScopeState = { ...current, revoked: { ...current.revoked, [key]: { ...r, state: "done", archived: batch.archive.length, removed: batch.deleteRecords.length + batch.deletePhotos.length } } };
    if ((await local.commitCleanup(batch, next)) === "ok") current = next;
  }
  return current;
}

// ---- One round over every scope -------------------------------------------------------------------------------

// `shared` results' `notSent` use this device's keys (scoped ids), like `home`'s.
export type ScopesResult = { home: RoundResult; shared: Record<string, RoundResult>; actions: ScopeAction[]; state: ScopeState | null; memberships: MembershipFetch | null };

// The user's own family, then (when enabled) memberships, removals, and each shared family. With `enabled` false this
// is exactly the single-family round the app has always made.
export async function syncScopes(
  client: SupabaseClient,
  base: ScopeBase & Partial<CleanupLocal>,
  opts: { userId: string; homeFamilyId: string; enabled: boolean; homeChildren?: string[]; pageSize?: number; now?: string },
): Promise<ScopesResult> {
  if (opts.enabled && base.all) {
    const assigned = sharedPhotoAssignments(base as ScopeBase & CleanupLocal, id => !!base.syncRecord(outboxKey("photos", id)));
    if (assigned.length) {
      const records = [];
      for (const a of assigned) {
        const photo = await base.record("photos", a.id);
        if (photo) records.push({ collection: "photos" as const, record: { ...photo, familyId: a.familyId, childHint: a.childHint } });
      }
      await base.commit({ records });
    }
  }
  const home = await syncRound(client, homeLocal(base), { familyId: opts.homeFamilyId, userId: opts.userId, pageSize: opts.pageSize });
  if (!opts.enabled) return { home, shared: {}, actions: [], state: null, memberships: null };

  const now = opts.now ?? new Date().toISOString();
  const memberships = await fetchMemberships(client, opts.userId);
  const stored = scopeStateFor(base.meta().scopes, opts.userId, opts.homeFamilyId);
  const observed = observeMemberships(stored, memberships, { userId: opts.userId, now, homeChildren: opts.homeChildren });
  let state = observed.state;
  // No state of this account yet (or another account's, which is never used): no shared family's cursor is trusted.
  const scopeCursors = stored === base.meta().scopes ? { ...base.meta().scopeCursors } : {};
  const marks: NonNullable<SyncBatch["outboxMark"]> = [];
  for (const a of observed.actions) {
    if (a.kind === "fullResync") scopeCursors[a.familyId] = {};
    if (a.kind === "dropScope") delete scopeCursors[a.familyId];
    if (a.kind === "clearRejections") {
      for (const e of base.outbox()) if (e.rejected && (entryFamily(base, e) ?? opts.homeFamilyId) === a.familyId) marks.push({ key: e.key, seq: e.seq, rejected: null });
    }
  }
  if (observed.actions.length || JSON.stringify(state) !== JSON.stringify(base.meta().scopes)) await base.commit({ meta: { scopeCursors, scopes: state }, outboxMark: marks });
  if (base.commitCleanup && base.all && Object.values(state.revoked).some(r => r.state === "pending")) {
    state = await runRevocations(base as ScopeBase & CleanupLocal, state, now);
  }
  const shared: Record<string, RoundResult> = {};
  for (const scope of sharedScopes(state)) {
    const round = await syncRound(client, scopedLocal(base, scope.familyId), { familyId: scope.familyId, userId: opts.userId, childIds: scope.childIds, pageSize: opts.pageSize });
    round.notSent = Object.fromEntries(Object.entries(round.notSent).map(([k, v]) => [localKeyIn(scope.familyId, k), v]));
    shared[scope.familyId] = round;
  }
  return { home, shared, actions: observed.actions, state, memberships };
}
