// Bringing guest data into an account (Phase 2B-2 M6) against the local stack: the app's own import code
// (src/lib/sync/guestImport.ts) with the record and photo sync (engine.ts, photos.ts) and the server's
// complete_migration(). The guest space is an in-memory snapshot that is deep-frozen, so any attempt to change it
// fails the test; the account space is the in-memory device of the sync tests.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { initialChildren } from "../../src/data/children.ts";
import { initialObservations, initialRecords } from "../../src/data/progress.ts";
import type { GuestSnapshot } from "../../src/lib/data/guestPlan.ts";
import { outboxEntries } from "../../src/lib/data/records.ts";
import { outboxKey, type PhotoMeta } from "../../src/lib/data/schema.ts";
import { SyncOffline, sha256Hex } from "../../src/lib/sync/engine.ts";
import {
  acceptGuestImport, advanceGuestImport, dismissGuestImport, importProgress, prepareGuestImport, type GuestImportLocal, type GuestImportState, type ImportContext,
} from "../../src/lib/sync/guestImport.ts";
import { must, serviceClient } from "./helpers.ts";
import { Device, device, parent, type Rec } from "./syncDevice.ts";

const admin = () => serviceClient();
const rows = async (table: string, familyId: string) => must(await admin().from(table).select("*").eq("family_id", familyId).order("id")) as Rec[];
const DEMO_SAVED = ["water-pouring", "dotting"];
// The bundled demo pictures' bytes (the app hashes what it ships; the test loader gives their file URLs).
const demoPictures = initialChildren.map(c => new Uint8Array(readFileSync(new URL(c.photo))));
const seed = { records: initialRecords, observations: initialObservations, saved: DEMO_SAVED, photoSha: demoPictures.map(b => createHash("sha256").update(b).digest("hex")) };
const ctxFor = (p: { user: { id: string }; familyId: string }): ImportContext => ({ familyId: p.familyId, userId: p.user.id, demo: initialChildren, seed });
const T = "2026-09-01T10:00:00.000Z";

// ---- A guest space ---------------------------------------------------------------------------------------------

type Guest = { snapshot: GuestSnapshot; blobs: Map<string, Uint8Array>; frozen: string };
const deepFreeze = <V>(v: V): V => { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); for (const x of Object.values(v)) deepFreeze(x); } return v; };

// The guest space a device has after using RootMap without an account: the demo content as the app stores it
// (including the memories it made from the demo observations, stored with origin "user"), plus `extra`.
function guestSpace(extra: Partial<GuestSnapshot["collections"]> = {}, photos: { meta: PhotoMeta; bytes: Uint8Array }[] = [], demo = true): Guest {
  const meta = { createdAt: null, updatedAt: T, deletedAt: null, migratedAt: T };
  const collections: GuestSnapshot["collections"] = {
    children: demo ? initialChildren.map((c, i) => ({ ...c, ...meta, origin: "demo" as const, position: i })) : [],
    records: demo ? initialRecords.map((r, i) => ({ ...r, ...meta, origin: "demo" as const, position: i })) : [],
    observations: demo ? initialObservations.map((o, i) => ({ ...o, ...meta, origin: "demo" as const, position: i })) : [],
    entries: demo ? initialObservations.map((o, i) => ({ id: `obs-${o.id}`, childId: o.childId, date: o.date, text: o.notes, textZh: o.notesZh, photos: [], createdAt: `${o.date}T12:00:00.000Z`, updatedAt: T, deletedAt: null, origin: "user" as const, position: i, legacyObservation: o })) : [],
    plans: [],
    goals: [],
    saved: demo ? DEMO_SAVED.map((id, i) => ({ id, ...meta, origin: "demo" as const, position: i })) : [],
    savedCollections: [],
  };
  for (const [k, list] of Object.entries(extra)) (collections as Record<string, unknown[]>)[k] = [...(collections as Record<string, unknown[]>)[k], ...(list as unknown[])];
  const snapshot: GuestSnapshot = { collections, photos: photos.map(p => p.meta), drafts: 1, archive: 0 };
  const g = { snapshot: deepFreeze(snapshot), blobs: new Map(photos.map(p => [p.meta.id, p.bytes])), frozen: "" };
  g.frozen = JSON.stringify(snapshot);
  return g;
}
async function photo(size = 512, withSha = true): Promise<{ meta: PhotoMeta; bytes: Uint8Array }> {
  const bytes = new Uint8Array(randomBytes(size));
  const id = `photo-${randomUUID()}`;
  return { bytes, meta: { id, mimeType: "image/jpeg", byteSize: size, width: 4, height: 4, createdAt: T, updatedAt: T, deletedAt: null, source: "upload", storagePath: null, uploadedAt: null, ...(withSha ? { sha256: await sha256Hex(bytes.buffer as ArrayBuffer) } : {}) } };
}
const own = (id: string, first: string, more: Record<string, unknown> = {}) => ({ id, first, last: "Li", dob: "2022-03-04", enrolled: "", lessons: 0, group: "Primary", photo: "", createdAt: T, updatedAt: T, deletedAt: null, origin: "user" as const, position: 10, ...more });
const memory = (id: string, childId: string, text: string, photos: string[] = [], more: Record<string, unknown> = {}) => ({ id, childId, date: "2026-09-01", title: "", text, photos, createdAt: T, updatedAt: T, deletedAt: null, origin: "user" as const, position: 10, ...more });

// ---- The account space, as the import sees it (the same rules as lib/data/store.ts importGuestCopy) ------------

function local(d: Device, guest: Guest): GuestImportLocal & { setState(s: GuestImportState | null): void } {
  let state: GuestImportState | null = null;
  const all = (prefix: string) => [...d.records.entries()].filter(([k]) => k.startsWith(`${prefix}:`)).map(([, r]) => r);
  return {
    guest: async () => guest.snapshot,
    guestPhotoBytes: async id => (guest.blobs.has(id) ? new Blob([guest.blobs.get(id)!], { type: "image/jpeg" }) : null),
    records: c => all(c),
    photos: () => all("photos") as unknown as PhotoMeta[],
    state: () => state,
    setState: s => { state = s; },
    saveState: async s => { state = s; },
    copy: async ({ records, photos, state: next, expectStateId }) => {
      if ((state?.id ?? null) !== expectStateId) return "decided";
      const keys = [...records.map(r => outboxKey(r.collection, String(r.record.id))), ...photos.map(p => outboxKey("photos", p.meta.id))];
      if (keys.some(k => d.records.has(k))) return "exists";
      const now = new Date().toISOString();
      for (const r of records) d.records.set(outboxKey(r.collection, String(r.record.id)), r.record as Rec);
      for (const p of photos) { d.records.set(outboxKey("photos", p.meta.id), p.meta as unknown as Rec); d.blobs.set(p.meta.id, new Uint8Array(await p.blob.arrayBuffer())); }
      const queue = [...records.map(r => [r.collection, r.record] as const), ...photos.map(p => ["photos", p.meta] as const)];
      for (const [c, r] of queue) for (const e of outboxEntries(c, [r as { id: string }], d.out, { now, deviceId: d.m.deviceId, nextSeq: () => ++d.seq })) d.out.set(e.key, e);
      state = next;
      return "ok";
    },
    syncRecord: k => d.syncRecord(k),
    outbox: () => d.outbox(),
    deviceId: () => d.m.deviceId,
  };
}

// Sync rounds (records, photos, then the import's completion step) until done, as the app's runner does.
async function syncUntilComplete(d: Device, l: GuestImportLocal, p: { user: { id: string }; familyId: string }, rounds = 4) {
  let last = { status: "none" } as Awaited<ReturnType<typeof advanceGuestImport>>;
  for (let i = 0; i < rounds && last.status !== "complete"; i++) {
    await d.syncAll();
    last = await advanceGuestImport(d.client, l, { familyId: p.familyId, userId: p.user.id });
  }
  return last;
}
const unchanged = (g: Guest) => assert.equal(JSON.stringify(g.snapshot), g.frozen, "the guest space is unchanged");
const ids = (list: Rec[]) => list.map(r => r.id).sort();

// ---- Tests -------------------------------------------------------------------------------------------------------

describe("guest import: what is brought in", () => {
  it("the parent's own children, memories, activities, plans, goals, saved activities and collections and photos reach the account, verified", async () => {
    const p = await parent("gi-own");
    const a = await p.device();
    const ph = await photo(700);
    const g = guestSpace({
      children: [own("c-ada", "Ada", { photo: ph.meta.id })],
      entries: [memory("m-1", "c-ada", "First painting", [ph.meta.id]), memory("m-2", "c-ada", "Second")],
      records: [{ id: "t-1", childId: "c-ada", kind: "tried", activityId: "water-pouring", lesson: "Water Pouring", date: "2026-09-02", createdAt: T, updatedAt: T, deletedAt: null, origin: "user", position: 9 }],
      plans: [{ id: "p-1", activityId: "dotting", date: "2026-09-03", childIds: ["c-ada"], createdAt: T, updatedAt: T, deletedAt: null, origin: "user", position: 0 }],
      goals: [{ id: "g-1", title: "Read together", completed: false, createdAt: T, updatedAt: T, deletedAt: null, origin: "user", position: 0 }],
      saved: [{ id: "sandpaper-letters", createdAt: T, updatedAt: T, deletedAt: null, origin: "user", position: 5 }],
      savedCollections: [{ id: "rainy-day", createdAt: T, updatedAt: T, deletedAt: null, origin: "user", position: 0 }],
    }, [ph]);
    const l = local(a, g);
    const prepared = (await prepareGuestImport(a.client, l, ctxFor(p)))!;
    assert.equal(prepared.offer.plan.needsConfirmation, false, "nothing uncertain: one question only");
    assert.deepEqual(prepared.offer.childNames, ["Ada Li"]);
    assert.deepEqual(prepared.offer.demoKept.sort(), ["Leo Hao", "Maya Hao"], "untouched demo children stay");
    assert.deepEqual({ ...prepared.offer.sure }, { children: 1, entries: 2, records: 1, plans: 1, goals: 1, saved: 1, savedCollections: 1, photos: 1 });

    const accepted = await acceptGuestImport(a.client, l, ctxFor(p), { includeUncertain: false, sameChild: {} }, prepared);
    assert.equal(accepted.status, "copied");
    assert.equal(importProgress(l).done, 0);
    const done = await syncUntilComplete(a, l, p);
    assert.equal(done.status, "complete");
    assert.equal(l.state()!.status, "complete");

    assert.deepEqual(ids(await rows("children", p.familyId)), ["c-ada"], "no demo child uploaded");
    assert.deepEqual(ids(await rows("entries", p.familyId)), ["m-1", "m-2"], "the demo memories (obs-o1, obs-o2) stay");
    assert.deepEqual(ids(await rows("activity_records", p.familyId)), ["t-1"], "demo records r1–r4 stay");
    assert.deepEqual(ids(await rows("plans", p.familyId)), ["p-1"]);
    assert.deepEqual(ids(await rows("goals", p.familyId)), ["g-1"]);
    assert.deepEqual(ids(await rows("saved_activities", p.familyId)), ["sandpaper-letters"], "default saved activities stay");
    assert.deepEqual(ids(await rows("saved_collections", p.familyId)), ["rainy-day"]);
    const serverPhoto = (await rows("photos", p.familyId))[0];
    assert.equal(serverPhoto.id, ph.meta.id);
    assert.equal(serverPhoto.server_sha256, ph.meta.sha256);
    assert.ok(serverPhoto.verified_at);
    const entry = (await rows("entries", p.familyId)).find(e => e.id === "m-1")!;
    assert.equal(entry.text, "First painting");
    assert.deepEqual(entry.photo_ids, [ph.meta.id]);
    const migration = (await rows("cloud_migrations", p.familyId))[0];
    assert.equal(migration.status, "complete");
    assert.equal(migration.device_id, a.m.deviceId);
    assert.deepEqual((migration.manifest as { sources: Record<string, string> }).sources["children:c-ada"], "c-ada");
    unchanged(g);
  });

  it("untouched demo data alone: nothing to bring in, nothing uploaded", async () => {
    const p = await parent("gi-demo");
    const a = await p.device();
    const g = guestSpace();
    const prepared = (await prepareGuestImport(a.client, local(a, g), ctxFor(p)))!;
    assert.equal(prepared.offer.nothingToImport, true);
    assert.deepEqual(prepared.offer.plan.ask, [], "no question about demo content or default saved activities");
    unchanged(g);
  });

  it("a demo child the parent made their own (renamed) comes with its records; the untouched one stays", async () => {
    const p = await parent("gi-made-own");
    const a = await p.device();
    const g = guestSpace();
    const renamed = { ...g.snapshot.collections.children[0], first: "Mia" };
    const g2 = guestSpace({}, [], false);
    const snap = JSON.parse(g.frozen) as GuestSnapshot;
    snap.collections.children[0] = renamed;
    const guest: Guest = { snapshot: deepFreeze(snap), blobs: g2.blobs, frozen: JSON.stringify(snap) };
    const l = local(a, guest);
    const accepted = await acceptGuestImport(a.client, l, ctxFor(p), { includeUncertain: false, sameChild: {} });
    assert.equal(accepted.status, "copied");
    assert.equal((await syncUntilComplete(a, l, p)).status, "complete");
    assert.deepEqual(ids(await rows("children", p.familyId)), ["emma"]);
    assert.equal((await rows("children", p.familyId))[0].first, "Mia");
    assert.deepEqual(ids(await rows("activity_records", p.familyId)), ["r1", "r2", "r3", "r4"].filter(id => initialRecords.find(r => r.id === id)?.childId === "emma"));
    assert.deepEqual(ids(await rows("entries", p.familyId)), ["obs-o1"], "Maya's memory comes along, Leo's stays");
    unchanged(guest);
  });
});

describe("guest import: demo pictures stored as photos", () => {
  // Older versions stored the bundled demo pictures as photos of their own (SVG, which the bucket doesn't accept).
  async function guestWithStoredDemoPictures(rename: boolean) {
    const snap = JSON.parse(guestSpace().frozen) as GuestSnapshot;
    const photos = await Promise.all(demoPictures.map(async (bytes, i) => {
      const id = `photo-${randomUUID()}`;
      snap.collections.children[i] = { ...snap.collections.children[i], photo: id, ...(rename && i === 0 ? { first: "Mia" } : {}) };
      return { meta: { id, mimeType: "image/svg+xml", byteSize: bytes.length, width: null, height: null, createdAt: null, updatedAt: T, deletedAt: null, source: "migrated" as const, storagePath: null, uploadedAt: null }, bytes };
    }));
    snap.photos = photos.map(p => p.meta);
    return { snapshot: deepFreeze(snap), blobs: new Map(photos.map(p => [p.meta.id, p.bytes])), frozen: JSON.stringify(snap) } as Guest;
  }

  it("a demo child still showing its bundled picture is untouched: nothing to bring in", async () => {
    const p = await parent("gi-demo-pic");
    const a = await p.device();
    const g = await guestWithStoredDemoPictures(false);
    const prepared = (await prepareGuestImport(a.client, local(a, g), ctxFor(p)))!;
    assert.equal(prepared.offer.nothingToImport, true);
    unchanged(g);
  });

  it("a renamed demo child keeps its bundled picture on the device; nothing gets stuck uploading it", async () => {
    const p = await parent("gi-demo-pic-own");
    const a = await p.device();
    const g = await guestWithStoredDemoPictures(true);
    const l = local(a, g);
    const prepared = (await prepareGuestImport(a.client, l, ctxFor(p)))!;
    assert.deepEqual(prepared.offer.childNames, ["Mia Hao"]);
    assert.equal(prepared.offer.sure.photos, 0, "the bundled picture isn't uploaded");
    const r = await acceptGuestImport(a.client, l, ctxFor(p), { includeUncertain: false, sameChild: {} }, prepared);
    assert.equal(r.state!.missingPhotos, 0, "not reported as a problem: it is the app's own picture");
    assert.equal(a.get("children", "emma")!.photo, initialChildren[0].photo, "shown with the bundled picture");
    assert.equal((await syncUntilComplete(a, l, p)).status, "complete");
    assert.equal((await rows("children", p.familyId))[0].photo_ref, null);
    assert.deepEqual(await rows("photos", p.familyId), []);
    unchanged(g);
  });
});

describe("guest import: questions only when needed", () => {
  it("unknown origin: one question; 'leave them' keeps them on the device and doesn't ask again", async () => {
    const p = await parent("gi-unknown");
    const a = await p.device();
    const g = guestSpace({ children: [own("c-1712345678901", "Sam", { origin: "unknown" })], entries: [memory("m-old", "c-1712345678901", "Old note", [], { origin: "unknown" })] }, [], false);
    const l = local(a, g);
    const prepared = (await prepareGuestImport(a.client, l, ctxFor(p)))!;
    assert.equal(prepared.offer.plan.needsConfirmation, true);
    assert.deepEqual(prepared.offer.uncertainChildNames, ["Sam Li"]);
    assert.equal(prepared.offer.uncertain.entries, 1);
    const r = await acceptGuestImport(a.client, l, ctxFor(p), { includeUncertain: false, sameChild: {} }, prepared);
    assert.equal(r.status, "complete", "nothing to upload");
    await a.syncAll();
    assert.deepEqual(await rows("children", p.familyId), []);
    assert.deepEqual(await rows("entries", p.familyId), []);
    const again = (await prepareGuestImport(a.client, l, ctxFor(p)))!;
    assert.equal(again.offer.nothingToImport, true, "not asked again");
    unchanged(g);
  });

  it("unknown origin, 'include them': uploaded like the parent's own", async () => {
    const p = await parent("gi-unknown-yes");
    const a = await p.device();
    const g = guestSpace({ children: [own("c-1712345678901", "Sam", { origin: "unknown" })], entries: [memory("m-old", "c-1712345678901", "Old note", [], { origin: "unknown" })] }, [], false);
    const l = local(a, g);
    await acceptGuestImport(a.client, l, ctxFor(p), { includeUncertain: true, sameChild: {} });
    assert.equal((await syncUntilComplete(a, l, p)).status, "complete");
    assert.deepEqual(ids(await rows("children", p.familyId)), ["c-1712345678901"]);
    assert.deepEqual(ids(await rows("entries", p.familyId)), ["m-old"]);
    assert.equal((await rows("entries", p.familyId))[0].origin, "user", "confirmed by the parent");
    unchanged(g);
  });

  it("a possible duplicate child: 'same child' attaches the memories to the account's child; no second child", async () => {
    const p = await parent("gi-dup-same");
    const other = await p.device();
    other.edit("children", own("c-cloud", "Mia"));
    other.edit("entries", memory("m-cloud", "c-cloud", "From the other phone"));
    await other.sync();
    const a = await p.device();
    await a.sync(); // this device has the account's data
    const g = guestSpace({ children: [own("c-before", "Mia")], entries: [memory("m-guest", "c-before", "From before signing in"), memory("m-same", "c-before", "From the other phone")] }, [], false);
    const l = local(a, g);
    const prepared = (await prepareGuestImport(a.client, l, ctxFor(p)))!;
    assert.deepEqual(prepared.offer.duplicates.map(d => [d.localId, d.cloudId, d.name]), [["c-before", "c-cloud", "Mia Li"]]);
    const r = await acceptGuestImport(a.client, l, ctxFor(p), { includeUncertain: false, sameChild: { "c-before": true } }, prepared);
    assert.equal(r.state!.likelyDuplicates, 1, "a memory that looks like one already there is reported");
    assert.equal((await syncUntilComplete(a, l, p)).status, "complete");
    assert.deepEqual(ids(await rows("children", p.familyId)), ["c-cloud"]);
    const entries = await rows("entries", p.familyId);
    assert.deepEqual(ids(entries), ["m-cloud", "m-guest", "m-same"]);
    assert.ok(entries.every(e => e.child_id === "c-cloud"));
    unchanged(g);
  });

  it("a possible duplicate child: 'different children' keeps both", async () => {
    const p = await parent("gi-dup-diff");
    const other = await p.device();
    other.edit("children", own("c-cloud", "Mia"));
    await other.sync();
    const a = await p.device();
    const g = guestSpace({ children: [own("c-before", "Mia")], entries: [memory("m-guest", "c-before", "Hers")] }, [], false);
    const l = local(a, g);
    await acceptGuestImport(a.client, l, ctxFor(p), { includeUncertain: false, sameChild: { "c-before": false } });
    assert.equal((await syncUntilComplete(a, l, p)).status, "complete");
    assert.deepEqual(ids(await rows("children", p.familyId)), ["c-before", "c-cloud"]);
    assert.equal((await rows("entries", p.familyId))[0].child_id, "c-before");
  });

  it("the same id used by a different child in the account: never merged; the guest child gets a new id", async () => {
    const p = await parent("gi-id-clash");
    const other = await p.device();
    other.edit("children", { ...initialChildren[0], first: "Mia", origin: "user" }); // "emma", made own elsewhere
    await other.sync();
    const a = await p.device();
    const snap = JSON.parse(guestSpace().frozen) as GuestSnapshot;
    snap.collections.children[0] = { ...snap.collections.children[0], first: "Sam", dob: "2021-01-01" }; // "emma" here is Sam
    const g: Guest = { snapshot: deepFreeze(snap), blobs: new Map(), frozen: JSON.stringify(snap) };
    const l = local(a, g);
    await acceptGuestImport(a.client, l, ctxFor(p), { includeUncertain: false, sameChild: {} });
    assert.equal((await syncUntilComplete(a, l, p)).status, "complete");
    const children = await rows("children", p.familyId);
    assert.equal(children.length, 2);
    const mia = children.find(c => c.id === "emma")!;
    assert.equal(mia.first, "Mia", "the account's child is untouched");
    assert.equal(mia.rev, 1);
    const sam = children.find(c => c.id !== "emma")!;
    assert.equal(sam.first, "Sam");
    assert.equal(sam.legacy_id, "emma");
    const records = await rows("activity_records", p.familyId);
    assert.ok(records.length > 0 && records.every(r => r.child_id === sam.id), "Sam's records follow Sam");
    unchanged(g);
  });
});

describe("guest import: existing cloud data, repeats and interruptions", () => {
  it("existing account data is never changed; a repeat brings nothing twice", async () => {
    const p = await parent("gi-repeat");
    const other = await p.device();
    other.edit("children", own("c-x", "Xia"));
    await other.sync();
    const before = await rows("children", p.familyId);
    const a = await p.device();
    const ph = await photo();
    const g = guestSpace({ children: [own("c-ada", "Ada", { photo: ph.meta.id })], entries: [memory("m-1", "c-ada", "One", [ph.meta.id]), memory("m-2", "c-ada", "Two", [ph.meta.id])] }, [ph], false);
    const l = local(a, g);
    await acceptGuestImport(a.client, l, ctxFor(p), { includeUncertain: false, sameChild: {} });
    const second = await acceptGuestImport(a.client, l, ctxFor(p), { includeUncertain: false, sameChild: {} });
    assert.equal(second.status, "decided", "a second tap while the first is under way does nothing");
    assert.equal((await syncUntilComplete(a, l, p)).status, "complete");
    assert.deepEqual((await rows("children", p.familyId)).find(c => c.id === "c-x"), before[0], "untouched");
    // Repeated after completion: nothing new to bring.
    const again = (await prepareGuestImport(a.client, l, ctxFor(p)))!;
    assert.equal(again.offer.nothingToImport, true);
    // The same device with a fresh account space (e.g. site data for the account removed): earlier attempts on the
    // server tell it what was already brought in.
    const fresh = await device(p.user, p.familyId);
    fresh.m.deviceId = a.m.deviceId;
    const l2 = local(fresh, g);
    const p2 = (await prepareGuestImport(fresh.client, l2, ctxFor(p)))!;
    assert.equal(p2.offer.nothingToImport, true, "recognised from the server's record of the earlier attempt");
    assert.deepEqual(ids(await rows("entries", p.familyId)), ["m-1", "m-2"]);
    assert.equal((await rows("photos", p.familyId)).length, 1, "a photo shown twice is stored once");
    assert.equal((await rows("cloud_migrations", p.familyId)).length, 1);
    unchanged(g);
  });

  it("interrupted: offline part-way through the upload, it resumes and completes without duplicates", async () => {
    const p = await parent("gi-offline");
    const a = await p.device();
    const phs = await Promise.all([photo(300), photo(400)]);
    const g = guestSpace({ children: [own("c-ada", "Ada")], entries: phs.map((x, i) => memory(`m-${i}`, "c-ada", `Day ${i}`, [x.meta.id])) }, phs, false);
    const l = local(a, g);
    await acceptGuestImport(a.client, l, ctxFor(p), { includeUncertain: false, sameChild: {} });
    // Records go, then the connection drops before the photo files.
    await a.sync();
    a.offline = true;
    await assert.rejects(a.syncFiles(), SyncOffline);
    await assert.rejects(advanceGuestImport(a.client, l, { familyId: p.familyId, userId: p.user.id }), SyncOffline);
    assert.equal(l.state()!.status, "copied");
    const progress = importProgress(l);
    assert.ok(progress.done < progress.total);
    a.offline = false;
    assert.equal((await syncUntilComplete(a, l, p)).status, "complete");
    assert.equal((await rows("photos", p.familyId)).length, 2);
    assert.ok((await rows("photos", p.familyId)).every(r => r.verified_at));
    assert.deepEqual(ids(await rows("entries", p.familyId)), ["m-0", "m-1"]);
    unchanged(g);
  });

  it("offline when the parent decides: nothing is copied, nothing changes", async () => {
    const p = await parent("gi-offline-start");
    const a = await p.device();
    const g = guestSpace({ children: [own("c-ada", "Ada")] }, [], false);
    const l = local(a, g);
    a.offline = true;
    await assert.rejects(prepareGuestImport(a.client, l, ctxFor(p)), SyncOffline);
    await assert.rejects(acceptGuestImport(a.client, l, ctxFor(p), { includeUncertain: false, sameChild: {} }), SyncOffline);
    assert.equal(l.state(), null);
    assert.equal(a.records.size, 0);
    unchanged(g);
  });

  it("'Not now' copies nothing; the offer stays available", async () => {
    const p = await parent("gi-later");
    const a = await p.device();
    const g = guestSpace({ children: [own("c-ada", "Ada")] }, [], false);
    const l = local(a, g);
    await dismissGuestImport(l);
    assert.equal(l.state()!.status, "dismissed");
    assert.equal(a.records.size, 0);
    const later = (await prepareGuestImport(a.client, l, ctxFor(p)))!;
    assert.deepEqual(later.offer.childNames, ["Ada Li"]);
  });

  it("is not complete until every photo is verified: a missing file is reported and its reference left out", async () => {
    const p = await parent("gi-photo-missing");
    const a = await p.device();
    const present = await photo();
    const lost = await photo();
    const g = guestSpace({ children: [own("c-ada", "Ada")], entries: [memory("m-1", "c-ada", "Two photos", [present.meta.id, lost.meta.id])] }, [present, { meta: lost.meta, bytes: new Uint8Array() }], false);
    g.blobs.delete(lost.meta.id); // the file is gone from this device
    const l = local(a, g);
    const r = await acceptGuestImport(a.client, l, ctxFor(p), { includeUncertain: false, sameChild: {} });
    assert.equal(r.state!.missingPhotos, 1);
    // Before the photo is verified, the server refuses to complete.
    await a.sync();
    const early = must(await a.client.rpc("complete_migration", { p_family_id: p.familyId, p_id: r.state!.id, p_manifest: r.state!.manifest })) as { status: string; unverified: string[] };
    assert.deepEqual([early.status, early.unverified], ["incomplete", [present.meta.id]]);
    assert.equal((await syncUntilComplete(a, l, p)).status, "complete");
    assert.deepEqual((await rows("entries", p.familyId))[0].photo_ids, [present.meta.id]);
    unchanged(g);
  });
});

describe("guest import: accounts and families stay apart", () => {
  it("another family can't see or complete this family's migration, and complete_migration checks its own family only", async () => {
    const p = await parent("gi-iso-a");
    const a = await p.device();
    const g = guestSpace({ children: [own("c-ada", "Ada")] }, [], false);
    const l = local(a, g);
    const r = await acceptGuestImport(a.client, l, ctxFor(p), { includeUncertain: false, sameChild: {} });
    await syncUntilComplete(a, l, p);
    const q = await parent("gi-iso-b");
    const b = await q.device();
    assert.deepEqual(must(await b.client.from("cloud_migrations").select("id").eq("family_id", p.familyId)), []);
    const foreign = await b.client.rpc("complete_migration", { p_family_id: p.familyId, p_id: r.state!.id, p_manifest: r.state!.manifest });
    assert.equal(foreign.error?.code, "42501");
    // B claims A's records in its own family: they aren't there, so nothing completes.
    must(await b.client.from("cloud_migrations").insert({ family_id: q.familyId, id: "gi-b", device_id: "d-b", manifest: {}, updated_at: new Date().toISOString() }));
    const claim = must(await b.client.rpc("complete_migration", { p_family_id: q.familyId, p_id: "gi-b", p_manifest: r.state!.manifest })) as { status: string; missing: string[] };
    assert.equal(claim.status, "incomplete");
    assert.deepEqual(claim.missing, ["children:c-ada"]);
    // Only complete_migration sets the status.
    const forged = await b.client.from("cloud_migrations").update({ status: "complete" }).eq("family_id", q.familyId).eq("id", "gi-b").select();
    assert.ok(forged.error || !forged.data?.length);
    assert.equal((await rows("cloud_migrations", q.familyId))[0].status, "started");
    const noSession = await serviceClient().rpc("complete_migration", { p_family_id: p.familyId, p_id: r.state!.id, p_manifest: {} });
    assert.ok(noSession.error, "no user, no completion");
  });

  it("two accounts on one device: each decides for itself; the guest space stays as it was", async () => {
    const pa = await parent("gi-switch-a");
    const pb = await parent("gi-switch-b");
    const g = guestSpace({ children: [own("c-ada", "Ada")], entries: [memory("m-1", "c-ada", "Hello")] }, [], false);
    const a = await pa.device();
    const la = local(a, g);
    await acceptGuestImport(a.client, la, ctxFor(pa), { includeUncertain: false, sameChild: {} });
    assert.equal((await syncUntilComplete(a, la, pa)).status, "complete");
    const b = await pb.device();
    b.m.deviceId = a.m.deviceId; // same browser
    const lb = local(b, g);
    const offerB = (await prepareGuestImport(b.client, lb, ctxFor(pb)))!;
    assert.deepEqual(offerB.offer.childNames, ["Ada Li"], "B is asked separately (A's attempts are not visible to B)");
    await dismissGuestImport(lb);
    await b.syncAll();
    assert.deepEqual(await rows("children", pb.familyId), [], "nothing of the guest's or A's in B's family");
    assert.deepEqual(ids(await rows("children", pa.familyId)), ["c-ada"]);
    unchanged(g);
  });
});
