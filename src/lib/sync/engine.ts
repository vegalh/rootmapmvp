import type { SupabaseClient } from "@supabase/supabase-js";
import { outboxKey, type OutboxEntry, type SyncRecord } from "../data/schema";
import {
  COLLECTION_OF, SYNC_ORDER, TABLE, UnsyncableRecord, clientRow, fromRow, insertPayload, isSyncedCollection, photoRefs, toRow, updatePayload,
  type Row, type SyncedCollection, type Table,
} from "./mapping";
import { resolve, sameContent, type Resolution } from "./resolver";

// Record sync for the signed-in account's space (Phase 2B-2 M4; docs/data-architecture-phase2.md, sections 4–6).
//
// One round = push, then pull:
// - Push: each outbox entry is sent with a conditional write (insert that never overwrites, or update only at the
//   revision this device last saw). If the server's copy moved on, the three versions are resolved (resolver.ts),
//   every losing version is kept in record_versions first, and the result is written at the server's revision.
// - Pull: per table, rows with a change number above this device's cursor, in pages; each page is applied in one
//   local transaction together with the cursor, so an interrupted download repeats at most one page.
// Local writes are made through `SyncLocal.commit`, which refuses (stale) if the parent changed a record in the
// meantime, so a sync result never overwrites a newer local edit. Retrying anything is safe: an upload that
// reached the server but wasn't recorded locally is recognised by content, so nothing is sent or kept twice.
//
// Only this space's records are ever read or sent; photo files are not uploaded (M5) and guest data is never
// touched (it is not in this space).

export type SyncBatch = {
  // Local records to store, without queueing them for upload.
  records?: { collection: SyncedCollection; record: Record<string, unknown> }[];
  syncRecords?: SyncRecord[];
  // Removed only if the entry still has this seq (the record wasn't changed since).
  outboxRemove?: { key: string; seq: number }[];
  outboxAdd?: OutboxEntry[];
  // The outbox entry each key must have (seq), or none (null), for the batch to apply.
  expect?: { key: string; seq: number | null }[];
  meta?: { familyId?: string; cursors?: Record<string, number> };
};

// The account space, as sync sees it (lib/data/store.ts in the app; an in-memory version in the tests).
export interface SyncLocal {
  outbox(): OutboxEntry[];
  syncRecord(key: string): SyncRecord | undefined;
  record(collection: SyncedCollection, id: string): Promise<Record<string, unknown> | undefined>;
  // SHA-256 (hex) of a stored photo's bytes, or null if the bytes aren't on this device.
  photoChecksum(id: string): Promise<string | null>;
  meta(): { familyId: string | null; cursors: Record<string, number>; deviceId: string };
  // All-or-nothing; "stale" if an expectation no longer holds (nothing applied).
  commit(batch: SyncBatch): Promise<"ok" | "stale">;
  // Picks up changes another tab made to this space.
  refresh(): Promise<void>;
}

export type EntryState = "held" | "failed" | "waiting";
export type RoundResult = {
  pushed: number;
  pulled: number;
  // Outbox entries not sent this round, and why: held (demo or unknown origin: waits for the first-login
  // migration), waiting (needs a record or photo that isn't on the server yet), failed (the server refused it).
  notSent: Record<string, { state: EntryState; reason: string }>;
  conflicts: number;
};

// Test hooks: called at the points where a real device can be interrupted.
export type SyncHooks = {
  afterServerWrite?: (key: string) => void | Promise<void>;
  beforePageCommit?: (table: Table, page: number) => void | Promise<void>;
};

export class SyncOffline extends Error {}
export class SyncStopped extends Error {}

type Ctx = { client: SupabaseClient; local: SyncLocal; familyId: string; userId: string; pageSize: number; hooks: SyncHooks };

const isNetwork = (e: unknown) => {
  const x = e as { name?: string; message?: string; status?: number; code?: string } | null;
  return !!x && (x.name === "TypeError" || x.name === "AuthRetryableFetchError" || x.status === 0 || /fetch|network|Load failed/i.test(x.message ?? "") && !x.code);
};
// Supabase returns errors instead of throwing; network failures surface as a TypeError message.
function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) {
    if (isNetwork(res.error)) throw new SyncOffline(res.error.message);
    throw Object.assign(new Error(res.error.message), { code: res.error.code });
  }
  return res.data;
}

export async function syncRound(client: SupabaseClient, local: SyncLocal, opts: { familyId: string; userId: string; pageSize?: number; hooks?: SyncHooks }): Promise<RoundResult> {
  const ctx: Ctx = { client, local, familyId: opts.familyId, userId: opts.userId, pageSize: opts.pageSize ?? 500, hooks: opts.hooks ?? {} };
  await local.refresh();
  const meta = local.meta();
  if (meta.familyId && meta.familyId !== ctx.familyId) throw new SyncStopped("this space belongs to another family");
  if (!meta.familyId) await local.commit({ meta: { familyId: ctx.familyId } });
  const result: RoundResult = { pushed: 0, pulled: 0, notSent: {}, conflicts: 0 };
  try {
    await push(ctx, result);
    await pull(ctx, result);
  } catch (e) {
    if (e instanceof SyncOffline || isNetwork(e)) throw e instanceof SyncOffline ? e : new SyncOffline(String(e));
    throw e;
  }
  return result;
}

// ---- Push ----------------------------------------------------------------------------------------------------

const orderOf = (e: OutboxEntry) => (e.collection === "versions" ? -1 : isSyncedCollection(e.collection) ? SYNC_ORDER.indexOf(e.collection) : 99);

async function push(ctx: Ctx, result: RoundResult) {
  const entries = [...ctx.local.outbox()].sort((a, b) => orderOf(a) - orderOf(b) || a.seq - b.seq);
  // Records not on the server after this round (so records that need them wait).
  const missing = new Set<string>();
  for (const entry of entries) {
    if (entry.collection === "versions") { await pushVersion(ctx, entry); continue; }
    if (!isSyncedCollection(entry.collection)) {
      // Local-only collection (legacy observations live on inside entries): nothing to send.
      await ctx.local.commit({ outboxRemove: [{ key: entry.key, seq: entry.seq }] });
      continue;
    }
    const state = await pushRecord(ctx, entry, entry.collection, missing, result);
    if (state) {
      result.notSent[entry.key] = state;
      missing.add(entry.key);
    }
  }
}

async function pushVersion(ctx: Ctx, entry: OutboxEntry) {
  const p = entry.payload!;
  await keepVersion(ctx, p.table as Table, p.recordId, p.version, p.baseRev, p.reason);
  await ctx.local.commit({ outboxRemove: [{ key: entry.key, seq: entry.seq }] });
}

async function pushRecord(ctx: Ctx, entry: OutboxEntry, collection: SyncedCollection, missing: Set<string>, result: RoundResult): Promise<{ state: EntryState; reason: string } | null> {
  const table = TABLE[collection];
  const record = await ctx.local.record(collection, entry.id);
  if (!record) {
    await ctx.local.commit({ outboxRemove: [{ key: entry.key, seq: entry.seq }] });
    return null;
  }
  // Demo or unknown origin: ownership not established; the first-login migration (M6) decides.
  if (record.origin === "demo" || record.origin === "unknown") return { state: "held", reason: `origin ${String(record.origin)}` };

  let row: Row;
  try {
    if (collection === "photos" && !record.sha256) {
      const sum = await ctx.local.photoChecksum(entry.id);
      if (!sum) return { state: "failed", reason: "photo bytes missing on this device" };
      record.sha256 = sum;
    }
    row = toRow(collection, record, { userId: ctx.userId });
  } catch (e) {
    if (e instanceof UnsyncableRecord) return { state: "failed", reason: e.message };
    throw e;
  }
  // What this record refers to must be on the server first.
  const needs = [
    ...photoRefs(collection, row).map(id => outboxKey("photos", id)),
    ...(typeof row.child_id === "string" ? [outboxKey("children", row.child_id)] : []),
    ...((row.child_ids as string[] | undefined) ?? []).map(id => outboxKey("children", id)),
  ];
  const blocked = needs.find(k => missing.has(k));
  if (blocked) return { state: "waiting", reason: `needs ${blocked}` };

  const sr = ctx.local.syncRecord(entry.key);
  let server: Row | null = null;
  let resolution: Resolution | null = null;
  try {
    let written: Row | null = null;
    if (sr) written = await conditionalUpdate(ctx, table, collection, entry.id, row, sr.rev);
    else written = await insertIfAbsent(ctx, table, collection, row);
    // Conflict (or a repeat of an upload that wasn't recorded): resolve against the server's version.
    for (let attempt = 0; !written && attempt < 3; attempt++) {
      server = await fetchRow(ctx, table, entry.id);
      if (!server) throw new Error(`${table} ${entry.id} not readable`);
      const base = sr ? sr.syncBase : null;
      resolution = resolve(collection, base, row, clientRow(collection, server));
      for (const loser of resolution.losers) await keepVersion(ctx, table, entry.id, loser.version, Number(server.rev), loser.reason);
      if (resolution.losers.length) result.conflicts++;
      if (sameContent(resolution.merged, clientRow(collection, server))) written = server;
      else written = await conditionalUpdate(ctx, table, collection, entry.id, resolution.merged, Number(server.rev));
    }
    if (!written) return { state: "waiting", reason: "the record keeps changing on the server; retried next round" };
    await ctx.hooks.afterServerWrite?.(entry.key);
    // Record what the server now holds. The local record changes only if the result differs from it, and only if
    // the parent hasn't changed it meanwhile (otherwise the newer edit is sent next round).
    const agreed = clientRow(collection, written);
    const batch: SyncBatch = {
      syncRecords: [{ key: entry.key, collection, id: entry.id, rev: Number(written.rev), syncedAt: new Date().toISOString(), syncBase: agreed }],
      outboxRemove: [{ key: entry.key, seq: entry.seq }],
    };
    if (!sameContent(agreed, row) || collection === "photos") batch.records = [{ collection, record: fromRow(collection, written, record) }];
    await ctx.local.commit(batch);
    result.pushed++;
    return null;
  } catch (e) {
    if (e instanceof SyncOffline || isNetwork(e)) throw e;
    const code = (e as { code?: string }).code;
    // A referenced record isn't on the server (it may be held or failed): wait for it.
    if (code === "23503") return { state: "waiting", reason: (e as Error).message };
    return { state: "failed", reason: (e as Error).message };
  }
}

async function insertIfAbsent(ctx: Ctx, table: Table, collection: SyncedCollection, row: Row): Promise<Row | null> {
  const data = check(await ctx.client.from(table).upsert(insertPayload(collection, row, ctx.familyId), { onConflict: "family_id,id", ignoreDuplicates: true }).select());
  return (data as Row[])[0] ?? null;
}

async function conditionalUpdate(ctx: Ctx, table: Table, collection: SyncedCollection, id: string, row: Row, rev: number): Promise<Row | null> {
  const data = check(await ctx.client.from(table).update(updatePayload(collection, row)).eq("family_id", ctx.familyId).eq("id", id).eq("rev", rev).select());
  return (data as Row[])[0] ?? null;
}

async function fetchRow(ctx: Ctx, table: Table, id: string): Promise<Row | null> {
  return check(await ctx.client.from(table).select("*").eq("family_id", ctx.familyId).eq("id", id).maybeSingle()) as Row | null;
}

// Keeps a losing version. Its id is derived from what it is, so keeping it again (after an interruption) adds
// nothing.
async function keepVersion(ctx: Ctx, table: Table, recordId: string, version: Row, baseRev: number | null, reason: string) {
  const now = new Date().toISOString();
  const id = `v-${await sha256Hex(JSON.stringify([table, recordId, baseRev, reason, version]))}`;
  check(await ctx.client.from("record_versions").upsert({
    family_id: ctx.familyId, id, table_name: table, record_id: recordId, version, base_rev: baseRev, reason, created_at: now, updated_at: now, origin: "user",
  }, { onConflict: "family_id,id", ignoreDuplicates: true }).select("id"));
}

export async function sha256Hex(text: string | ArrayBuffer): Promise<string> {
  const bytes = typeof text === "string" ? new TextEncoder().encode(text) : new Uint8Array(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

// ---- Pull ----------------------------------------------------------------------------------------------------

async function pull(ctx: Ctx, result: RoundResult) {
  for (const collection of SYNC_ORDER) {
    const table = TABLE[collection];
    for (let page = 0; ; page++) {
      const cursor = ctx.local.meta().cursors[table] ?? 0;
      const rows = check(await ctx.client.from(table).select("*").eq("family_id", ctx.familyId).gt("change_seq", cursor).order("change_seq").limit(ctx.pageSize)) as Row[];
      if (!rows.length) break;
      let applied = false;
      for (let attempt = 0; attempt < 3 && !applied; attempt++) {
        const batch = await pageBatch(ctx, collection, rows);
        await ctx.hooks.beforePageCommit?.(table, page);
        batch.meta = { cursors: { ...ctx.local.meta().cursors, [table]: Number(rows[rows.length - 1].change_seq) } };
        if ((await ctx.local.commit(batch)) === "ok") applied = true;
        else await ctx.local.refresh(); // the parent changed something meanwhile: decide again
      }
      if (!applied) return; // try again next round
      result.pulled += rows.length;
      if (rows.length < ctx.pageSize) break;
    }
  }
}

async function pageBatch(ctx: Ctx, collection: SyncedCollection, rows: Row[]): Promise<SyncBatch> {
  const batch: Required<Pick<SyncBatch, "records" | "syncRecords" | "outboxRemove" | "outboxAdd" | "expect">> = { records: [], syncRecords: [], outboxRemove: [], outboxAdd: [], expect: [] };
  const pending = new Map(ctx.local.outbox().map(e => [e.key, e]));
  const now = new Date().toISOString();
  const meta = ctx.local.meta();
  let seq = Math.max(0, ...ctx.local.outbox().map(e => e.seq));
  for (const row of rows) {
    const id = String(row.id);
    const key = outboxKey(collection, id);
    const sr = ctx.local.syncRecord(key);
    if (sr && sr.rev >= Number(row.rev)) continue; // already have it (e.g. this device's own upload)
    const local = await ctx.local.record(collection, id);
    const entry = pending.get(key);
    const serverRow = clientRow(collection, row);
    const synced: SyncRecord = { key, collection, id, rev: Number(row.rev), syncedAt: now, syncBase: serverRow };
    if (!entry || !local) {
      batch.expect.push({ key, seq: entry ? entry.seq : null });
      batch.records.push({ collection, record: fromRow(collection, row, local) });
      batch.syncRecords.push(synced);
      continue;
    }
    // Changed here and on the server: resolve now, so the next upload can't overwrite the other device's change.
    let localRow: Row;
    try {
      localRow = toRow(collection, local, { userId: ctx.userId });
    } catch {
      continue; // can't be compared (e.g. an incomplete record); it stays as it is and is reported by push
    }
    const { merged, losers } = resolve(collection, sr ? sr.syncBase : null, localRow, serverRow);
    batch.expect.push({ key, seq: entry.seq });
    batch.records.push({ collection, record: fromRow(collection, { ...row, ...merged }, local) });
    batch.syncRecords.push(synced);
    if (sameContent(merged, serverRow)) batch.outboxRemove.push({ key, seq: entry.seq });
    for (const loser of losers) {
      const vid = `${key}:${row.rev}:${loser.reason}`;
      batch.outboxAdd.push({ key: outboxKey("versions", vid), collection: "versions", id: vid, op: "put", seq: ++seq, queuedAt: now, changedAt: now, deviceId: meta.deviceId, payload: { table: TABLE[collection], recordId: id, version: loser.version, baseRev: Number(row.rev), reason: loser.reason } });
    }
  }
  return batch;
}

export { COLLECTION_OF };
