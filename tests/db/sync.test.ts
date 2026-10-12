// Record sync (Phase 2B-2 M4) against the local stack: the app's own sync engine (src/lib/sync), with an
// in-memory device store that follows the same rules as the IndexedDB one (lib/data/store.ts commitSync): one
// atomic commit, refused when an outbox expectation no longer holds. The browser tests (tests/e2e/sync.mjs) run the
// same engine on the real store.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { outboxKey, type OutboxEntry, type SyncRecord } from "../../src/lib/data/schema.ts";
import { outboxEntries } from "../../src/lib/data/records.ts";
import { sha256Hex, syncRound, SyncOffline, type SyncBatch, type SyncLocal } from "../../src/lib/sync/engine.ts";
import { TABLE, type SyncedCollection } from "../../src/lib/sync/mapping.ts";
import { computeStatus } from "../../src/lib/sync/status.ts";
import { localEnv, must, newFamily, newUser, serviceClient, type TestUser } from "./helpers.ts";

type Rec = Record<string, unknown> & { id: string };

// A device's account space, in memory.
class Device implements SyncLocal {
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
}

// A signed-in device for `user`, whose network can be switched off.
async function device(user: TestUser, familyId: string): Promise<Device> {
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
async function parent(label: string) {
  const user = await newUser(label);
  const familyId = await newFamily(user, label);
  return { user, familyId, device: () => device(user, familyId) };
}

const admin = () => serviceClient();
const serverRows = async (table: string, familyId: string) => must(await admin().from(table).select("*").eq("family_id", familyId).order("id")) as Rec[];
const versions = async (familyId: string) => must(await admin().from("record_versions").select("*").eq("family_id", familyId)) as Rec[];
const child = (id: string, first: string) => ({ id, first, last: "Li", dob: "2022-03-04", enrolled: "", lessons: 0, group: "Primary", photo: "", interests: [] });
const entry = (id: string, childId: string, text: string, photos: string[] = []) => ({ id, childId, date: "2026-10-01", title: "", text, photos });

describe("record sync: one account, two devices", () => {
  it("records made on one device reach the other, with nothing duplicated", async () => {
    const p = await parent("sync-two");
    const a = await p.device(), b = await p.device();
    a.edit("children", child("c-1", "Mia"));
    a.edit("entries", entry("m-1", "c-1", "First steps"));
    a.edit("goals", { id: "g-1", title: "Read daily", completed: false });
    a.edit("plans", { id: "p-1", activityId: "water-pouring", date: "2026-10-02", childIds: ["c-1"] });
    a.edit("records", { id: "r-1", childId: "c-1", lesson: "Pouring", date: "2026-10-01", kind: "tried", activityId: "water-pouring" });
    a.edit("saved", { id: "water-pouring" });
    const pushed = await a.sync();
    assert.equal(pushed.pushed, 6);
    assert.deepEqual(a.outbox(), [], "everything confirmed");
    await b.sync();
    assert.equal(b.get("children", "c-1")?.first, "Mia");
    assert.equal(b.get("entries", "m-1")?.text, "First steps");
    assert.equal(b.get("goals", "g-1")?.title, "Read daily");
    assert.deepEqual(b.get("plans", "p-1")?.childIds, ["c-1"]);
    assert.equal(b.get("records", "r-1")?.kind, "tried");
    assert.ok(b.get("saved", "water-pouring"));
    assert.deepEqual(b.outbox(), [], "downloaded records are not queued for upload");
    // Edit on B, back to A.
    b.edit("entries", { ...b.get("entries", "m-1")!, text: "First steps, alone!" });
    await b.sync();
    await a.sync();
    assert.equal(a.get("entries", "m-1")?.text, "First steps, alone!");
    for (const t of ["children", "entries", "goals", "plans", "activity_records", "saved_activities"]) assert.equal((await serverRows(t, p.familyId)).length, 1, t);
    assert.equal((await serverRows("entries", p.familyId))[0].rev, 2);
    assert.deepEqual(await versions(p.familyId), []);
  });

  it("syncing again changes nothing (no repeated uploads, no new revisions)", async () => {
    const p = await parent("sync-idem");
    const a = await p.device();
    a.edit("children", child("c-1", "Mia"));
    await a.sync();
    const before = await serverRows("children", p.familyId);
    for (let i = 0; i < 3; i++) await a.sync();
    assert.deepEqual(await serverRows("children", p.familyId), before);
  });
});

describe("record sync: two accounts", () => {
  it("each account syncs only its own family; another family's records are never received or writable", async () => {
    const p = await parent("sync-p"), q = await parent("sync-q");
    const pa = await p.device(), qa = await q.device();
    pa.edit("children", child("c-p", "Pia"));
    qa.edit("children", child("c-q", "Quinn"));
    await pa.sync(); await qa.sync(); await pa.sync(); await qa.sync();
    assert.deepEqual(pa.live("children").map(c => c.id), ["c-p"]);
    assert.deepEqual(qa.live("children").map(c => c.id), ["c-q"]);
    // A device pointed at another family (it should never happen) is refused by the server, not written.
    const wrong = await device(q.user, p.familyId);
    wrong.edit("children", child("c-x", "Intruder"));
    const r = await wrong.sync().catch(e => e);
    const refused = r instanceof Error ? r.message : JSON.stringify(r.notSent);
    assert.match(refused, /c-x|member|row-level|policy|not readable|42501/);
    assert.deepEqual((await serverRows("children", p.familyId)).map(c => c.id), ["c-p"]);
  });
});

describe("record sync: offline and interruptions", () => {
  it("offline edits stay queued, and are sent when the device is back online", async () => {
    const p = await parent("sync-off");
    const a = await p.device(), b = await p.device();
    a.offline = true;
    a.edit("children", child("c-1", "Mia"));
    a.edit("entries", entry("m-1", "c-1", "Written offline"));
    await assert.rejects(a.sync(), SyncOffline);
    assert.equal(a.outbox().length, 2, "still queued");
    assert.deepEqual(await serverRows("children", p.familyId), []);
    a.offline = false;
    await a.sync();
    assert.deepEqual(a.outbox(), []);
    await b.sync();
    assert.equal(b.get("entries", "m-1")?.text, "Written offline");
  });

  it("an upload that reached the server but wasn't recorded locally is recognised: no duplicate, no extra revision", async () => {
    const p = await parent("sync-int-up");
    const a = await p.device();
    a.edit("children", child("c-1", "Mia"));
    let crash = true;
    const hooks = { afterServerWrite: () => { if (crash) { crash = false; throw new SyncOffline("connection lost after the write"); } } };
    await assert.rejects(a.sync({ hooks }), SyncOffline);
    assert.equal(a.outbox().length, 1, "not marked as sent");
    await a.sync();
    let rows = await serverRows("children", p.familyId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rev, 1, "the repeat did not write again");
    // The same for an update.
    a.edit("children", { ...a.get("children", "c-1")!, first: "Mira" });
    crash = true;
    await assert.rejects(a.sync({ hooks }), SyncOffline);
    await a.sync();
    rows = await serverRows("children", p.familyId);
    assert.equal(rows[0].first, "Mira");
    assert.equal(rows[0].rev, 2);
    assert.deepEqual(a.outbox(), []);
    assert.deepEqual(await versions(p.familyId), [], "a repeat is not a conflict");
  });

  it("an interrupted download repeats at most one page and ends complete", async () => {
    const p = await parent("sync-int-down");
    const a = await p.device(), b = await p.device();
    a.edit("children", child("c-1", "Mia"));
    for (let i = 0; i < 7; i++) a.edit("entries", entry(`m-${i}`, "c-1", `Entry ${i}`));
    await a.sync();
    let pages = 0;
    const hooks = { beforePageCommit: (table: string) => { if (table === "entries" && ++pages === 2) throw new SyncOffline("connection lost"); } };
    await assert.rejects(b.sync({ pageSize: 3, hooks }), SyncOffline);
    assert.equal(b.live("entries").length, 3, "first page applied, second not");
    const cursorAfterFirst = b.meta().cursors.entries;
    assert.ok(cursorAfterFirst > 0);
    await b.sync({ pageSize: 3 });
    assert.equal(b.live("entries").length, 7);
    assert.ok(b.meta().cursors.entries > cursorAfterFirst);
    assert.deepEqual(b.outbox(), []);
  });
});

describe("record sync: conflicts", () => {
  it("different fields changed on two devices are merged", async () => {
    const p = await parent("sync-merge");
    const a = await p.device(), b = await p.device();
    a.edit("children", child("c-1", "Mia"));
    await a.sync(); await b.sync();
    a.edit("children", { ...a.get("children", "c-1")!, first: "Amelia" });
    b.edit("children", { ...b.get("children", "c-1")!, group: "Toddler" });
    await a.sync(); await b.sync(); await a.sync();
    for (const d of [a, b]) {
      assert.equal(d.get("children", "c-1")?.first, "Amelia");
      assert.equal(d.get("children", "c-1")?.group, "Toddler");
    }
    assert.deepEqual(await versions(p.familyId), []);
  });

  it("the same text changed on two devices: the first one saved stays, the other is kept as a version", async () => {
    const p = await parent("sync-text");
    const a = await p.device(), b = await p.device();
    a.edit("children", child("c-1", "Mia"));
    a.edit("entries", entry("m-1", "c-1", "Original"));
    await a.sync(); await b.sync();
    a.edit("entries", { ...a.get("entries", "m-1")!, text: "A's words" });
    b.edit("entries", { ...b.get("entries", "m-1")!, text: "B's words" });
    await a.sync();
    const r = await b.sync();
    assert.equal(r.conflicts, 1);
    await a.sync();
    for (const d of [a, b]) assert.equal(d.get("entries", "m-1")?.text, "A's words");
    const v = await versions(p.familyId);
    assert.equal(v.length, 1);
    assert.equal(v[0].reason, "text_conflict");
    assert.equal(v[0].table_name, "entries");
    assert.equal(v[0].record_id, "m-1");
    assert.equal((v[0].version as Rec).text, "B's words", "B's text is not lost");
  });

  it("the same short field changed on two devices: the server's value stays, the other is kept (field_conflict)", async () => {
    const p = await parent("sync-field");
    const a = await p.device(), b = await p.device();
    a.edit("children", child("c-1", "Mia"));
    await a.sync(); await b.sync();
    a.edit("children", { ...a.get("children", "c-1")!, dob: "2022-01-01" });
    b.edit("children", { ...b.get("children", "c-1")!, dob: "2022-02-02" });
    await a.sync(); await b.sync(); await a.sync();
    for (const d of [a, b]) assert.equal(d.get("children", "c-1")?.dob, "2022-01-01");
    const v = await versions(p.familyId);
    assert.deepEqual(v.map(x => [x.reason, (x.version as Rec).dob]), [["field_conflict", "2022-02-02"]]);
  });

  it("photos added on both devices to one entry are all kept", async () => {
    const p = await parent("sync-photos-both");
    const a = await p.device(), b = await p.device();
    const pa = await addPhoto(a), pb = await addPhoto(b);
    a.edit("children", child("c-1", "Mia"));
    a.edit("entries", entry("m-1", "c-1", "Park"));
    await a.sync(); await b.sync();
    a.edit("entries", { ...a.get("entries", "m-1")!, photos: [pa] });
    b.edit("entries", { ...b.get("entries", "m-1")!, photos: [pb] });
    await a.sync(); await b.sync(); await a.sync();
    for (const d of [a, b]) assert.deepEqual(d.get("entries", "m-1")?.photos, [pb, pa].sort((x, y) => (x === pb ? -1 : 1)));
  });

  for (const order of ["delete first", "edit first"]) {
    it(`deleted on one device, edited on the other (${order}): it stays deleted and the edit is kept as a version`, async () => {
      const p = await parent("sync-del");
      const a = await p.device(), b = await p.device();
      a.edit("children", child("c-1", "Mia"));
      await a.sync(); await b.sync();
      a.remove("children", "c-1");
      b.edit("children", { ...b.get("children", "c-1")!, first: "Mia Rose" });
      if (order === "delete first") { await a.sync(); await b.sync(); } else { await b.sync(); await a.sync(); }
      await a.sync(); await b.sync();
      for (const d of [a, b]) assert.ok(d.get("children", "c-1")?.deletedAt, "deleted on both devices");
      assert.ok((await serverRows("children", p.familyId))[0].deleted_at);
      const v = await versions(p.familyId);
      assert.equal(v.length, 1);
      assert.equal(v[0].reason, "edited_after_delete");
      assert.equal((v[0].version as Rec).first, "Mia Rose");
    });
  }

  it("a server change arriving while this device has its own unsent edit is merged, never overwritten", async () => {
    const p = await parent("sync-pending");
    const a = await p.device(), b = await p.device();
    a.edit("children", child("c-1", "Mia"));
    await a.sync(); await b.sync();
    a.edit("children", { ...a.get("children", "c-1")!, first: "Amelia" });
    await a.sync();
    // B edits a different field just as its download is about to be applied.
    let edited = false;
    await b.sync({ hooks: { beforePageCommit: (table: string) => { if (table === "children" && !edited) { edited = true; b.edit("children", { ...b.get("children", "c-1")!, group: "Toddler" }); } } } });
    await b.sync(); await a.sync();
    for (const d of [a, b]) assert.deepEqual([d.get("children", "c-1")?.first, d.get("children", "c-1")?.group], ["Amelia", "Toddler"]);
  });
});

describe("record sync: what is not sent", () => {
  it("demo and unknown-origin records are held (not uploaded); records that depend on them wait", async () => {
    const p = await parent("sync-held");
    const a = await p.device();
    a.edit("children", { ...child("emma", "Maya"), origin: "demo" });
    a.edit("entries", { ...entry("m-1", "emma", "On a demo child"), origin: "user" });
    a.edit("saved", { id: "dotting", origin: "unknown" });
    const r = await a.sync();
    assert.equal(r.notSent["children:emma"].state, "held");
    assert.equal(r.notSent["saved:dotting"].state, "held");
    assert.equal(r.notSent["entries:m-1"].state, "waiting");
    assert.deepEqual(await serverRows("children", p.familyId), []);
    assert.deepEqual(await serverRows("entries", p.familyId), []);
    const status = computeStatus({ phase: "idle", lastSyncedAt: "now", outbox: a.outbox(), notSent: r.notSent, children: a.live("children") as never, entries: a.live("entries") as never, photo: () => undefined });
    assert.equal(status.allBackedUp, false);
    assert.equal(status.held, 2);
    assert.equal(status.pending, 1);
  });

  it("a record with a photo: the photo's details are sent (not its file); it counts as waiting for its photo, never all backed up", async () => {
    const p = await parent("sync-photo");
    const a = await p.device(), b = await p.device();
    const photo = await addPhoto(a);
    a.edit("children", child("c-1", "Mia"));
    a.edit("entries", entry("m-1", "c-1", "Painting", [photo]));
    const r = await a.sync();
    assert.deepEqual(r.notSent, {});
    const row = (await serverRows("photos", p.familyId))[0];
    assert.equal(row.id, photo);
    assert.equal(row.sha256, await a.photoChecksum(photo));
    assert.equal(row.uploaded_at, null);
    assert.equal(row.verified_at, null);
    const objects = must(await admin().storage.from("family-photos").list(p.familyId));
    assert.deepEqual(objects, [], "no photo file uploaded");
    const status = (d: Device) => computeStatus({ phase: "idle", lastSyncedAt: "now", outbox: d.outbox(), notSent: {}, children: d.live("children") as never, entries: d.live("entries") as never, photo: id => d.get("photos", id) as never });
    assert.deepEqual([status(a).pending, status(a).photosWaiting, status(a).recordsWaitingForPhotos, status(a).allBackedUp], [0, 1, 1, false]);
    await b.sync();
    assert.deepEqual(b.get("entries", "m-1")?.photos, [photo]);
    assert.deepEqual([status(b).photosWaiting, status(b).allBackedUp], [1, false]);
    // Without photos, the same state is all backed up.
    a.edit("entries", { ...a.get("entries", "m-1")!, photos: [] });
    await a.sync();
    assert.equal(status(a).allBackedUp, true);
  });

  it("a photo whose file is missing on this device fails, and the record showing it waits", async () => {
    const p = await parent("sync-photo-missing");
    const a = await p.device();
    const id = `photo-${randomUUID()}`;
    a.edit("photos", { id, mimeType: "image/jpeg", byteSize: 10, width: 1, height: 1, source: "upload", storagePath: null, uploadedAt: null });
    a.edit("children", child("c-1", "Mia"));
    a.edit("entries", entry("m-1", "c-1", "x", [id]));
    const r = await a.sync();
    assert.equal(r.notSent[`photos:${id}`].state, "failed");
    assert.equal(r.notSent["entries:m-1"].state, "waiting");
    assert.deepEqual(await serverRows("entries", p.familyId), []);
  });
});

async function addPhoto(d: Device): Promise<string> {
  const id = `photo-${randomUUID()}`;
  const bytes = new Uint8Array(randomBytes(64));
  d.blobs.set(id, bytes);
  d.edit("photos", { id, mimeType: "image/jpeg", byteSize: bytes.length, width: 8, height: 8, source: "upload", storagePath: null, uploadedAt: null });
  return id;
}

void TABLE;
