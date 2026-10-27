import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CHILD_PHOTO, clientRow, fromRow, insertPayload, toRow, updatePayload, type SyncedCollection } from "../../src/lib/sync/mapping.ts";
import { fromProfileRow, nextProfileAction, toProfileRow, type ProfileRow } from "../../src/lib/sync/profile.ts";
import { resolve } from "../../src/lib/sync/resolver.ts";
import { computeStatus } from "../../src/lib/sync/status.ts";

// Record sync's pure parts (Phase 2B-2 M4). The engine against a real server: tests/db/sync.test.ts.

const meta = { createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-02T10:00:00.000Z", deletedAt: null, origin: "user", position: 3 };
const samples: [SyncedCollection, Record<string, unknown>][] = [
  ["children", { id: "c-1", first: "Mia", last: "", dob: "2022-03-04", enrolled: "Sept 2025", enrolledZh: "2025年9月", lessons: 4, group: "Primary", photo: "photo-11111111-1111-4111-8111-111111111111", notes: "Loves water", interests: ["Art"], ...meta }],
  ["records", { id: "r-1", childId: "c-1", lesson: "Pouring", area: "Practical Life", stage: "Practicing", date: "2026-10-01", notes: "n", nextSteps: "s", skills: ["Order"], notesZh: "z", ...meta }],
  ["records", { id: "t-1", childId: "c-1", lesson: "Pouring", date: "2026-10-01", kind: "tried", activityId: "water-pouring", ...meta }],
  ["entries", { id: "m-1", childId: "c-1", date: "2026-10-01", title: "Park", text: "Slide", photos: ["photo-11111111-1111-4111-8111-111111111111"], fromNotes: true, ...meta, createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-02T10:00:00.000Z" }],
  ["plans", { id: "p-1", activityId: "water-pouring", date: "2026-10-03", childIds: ["c-1"], note: "after lunch", completed: true, completedDate: "2026-10-03", observation: "fun", ...meta }],
  ["goals", { id: "g-1", title: "Read", description: "daily", completed: true, completedAt: "2026-10-05T00:00:00.000Z", ...meta, createdAt: "2026-10-01T10:00:00.000Z" }],
  ["saved", { id: "water-pouring", ...meta }],
];

test("mapping: every synced record survives the round trip local → server row → local unchanged", () => {
  for (const [collection, local] of samples) {
    const row = toRow(collection, local, { userId: "u-1" });
    // The server returns the row with its own columns; the client part must read back the same.
    const server = { ...row, family_id: "f", rev: 1, change_seq: 9, server_updated_at: "x", updated_by: "u-1" };
    assert.deepEqual(clientRow(collection, server), row, `${collection} row`);
    const back = fromRow(collection, server, undefined);
    for (const [k, v] of Object.entries(local)) assert.deepEqual(back[k], v, `${collection}.${k}`);
  }
});

test("mapping: what is sent never includes server-owned columns; identity and fixed columns are not updated", () => {
  const row = toRow("goals", samples[5][1], { userId: "u-1" });
  assert.equal(row.owner_user_id, "u-1", "goals belong to the signed-in parent");
  const ins = insertPayload("goals", row, "f-1");
  assert.equal(ins.family_id, "f-1");
  for (const k of ["rev", "change_seq", "server_updated_at", "updated_by"]) assert.ok(!(k in ins), k);
  const upd = updatePayload("goals", row);
  for (const k of ["id", "family_id", "owner_user_id"]) assert.ok(!(k in upd), k);
});

test("mapping: child photos the server can't hold are kept on the device; the default photo travels as a bundled key", () => {
  const withDefault = toRow("children", { ...samples[0][1], photo: DEFAULT_CHILD_PHOTO }, { userId: "u" });
  assert.equal(withDefault.photo_ref, "bundled:default-child");
  assert.equal(fromRow("children", withDefault, undefined).photo, DEFAULT_CHILD_PHOTO);
  const demoAsset = toRow("children", { ...samples[0][1], photo: "/assets/maya.png" }, { userId: "u" });
  assert.equal(demoAsset.photo_ref, null);
  assert.equal(fromRow("children", demoAsset, { photo: "/assets/maya.png" }).photo, "/assets/maya.png");
  // Local-only fields survive a download.
  assert.equal(fromRow("children", demoAsset, { photo: "/assets/maya.png", extra: 1 }).extra, 1);
});

test("mapping: a record the server would refuse (no valid date) is reported, not sent", () => {
  assert.throws(() => toRow("entries", { ...samples[3][1], date: "" }, { userId: "u" }), /date/);
});

// ---- Resolver -----------------------------------------------------------------------------------------------

const base = { id: "m-1", child_id: "c-1", date: "2026-10-01", title: null, text: "Original", text_zh: null, photo_ids: [], from_notes: false, legacy: null, created_at: "t0", updated_at: "t0", deleted_at: null, origin: "user", position: 0, legacy_id: null, migrated_at: null };

test("resolver: changes to different fields are merged; nothing is kept as a version", () => {
  const r = resolve("entries", base, { ...base, title: "Park", updated_at: "t2" }, { ...base, date: "2026-10-02", updated_at: "t1" });
  assert.deepEqual([r.merged.title, r.merged.date, r.merged.updated_at], ["Park", "2026-10-02", "t2"]);
  assert.deepEqual(r.losers, []);
});

test("resolver: the same long text changed on both sides keeps the server's and saves the local version", () => {
  const local = { ...base, text: "Mine" }, server = { ...base, text: "Theirs" };
  const r = resolve("entries", base, local, server);
  assert.equal(r.merged.text, "Theirs");
  assert.deepEqual(r.losers, [{ version: local, reason: "text_conflict" }]);
});

test("resolver: the same short field changed on both sides keeps the server's value (field_conflict); the same change on both is no conflict", () => {
  const r = resolve("entries", base, { ...base, date: "2026-10-05" }, { ...base, date: "2026-10-06" });
  assert.equal(r.merged.date, "2026-10-06");
  assert.equal(r.losers[0].reason, "field_conflict");
  assert.deepEqual(resolve("entries", base, { ...base, date: "2026-10-05" }, { ...base, date: "2026-10-05" }).losers, []);
});

test("resolver: photos added on both sides are all kept, local order first; one removed locally stays removed", () => {
  const b = { ...base, photo_ids: ["p1", "p2"] };
  const r = resolve("entries", b, { ...b, photo_ids: ["p2", "p3"] }, { ...b, photo_ids: ["p1", "p2", "p4"] });
  assert.deepEqual(r.merged.photo_ids, ["p2", "p3", "p4"]);
  assert.deepEqual(r.losers, []);
});

test("resolver: deleted on one side and edited on the other stays deleted, and the edit is kept", () => {
  const deleted = { ...base, deleted_at: "t5" };
  const edited = { ...base, text: "Edited" };
  const a = resolve("entries", base, deleted, edited); // deleted here, edited on the server
  assert.equal(a.merged.deleted_at, "t5");
  assert.equal(a.merged.text, "Edited", "the server's content stays with the tombstone");
  assert.deepEqual(a.losers, [{ version: edited, reason: "edited_after_delete" }]);
  const b = resolve("entries", base, edited, deleted); // edited here, deleted on the server
  assert.equal(b.merged.deleted_at, "t5");
  assert.deepEqual(b.losers, [{ version: edited, reason: "edited_after_delete" }]);
  // Deleted on both: deleted, nothing kept.
  assert.deepEqual(resolve("entries", base, deleted, { ...base, deleted_at: "t6" }).losers, []);
});

test("resolver: with no shared version (same id created on both), identical content is no conflict; different content keeps the local version", () => {
  assert.deepEqual(resolve("entries", null, base, { ...base }).losers, []);
  const r = resolve("entries", null, { ...base, text: "Mine" }, base);
  assert.equal(r.merged.text, "Original");
  assert.equal(r.losers[0].reason, "text_conflict");
});

test("resolver: display order and display time never make a conflict on their own", () => {
  assert.deepEqual(resolve("entries", base, { ...base, position: 5, updated_at: "t9" }, { ...base, position: 7, updated_at: "t8" }).losers, []);
});

// ---- Status -------------------------------------------------------------------------------------------------

test("status: 'All backed up' only when nothing is pending, held, failed, or waiting for a photo, after a completed sync", () => {
  const e = (key: string) => ({ key, collection: key.split(":")[0], id: key.split(":")[1], op: "put", seq: 1, queuedAt: "", changedAt: "", deviceId: "d" }) as never;
  const verified = { verifiedAt: "t" } as never;
  const s = (over: Partial<Parameters<typeof computeStatus>[0]>) => computeStatus({ phase: "idle", lastSyncedAt: "t", outbox: [], notSent: {}, children: [], entries: [], photo: () => undefined, ...over });
  assert.equal(s({}).allBackedUp, true);
  assert.equal(s({ lastSyncedAt: null }).allBackedUp, false, "never synced");
  assert.equal(s({ phase: "offline" }).allBackedUp, false);
  assert.equal(s({ outbox: [e("children:c-1")] }).pending, 1);
  assert.equal(s({ outbox: [e("children:c-1")] }).allBackedUp, false);
  assert.equal(s({ outbox: [e("children:c-1")], notSent: { "children:c-1": { state: "held" } } }).held, 1);
  assert.equal(s({ outbox: [e("children:c-1")], notSent: { "children:c-1": { state: "failed" } } }).failed, 1);
  assert.equal(s({ outbox: [e("observations:o-1")] }).allBackedUp, true, "local-only collections don't count");
  const photo = "photo-11111111-1111-4111-8111-111111111111";
  const withPhoto = s({ entries: [{ id: "m-1", photos: [photo] }] });
  assert.deepEqual([withPhoto.photosWaiting, withPhoto.recordsWaitingForPhotos, withPhoto.allBackedUp], [1, 1, false]);
  assert.equal(s({ entries: [{ id: "m-1", photos: [photo] }], photo: () => verified }).allBackedUp, true);
  assert.equal(s({ entries: [{ id: "m-1", photos: [photo], deletedAt: "t" }] }).allBackedUp, true, "deleted records don't wait");
});

test("photos: a failed upload counts as waiting (and failed), never backed up; the object name is the one the server derives", async () => {
  const { storagePath } = await import("../../src/lib/sync/photos.ts");
  const photo = "photo-11111111-1111-4111-8111-111111111111";
  const s = computeStatus({ phase: "idle", lastSyncedAt: "t", outbox: [], notSent: {}, photosFailed: { [photo]: "didn't match" }, children: [], entries: [{ id: "m-1", photos: [photo] }], photo: () => undefined });
  assert.deepEqual([s.photosWaiting, s.photosFailed, s.allBackedUp], [1, 1, false]);
  // Same as photos.storage_path (generated column): <family>/<photo id>.<ext from the type>.
  assert.equal(storagePath("f-1", { id: photo, mimeType: "image/png" }), `f-1/${photo}.png`);
  assert.equal(storagePath("f-1", { id: photo, mimeType: "image/heic" }), `f-1/${photo}.heic`);
});

// ---- Profile (the parent's own name/photo/contact; a user-scoped singleton, not a SyncedCollection) ---------

test("profile: local ↔ row round trip; a photo the server can't hold (no valid id) is dropped, not sent", () => {
  const photo = "photo-11111111-1111-4111-8111-111111111111";
  const row = toProfileRow({ name: "Alex", photo, contact: "alex@example.com" });
  assert.deepEqual(row, { display_name: "Alex", photo_ref: photo, contact: "alex@example.com" });
  assert.deepEqual(fromProfileRow(row), { name: "Alex", photo, contact: "alex@example.com" });
  assert.equal(toProfileRow({ name: "Alex", photo: "/assets/alex.png", contact: "" }).photo_ref, null);
});

test("profile: first sync on a device (nothing known yet) always adopts whatever the server already holds", () => {
  const remote: ProfileRow = { display_name: "Alex", photo_ref: null, contact: "" };
  const current: ProfileRow = { display_name: "", photo_ref: null, contact: "" };
  assert.deepEqual(nextProfileAction(remote, null, current), { kind: "adopt", row: remote });
});

test("profile: nothing changed on either side since the last sync does nothing", () => {
  const row: ProfileRow = { display_name: "Alex", photo_ref: null, contact: "c" };
  assert.deepEqual(nextProfileAction(row, row, row), { kind: "none" });
});

test("profile: only this device changed (the server still matches what was last known) pushes", () => {
  const known: ProfileRow = { display_name: "Alex", photo_ref: null, contact: "" };
  const current: ProfileRow = { display_name: "Alexandra", photo_ref: null, contact: "" };
  assert.deepEqual(nextProfileAction(known, known, current), { kind: "push", row: current });
});

test("profile: the server changed (another device) adopts it, even if this device also made local-only edits not yet seen as 'current' here", () => {
  const known: ProfileRow = { display_name: "Alex", photo_ref: null, contact: "" };
  const remote: ProfileRow = { display_name: "Alexandra", photo_ref: null, contact: "" }; // pushed by another device
  const current: ProfileRow = { display_name: "Alex W.", photo_ref: null, contact: "" }; // this device's unsynced edit
  // Last write wins by "whichever reached the server first": the remote is adopted, not overwritten.
  assert.deepEqual(nextProfileAction(remote, known, current), { kind: "adopt", row: remote });
});

// Documents a known, intentional limitation (not a bug: there is no per-field merge or record_versions equivalent
// for this user-scoped singleton, unlike every SyncedCollection, which resolver.ts merges field by field). Two
// devices offline at once, each changing a *different* field: whichever device's push reaches the server first
// wins outright, and the other device's own unsynced change to the other field is silently discarded, with
// nothing kept anywhere to recover it. Family-data collections never lose a concurrent, different-field edit this
// way (resolver.ts merges them); the parent's own profile can, and does, by design.
test("profile: two devices change different fields while both offline; the one that reaches the server second loses its change entirely, with nothing kept", () => {
  const base: ProfileRow = { display_name: "Alex", photo_ref: null, contact: "old@example.com" };
  const onDeviceA: ProfileRow = { ...base, display_name: "Alexandra" }; // A only changes the name
  const onDeviceB: ProfileRow = { ...base, contact: "new@example.com" }; // B only changes the contact, concurrently

  // A syncs first: the server still matches what A last knew, so A's change pushes cleanly.
  const aAction = nextProfileAction(base, base, onDeviceA);
  assert.deepEqual(aAction, { kind: "push", row: onDeviceA });
  const serverAfterA = aAction.kind === "push" ? aAction.row : base;

  // B syncs next, still only knowing `base`: the server has moved (A's push), so B adopts it outright...
  const bAction = nextProfileAction(serverAfterA, base, onDeviceB);
  assert.deepEqual(bAction, { kind: "adopt", row: serverAfterA });
  // ...which both brings in A's name change and discards B's own contact change (not merged, not recorded).
  assert.equal(bAction.kind, "adopt");
  if (bAction.kind === "adopt") {
    assert.equal(bAction.row.display_name, "Alexandra", "A's change survives");
    assert.equal(bAction.row.contact, "old@example.com", "B's own concurrent change to a different field is lost");
  }
});
