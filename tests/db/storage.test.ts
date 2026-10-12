// Private photo storage (docs/data-architecture-phase2.md sections 7.3, 7.5 cases 9 and 14, and 8).

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { anonClient, must, newParent, newPhotoId, serviceClient, sha256 } from "./helpers.ts";

type Parent = Awaited<ReturnType<typeof newParent>>;
const BUCKET = "family-photos";
let A: Parent;
let B: Parent;

// Creates the photo row (the server derives storage_path) and returns it with the bytes.
async function photoRow(p: Parent, bytes = randomBytes(2048)) {
  const id = newPhotoId();
  const [row] = must(await p.client.from("photos").insert({ family_id: p.familyId, id, mime_type: "image/jpeg", byte_size: bytes.length, sha256: sha256(bytes) }).select()) as { id: string; storage_path: string }[];
  return { ...row, bytes };
}

const upload = (p: Parent, path: string, bytes: Uint8Array, upsert = false) =>
  p.client.storage.from(BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert });

let aUploaded: Awaited<ReturnType<typeof photoRow>>;

before(async () => {
  [A, B] = await Promise.all([newParent("sto-a"), newParent("sto-b")]);
  aUploaded = await photoRow(A);
  must(await upload(A, aUploaded.storage_path, aUploaded.bytes));
});

describe("photo storage", () => {
  it("the server derives the object path from the family and photo id", () => {
    assert.equal(aUploaded.storage_path, `${A.familyId}/${aUploaded.id}.jpg`);
  });

  it("the bucket is private: its public URL serves nothing", async () => {
    const { data } = A.client.storage.from(BUCKET).getPublicUrl(aUploaded.storage_path);
    const res = await fetch(data.publicUrl);
    assert.notEqual(res.status, 200);
    const bucket = must(await serviceClient().storage.getBucket(BUCKET)) as { public: boolean; file_size_limit: number; allowed_mime_types: string[] };
    assert.equal(bucket.public, false);
    assert.equal(bucket.file_size_limit, 15728640);
    assert.deepEqual([...bucket.allowed_mime_types].sort(), ["image/heic", "image/jpeg", "image/png", "image/webp"]);
  });

  it("the owner can download the photo, and its bytes match the recorded hash", async () => {
    const blob = must(await A.client.storage.from(BUCKET).download(aUploaded.storage_path)) as Blob;
    assert.equal(sha256(new Uint8Array(await blob.arrayBuffer())), sha256(aUploaded.bytes));
  });

  it("an uploaded photo can never be overwritten or deleted by a client", async () => {
    assert.ok((await upload(A, aUploaded.storage_path, randomBytes(2048))).error, "second upload accepted");
    assert.ok((await upload(A, aUploaded.storage_path, randomBytes(2048), true)).error, "upsert accepted");
    await A.client.storage.from(BUCKET).remove([aUploaded.storage_path]);
    const blob = must(await A.client.storage.from(BUCKET).download(aUploaded.storage_path)) as Blob;
    assert.equal(sha256(new Uint8Array(await blob.arrayBuffer())), sha256(aUploaded.bytes), "object changed or vanished");
  });

  it("9. B cannot download, list, sign, or upload into A's photos", async () => {
    const bucket = B.client.storage.from(BUCKET);
    assert.ok((await bucket.download(aUploaded.storage_path)).error, "download accepted");
    const listed = await bucket.list(A.familyId);
    assert.ok(listed.error || (listed.data ?? []).length === 0, "listing returned A's objects");
    assert.ok((await bucket.createSignedUrl(aUploaded.storage_path, 60)).error, "signed URL created");
    const pending = await photoRow(A); // A's row exists, object not uploaded yet
    assert.ok((await upload(B, pending.storage_path, pending.bytes)).error, "B uploaded into A's path");
    must(await upload(A, pending.storage_path, pending.bytes));
  });

  it("14. object names outside the allowed pattern are rejected", async () => {
    const own = await photoRow(A);
    const names = [
      `${A.familyId}/${newPhotoId()}.jpg`, // no photo row
      `${A.familyId}/${own.id}.png`, // extension does not match the row
      `${A.familyId}/${own.id}.gif`,
      `${A.familyId}/../${B.familyId}/${own.id}.jpg`,
      `${A.familyId}/sub/${own.id}.jpg`,
      `${B.familyId}/${own.id}.jpg`, // another family's folder
      `not-a-uuid/${own.id}.jpg`,
      `${own.id}.jpg`,
      `${A.familyId}/${own.id}.jpg.exe`,
      `${randomUUID()}/${own.id}.jpg`,
    ];
    for (const name of names) assert.ok((await upload(A, name, own.bytes)).error, `accepted ${name}`);
    must(await upload(A, own.storage_path, own.bytes));
  });

  it("no session: no access to any photo", async () => {
    const bucket = anonClient().storage.from(BUCKET);
    assert.ok((await bucket.download(aUploaded.storage_path)).error);
    const listed = await bucket.list(A.familyId);
    assert.ok(listed.error || (listed.data ?? []).length === 0);
    assert.ok((await bucket.upload(`${A.familyId}/${newPhotoId()}.jpg`, randomBytes(10), { contentType: "image/jpeg" })).error);
  });

  it("only the server can mark a photo verified, and doing so is a tracked change", async () => {
    const [before] = must(await A.client.from("photos").select("rev, change_seq").eq("id", aUploaded.id)) as { rev: number; change_seq: number }[];
    must(await serviceClient().from("photos").update({ server_sha256: sha256(aUploaded.bytes), verified_at: new Date().toISOString() }).eq("family_id", A.familyId).eq("id", aUploaded.id));
    const [after] = must(await A.client.from("photos").select("rev, change_seq, verified_at, updated_by").eq("id", aUploaded.id)) as { rev: number; change_seq: number; verified_at: string; updated_by: string | null }[];
    assert.equal(after.rev, before.rev + 1);
    assert.ok(after.change_seq > before.change_seq);
    assert.ok(after.verified_at);
    assert.equal(after.updated_by, null);
  });
});
