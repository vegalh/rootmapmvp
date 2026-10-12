// An in-memory device for the sync integration tests (tests/db/sync.test.ts, photos.test.ts): an account space that
// follows the same rules as the IndexedDB store (lib/data/store.ts): one atomic commit, refused when an outbox
// expectation no longer holds; photo bytes kept by id, never replaced once present.
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { outboxKey, type OutboxEntry, type SyncRecord } from "../../src/lib/data/schema.ts";
import { outboxEntries } from "../../src/lib/data/records.ts";
import { sha256Hex, syncRound, type SyncBatch, type SyncLocal } from "../../src/lib/sync/engine.ts";
import type { SyncedCollection } from "../../src/lib/sync/mapping.ts";
import { syncPhotos, type LocalPhoto, type PhotoLocal } from "../../src/lib/sync/photos.ts";
import { localEnv, newFamily, newUser, type TestUser } from "./helpers.ts";

export type Rec = Record<string, unknown> & { id: string };

// A device's account space, in memory.
export class Device implements SyncLocal, PhotoLocal {
  records = new Map<string, Rec>();
  out = new Map<string, OutboxEntry>();
  synced = new Map<string, SyncRecord>();
  blobs = new Map<string, Uint8Array>();
  m = { familyId: null as string | null, cursors: {} as Record<string, number>, deviceId: `d-${randomUUID()}` };
  seq = 0;
  offline = false;
  client: SupabaseClient;
  userId: string;
  familyId: string;
  constructor(client: SupabaseClient, userId: string, familyId: string) {
    this.client = client;
    this.userId = userId;
    this.familyId = familyId;
  }

  // A local change, as the app's write path makes it: the record and its outbox entry together.
  edit(collection: SyncedCollection, rec: Rec) {
    const now = new Date().toISOString();
    const prev = this.records.get(outboxKey(collection, rec.id));
    const next = { createdAt: prev?.createdAt ?? now, origin: prev?.origin ?? "user", position: 0, deletedAt: null, ...prev, ...rec, updatedAt: now };
    this.records.set(outboxKey(collection, rec.id), next);
    for (const e of outboxEntries(collection, [next], this.out, { now, deviceId: this.m.deviceId, nextSeq: () => ++this.seq })) this.out.set(e.key, e);
    return next;
  }
  remove(collection: SyncedCollection, id: string) {
    return this.edit(collection, { ...this.get(collection, id)!, deletedAt: new Date().toISOString() });
  }
  get(collection: SyncedCollection, id: string) { return this.records.get(outboxKey(collection, id)); }
  live(collection: SyncedCollection) { return [...this.records.entries()].filter(([k, r]) => k.startsWith(`${collection}:`) && !r.deletedAt).map(([, r]) => r); }

  outbox() { return [...this.out.values()].sort((a, b) => a.seq - b.seq); }
  syncRecord(key: string) { return this.synced.get(key); }
  async record(collection: SyncedCollection, id: string) { const r = this.get(collection, id); return r && { ...r }; }
  async photoChecksum(id: string) { const b = this.blobs.get(id); return b ? sha256Hex(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) : null; }
  meta() { return { ...this.m, cursors: { ...this.m.cursors } }; }
  async refresh() {}
  async commit(batch: SyncBatch): Promise<"ok" | "stale"> {
    const expect = new Map<string, number | null>();
    for (const e of batch.expect ?? []) expect.set(e.key, e.seq);
    for (const r of batch.outboxRemove ?? []) expect.set(r.key, r.seq);
    for (const [key, seq] of expect) if ((this.out.get(key)?.seq ?? null) !== seq) return "stale";
    for (const { collection, record } of batch.records ?? []) this.records.set(outboxKey(collection, String(record.id)), record as Rec);
    for (const r of batch.syncRecords ?? []) this.synced.set(r.key, r);
    for (const r of batch.outboxRemove ?? []) this.out.delete(r.key);
    for (const e of batch.outboxAdd ?? []) { this.out.set(e.key, e); this.seq = Math.max(this.seq, e.seq); }
    if (batch.meta?.familyId) this.m.familyId = batch.meta.familyId;
    if (batch.meta?.cursors) this.m.cursors = batch.meta.cursors;
    return "ok";
  }
  sync(opts: Parameters<typeof syncRound>[2] extends infer O ? Partial<O> : never = {}) {
    return syncRound(this.client, this, { familyId: this.familyId, userId: this.userId, pageSize: 500, ...opts });
  }
  // Photo files (M5), as the app's runner does after a record round.
  photos() { return this.live("photos") as unknown as LocalPhoto[]; }
  hasBytes(id: string) { return this.blobs.has(id); }
  async bytes(id: string) {
    const b = this.blobs.get(id);
    return b ? new Blob([b], { type: String(this.get("photos", id)?.mimeType ?? "image/jpeg") }) : null;
  }
  async storeBytes(id: string, blob: Blob) {
    if (!this.blobs.has(id)) this.blobs.set(id, new Uint8Array(await blob.arrayBuffer()));
    return true;
  }
  syncFiles(hooks: Parameters<typeof syncPhotos>[2]["hooks"] = {}) {
    return syncPhotos(this.client, this, { familyId: this.familyId, url: localEnv().url, key: localEnv().anonKey, hooks });
  }
  async syncAll() {
    const records = await this.sync();
    const files = await this.syncFiles();
    return { records, files };
  }
}

// A signed-in device for `user`, whose network can be switched off.
export async function device(user: TestUser, familyId: string): Promise<Device> {
  let d: Device;
  const client = createClient(localEnv().url, localEnv().anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => (d?.offline ? Promise.reject(new TypeError("Failed to fetch")) : fetch(input, init)) },
  });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  d = new Device(client, user.id, familyId);
  return d;
}
export async function parent(label: string) {
  const user = await newUser(label);
  const familyId = await newFamily(user, label);
  return { user, familyId, device: () => device(user, familyId) };
}




// A photo saved on the device: bytes plus metadata (as lib/data/store.ts savePhoto), queued for upload.
export async function addPhoto(d: Device, size = 64, sha = false): Promise<string> {
  const id = `photo-${randomUUID()}`;
  const bytes = new Uint8Array(randomBytes(size));
  d.blobs.set(id, bytes);
  d.edit("photos", { id, mimeType: "image/jpeg", byteSize: bytes.length, width: 8, height: 8, source: "upload", storagePath: null, uploadedAt: null, ...(sha ? { sha256: await sha256Hex(bytes.buffer as ArrayBuffer) } : {}) });
  return id;
}
