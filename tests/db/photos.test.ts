// Private photo sync (Phase 2B-2 M5) against the local stack: the app's photo transfer (src/lib/sync/photos.ts), the
// private family-photos bucket and the verify-photo Edge Function (supabase/functions). Needs the stack with the
// Edge runtime (`npm run db:start`).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { SyncOffline, sha256Hex } from "../../src/lib/sync/engine.ts";
import { BUCKET, resetPhotoRetries, storagePath } from "../../src/lib/sync/photos.ts";
import { computeStatus } from "../../src/lib/sync/status.ts";
import { localEnv, must, serviceClient } from "./helpers.ts";
import { Device, addPhoto, parent } from "./syncDevice.ts";

const admin = () => serviceClient();
const photoRow = async (familyId: string, id: string) => must(await admin().from("photos").select("*").eq("family_id", familyId).eq("id", id).maybeSingle());
const objectBytes = async (path: string) => {
  const { data, error } = await admin().storage.from(BUCKET).download(path);
  return error || !data ? null : new Uint8Array(await data.arrayBuffer());
};
const child = { id: "c-1", first: "Mia", last: "Li", dob: "2022-03-04", enrolled: "", lessons: 0, group: "Primary", photo: "", interests: [] };
const entryWith = (photo: string) => ({ id: `m-${randomUUID()}`, childId: "c-1", date: "2026-10-01", title: "Painting", text: "", photos: [photo] });
const status = (d: Device, photosFailed: Record<string, string> = {}) => computeStatus({
  phase: "idle", lastSyncedAt: "now", outbox: d.outbox(), notSent: {}, photosFailed,
  children: d.live("children") as never, entries: d.live("entries") as never, photo: id => d.get("photos", id) as never,
});
const same = (a: Uint8Array | null | undefined, b: Uint8Array | null | undefined) => !!a && !!b && Buffer.from(a).equals(Buffer.from(b));

// A family with one child, a memory showing a new photo, synced (records) on device A.
async function withPhoto(label: string, size = 2048) {
  const p = await parent(label);
  const a = await p.device();
  const photo = await addPhoto(a, size, true);
  a.edit("children", child);
  a.edit("entries", entryWith(photo));
  await a.sync();
  const path = storagePath(p.familyId, { id: photo, mimeType: "image/jpeg" });
  return { p, a, photo, path, original: new Uint8Array(a.blobs.get(photo)!) };
}

describe("photo files: upload, verification, download", () => {
  it("a new photo is uploaded, verified by the server, and only then counts as backed up", async () => {
    const { p, a, photo, path, original } = await withPhoto("ph-new");
    assert.equal(status(a).allBackedUp, false, "details on the server, file not yet");
    const r = await a.syncFiles();
    assert.deepEqual([r.verified, r.failed], [[photo], {}]);
    const row = await photoRow(p.familyId, photo);
    assert.ok(row.verified_at);
    assert.equal(row.server_sha256, row.sha256);
    assert.equal(row.sha256, await sha256Hex(original.buffer as ArrayBuffer));
    assert.ok(same(await objectBytes(path), original), "stored exactly");
    assert.ok(a.get("photos", photo)?.verifiedAt);
    assert.equal(status(a).allBackedUp, true);
  });

  it("another device of the family downloads it, checks it, and keeps an identical copy", async () => {
    const { p, a, photo, original } = await withPhoto("ph-down");
    await a.syncFiles();
    const b = await p.device();
    await b.sync(); // the photo's row (now verified) and the memory
    assert.equal(b.hasBytes(photo), false);
    const r = await b.syncFiles();
    assert.deepEqual(r.downloaded, [photo]);
    assert.ok(same(b.blobs.get(photo), original));
    assert.equal(status(b).allBackedUp, true);
  });

  it("an unverified photo is never downloaded (other devices wait for the server's check)", async () => {
    const { p, photo } = await withPhoto("ph-unverified");
    const b = await p.device();
    await b.sync();
    const r = await b.syncFiles();
    assert.deepEqual(r.downloaded, []);
    assert.equal(b.hasBytes(photo), false);
    assert.equal(status(b).allBackedUp, false);
  });
});

describe("photo files: offline, interruptions, retries", () => {
  it("a photo added offline is kept, then sent and verified once the device is back online", async () => {
    const p = await parent("ph-offline");
    const a = await p.device();
    a.offline = true;
    const photo = await addPhoto(a, 1024, true);
    a.edit("children", child);
    a.edit("entries", entryWith(photo));
    await assert.rejects(a.syncAll(), SyncOffline);
    assert.ok(a.hasBytes(photo));
    a.offline = false;
    const { files } = await a.syncAll();
    assert.deepEqual(files.verified, [photo]);
    assert.equal(status(a).allBackedUp, true);
  });

  it("a large photo uses a resumable upload that continues where an interrupted one stopped", async () => {
    const size = 7 * 1024 * 1024 + 123; // two chunks
    const { p, a, photo, path, original } = await withPhoto("ph-large", size);
    const offsets: number[] = [];
    let interrupt = true;
    const hooks = { afterChunk: (_id: string, offset: number) => { offsets.push(offset); if (interrupt) { interrupt = false; throw new SyncOffline("connection lost after the first chunk"); } } };
    await assert.rejects(a.syncFiles(hooks), SyncOffline);
    assert.equal(offsets[0], 6 * 1024 * 1024, "first chunk stored");
    assert.ok(a.get("photos", photo)?.uploadUrl, "the upload's address is kept, so it can resume");
    assert.equal(await objectBytes(path), null, "no object until the upload completes");
    const r = await a.syncFiles(hooks);
    assert.deepEqual(r.verified, [photo]);
    assert.deepEqual(offsets, [6 * 1024 * 1024, size], "resumed from the first chunk, not from the start");
    assert.ok(same(await objectBytes(path), original));
    assert.equal(a.get("photos", photo)?.uploadUrl, null);
    assert.ok((await photoRow(p.familyId, photo)).verified_at);
  });

  it("a corrupted upload is rejected by the server and removed; the local copy is kept and the next try succeeds", async () => {
    const { p, a, photo, path, original } = await withPhoto("ph-corrupt-up");
    const flip = (_id: string, blob: Blob) => new Blob([new Uint8Array(blob.size).fill(7)], { type: blob.type });
    const r = await a.syncFiles({ tamperUpload: flip });
    assert.match(r.failed[photo], /didn't match/);
    assert.equal(await objectBytes(path), null, "the wrong file was deleted by verify-photo");
    assert.equal((await photoRow(p.familyId, photo)).verified_at, null);
    assert.ok(same(a.blobs.get(photo), original), "the device's own copy is untouched");
    const s = status(a, r.failed);
    assert.deepEqual([s.photosWaiting, s.photosFailed, s.allBackedUp], [1, 1, false]);
    const retry = await a.syncFiles();
    assert.deepEqual(retry.verified, [photo]);
    assert.ok(same(await objectBytes(path), original));
  });

  it("after repeated rejected uploads the photo is reported and left alone; its local copy is kept", async () => {
    const { a, photo, original } = await withPhoto("ph-flag");
    const flip = (_id: string, blob: Blob) => new Blob([new Uint8Array(blob.size).fill(9)], { type: blob.type });
    for (let i = 0; i < 3; i++) await a.syncFiles({ tamperUpload: flip });
    const r = await a.syncFiles({ tamperUpload: flip });
    assert.match(r.failed[photo], /several times/);
    assert.ok(same(a.blobs.get(photo), original));
    assert.equal(status(a, r.failed).allBackedUp, false);
  });

  it("Try again: a photo given up on is sent again, verified, and then backed up", async () => {
    const { p, a, photo, path, original } = await withPhoto("ph-retry");
    const flip = (_id: string, blob: Blob) => new Blob([new Uint8Array(blob.size).fill(5)], { type: blob.type });
    for (let i = 0; i < 3; i++) await a.syncFiles({ tamperUpload: flip });
    const stuck = await a.syncFiles();
    assert.match(stuck.failed[photo], /several times/, "without Try again it stays given up, even with a good connection");
    assert.equal(await resetPhotoRetries(a, Object.keys(stuck.failed)), 1);
    assert.equal(await resetPhotoRetries(a, ["photo-not-failed"]), 0, "only the photos that failed are touched");
    const retry = await a.syncFiles();
    assert.deepEqual(retry.verified, [photo]);
    assert.deepEqual(retry.failed, {});
    assert.ok(same(await objectBytes(path), original), "the right file is stored");
    assert.ok((await photoRow(p.familyId, photo)).verified_at);
    assert.equal(status(a, retry.failed).allBackedUp, true);
    assert.deepEqual((await a.syncFiles()).verified, [], "a second Try again changes nothing");
  });

  it("Try again while the server still rejects the file: counted again, the local copy is kept", async () => {
    const { a, photo, original } = await withPhoto("ph-retry-bad");
    const flip = (_id: string, blob: Blob) => new Blob([new Uint8Array(blob.size).fill(4)], { type: blob.type });
    for (let i = 0; i < 3; i++) await a.syncFiles({ tamperUpload: flip });
    await resetPhotoRetries(a, [photo]);
    const r = await a.syncFiles({ tamperUpload: flip });
    assert.match(r.failed[photo], /didn't match/);
    assert.equal((a.get("photos", photo) as { mismatches?: number }).mismatches, 1);
    assert.ok(same(a.blobs.get(photo), original));
  });

  it("a corrupted download is discarded and reported; the next download stores the right file", async () => {
    const { p, a, photo, original } = await withPhoto("ph-corrupt-down");
    await a.syncFiles();
    const b = await p.device();
    await b.sync();
    const r = await b.syncFiles({ tamperDownload: (_id, blob) => new Blob([new Uint8Array(blob.size)], { type: blob.type }) });
    assert.match(r.failed[photo], /didn't match/);
    assert.equal(b.hasBytes(photo), false, "nothing stored");
    const retry = await b.syncFiles();
    assert.deepEqual(retry.downloaded, [photo]);
    assert.ok(same(b.blobs.get(photo), original));
  });

  it("a file replaced on the server after verification is never accepted by a downloading device", async () => {
    const { p, a, photo, path } = await withPhoto("ph-replaced");
    await a.syncFiles();
    // Clients can't do this (no update policy); a server-side mistake is simulated with the service role.
    must(await admin().storage.from(BUCKET).update(path, new Blob([randomBytes(2048)], { type: "image/jpeg" }), { contentType: "image/jpeg", upsert: true }));
    const b = await p.device();
    await b.sync();
    const r = await b.syncFiles();
    assert.match(r.failed[photo], /didn't match/);
    assert.equal(b.hasBytes(photo), false);
  });
});

describe("photo files: no duplicates", () => {
  it("an upload whose answer was lost is recognised: the file is not sent or stored again", async () => {
    const { p, a, photo, path } = await withPhoto("ph-dup");
    await a.syncFiles();
    const before = (await admin().storage.from(BUCKET).list(p.familyId)).data!;
    // The device forgets it was verified (as if the answer never arrived).
    a.records.set(`photos:${photo}`, { ...a.get("photos", photo)!, verifiedAt: null });
    let uploads = 0;
    const r = await a.syncFiles({ tamperUpload: (_id, blob) => { uploads++; return blob; } });
    assert.deepEqual(r.verified, [photo]);
    assert.equal(uploads, 0, "verify-photo found it; nothing re-sent");
    const after = (await admin().storage.from(BUCKET).list(p.familyId)).data!;
    assert.deepEqual(after.map(o => [o.name, o.updated_at]), before.map(o => [o.name, o.updated_at]), "one object, untouched");
    // And the bucket itself refuses to overwrite a stored photo.
    const again = await a.client.storage.from(BUCKET).upload(path, new Blob([randomBytes(10)], { type: "image/jpeg" }), { upsert: false });
    assert.ok(again.error, "a second upload to the same name is refused");
    const overwrite = await a.client.storage.from(BUCKET).upload(path, new Blob([randomBytes(10)], { type: "image/jpeg" }), { upsert: true });
    assert.ok(overwrite.error, "and so is an overwrite");
  });
});

describe("photo files: privacy between families", () => {
  it("another family can't read, list, download, upload, verify or reach a photo through a public URL", async () => {
    const { p, a, photo, path } = await withPhoto("ph-private");
    await a.syncFiles();
    const q = await parent("ph-other");
    const qa = await q.device();
    // Metadata
    assert.deepEqual(must(await qa.client.from("photos").select("id").eq("family_id", p.familyId)), []);
    assert.deepEqual(must(await qa.client.from("photos").select("id").eq("id", photo)), []);
    // Files
    const download = await qa.client.storage.from(BUCKET).download(path);
    assert.ok(download.error, "download refused");
    const listed = await qa.client.storage.from(BUCKET).list(p.familyId);
    assert.deepEqual(listed.data ?? [], [], "listing shows nothing");
    const signed = await qa.client.storage.from(BUCKET).createSignedUrl(path, 60);
    assert.ok(signed.error, "no signed URL for another family's photo");
    const upload = await qa.client.storage.from(BUCKET).upload(`${p.familyId}/photo-${randomUUID()}.jpg`, new Blob([randomBytes(10)], { type: "image/jpeg" }));
    assert.ok(upload.error, "can't add files to another family's folder");
    // verify-photo answers "not found", revealing nothing
    const verify = await qa.client.functions.invoke("verify-photo", { body: { familyId: p.familyId, photoId: photo } });
    assert.equal((verify.error as { context?: { status?: number } } | null)?.context?.status, 404);
    // No session at all
    const anon = createClient(localEnv().url, localEnv().anonKey, { auth: { persistSession: false } });
    assert.ok((await anon.storage.from(BUCKET).download(path)).error, "no download without a session");
    const fn = await fetch(`${localEnv().url}/functions/v1/verify-photo`, { method: "POST", headers: { apikey: localEnv().anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ familyId: p.familyId, photoId: photo }) });
    assert.equal(fn.status, 401);
    // A key or a forged token in place of a session is refused before anything is read
    const call = (bearer: string) => fetch(`${localEnv().url}/functions/v1/verify-photo`, { method: "POST", headers: { apikey: localEnv().anonKey, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify({ familyId: p.familyId, photoId: photo }) });
    assert.equal((await call(localEnv().anonKey)).status, 401, "the public key is not a session");
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: p.user.id, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 })}`;
    const forged = `${body}.${createHmac("sha256", "not-the-server-secret-not-the-server-secret").update(body).digest("base64url")}`;
    assert.equal((await call(forged)).status, 401, "a token not issued by Auth (even naming the family's own parent) is refused");
    assert.equal((await call("garbage")).status, 401);
    assert.equal((await photoRow(p.familyId, photo)).verified_at !== null, true, "the photo itself is unaffected");
    // The bucket is private: its "public" URL serves nothing
    const publicUrl = anon.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    assert.notEqual((await fetch(publicUrl)).status, 200);
    assert.equal(must(await admin().storage.getBucket(BUCKET)).public, false);
  });

  it("a member can't store a file for which no photo row exists, nor mark a photo verified themselves", async () => {
    const { p, a, photo } = await withPhoto("ph-rules");
    const stray = await a.client.storage.from(BUCKET).upload(`${p.familyId}/photo-${randomUUID()}.jpg`, new Blob([randomBytes(10)], { type: "image/jpeg" }));
    assert.ok(stray.error, "only files a photo row describes");
    const forged = await a.client.from("photos").update({ verified_at: new Date().toISOString() }).eq("family_id", p.familyId).eq("id", photo).select();
    assert.ok(forged.error || !forged.data?.length, "verification is server-only");
    assert.equal((await photoRow(p.familyId, photo)).verified_at, null);
  });
});

describe("photo files: what is not uploaded", () => {
  it("a photo of demo or unknown origin (ownership not established) is not uploaded", async () => {
    const p = await parent("ph-held");
    const a = await p.device();
    const id = `photo-${randomUUID()}`;
    const bytes = new Uint8Array(randomBytes(64));
    a.blobs.set(id, bytes);
    a.edit("photos", { id, mimeType: "image/jpeg", byteSize: 64, width: 1, height: 1, source: "migrated", storagePath: null, uploadedAt: null, origin: "unknown" });
    const r = await a.syncAll();
    assert.equal(r.records.notSent[`photos:${id}`].state, "held");
    assert.deepEqual(r.files.verified, []);
    assert.equal((await admin().storage.from(BUCKET).list(p.familyId)).data?.length ?? 0, 0);
  });
});
