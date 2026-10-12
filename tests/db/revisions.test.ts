// Server-side revision control and conditional writes (docs/data-architecture-phase2.md section 4).

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbConnection, must, newParent, newPhotoId, secondDevice, serviceClient } from "./helpers.ts";

type Parent = Awaited<ReturnType<typeof newParent>>;
type Row = { id: string; first: string; rev: number; change_seq: number; updated_by: string | null; server_updated_at: string; deleted_at: string | null };
let A: Parent;
let deviceB: SupabaseClient;
let db: pg.Client;

const familySeq = async () => Number((await db.query("select change_seq from public.families where id = $1", [A.familyId])).rows[0].change_seq);
const child = async (id: string) => (must(await A.client.from("children").select("*").eq("family_id", A.familyId).eq("id", id)) as Row[])[0];

before(async () => {
  A = await newParent("rev");
  deviceB = await secondDevice(A);
  db = await dbConnection();
});
after(() => db.end());

describe("revision columns", () => {
  it("an insert gets rev 1, the family's next change number, the server time and the author", async () => {
    const seqBefore = await familySeq();
    const [row] = must(await A.client.from("children").insert({ family_id: A.familyId, id: "r-1", first: "Mia" }).select()) as Row[];
    assert.equal(row.rev, 1);
    assert.equal(row.change_seq, seqBefore + 1);
    assert.equal(await familySeq(), seqBefore + 1);
    assert.equal(row.updated_by, A.id);
    assert.ok(Math.abs(Date.parse(row.server_updated_at) - Date.now()) < 60_000);
  });

  it("every update raises rev by 1 and takes a new change number", async () => {
    const before = await child("r-1");
    const [row] = must(await A.client.from("children").update({ first: "Mia Li" }).eq("family_id", A.familyId).eq("id", "r-1").select()) as Row[];
    assert.equal(row.rev, before.rev + 1);
    assert.ok(row.change_seq > before.change_seq);
  });

  it("a soft deletion is an ordinary tracked update", async () => {
    const before = await child("r-1");
    const [row] = must(await A.client.from("children").update({ deleted_at: new Date().toISOString() }).eq("family_id", A.familyId).eq("id", "r-1").select()) as Row[];
    assert.equal(row.rev, before.rev + 1);
    assert.ok(row.change_seq > before.change_seq);
    assert.ok(row.deleted_at);
    const restored = must(await A.client.from("children").update({ deleted_at: null }).eq("family_id", A.familyId).eq("id", "r-1").select()) as Row[];
    assert.equal(restored[0].deleted_at, null);
  });
});

describe("conditional writes", () => {
  it("a stale revision is refused and the newer write survives", async () => {
    must(await A.client.from("children").insert({ family_id: A.familyId, id: "c-1", first: "Base" }));
    const base = await child("c-1");
    const first = must(await A.client.from("children").update({ first: "From device A" }).eq("family_id", A.familyId).eq("id", "c-1").eq("rev", base.rev).select()) as Row[];
    assert.equal(first.length, 1);
    const stale = must(await deviceB.from("children").update({ first: "From device B" }).eq("family_id", A.familyId).eq("id", "c-1").eq("rev", base.rev).select()) as Row[];
    assert.deepEqual(stale, [], "a write based on an old revision overwrote newer data");
    const now = await child("c-1");
    assert.equal(now.first, "From device A");
    assert.equal(now.rev, base.rev + 1);
  });

  it("an insert of an existing id never overwrites (on conflict do nothing)", async () => {
    must(await A.client.from("children").insert({ family_id: A.familyId, id: "c-2", first: "Original" }));
    const res = must(await deviceB.from("children").upsert({ family_id: A.familyId, id: "c-2", first: "Duplicate" }, { onConflict: "family_id,id", ignoreDuplicates: true }).select()) as Row[];
    assert.deepEqual(res, [], "the duplicate insert reported success");
    const now = await child("c-2");
    assert.equal(now.first, "Original");
    assert.equal(now.rev, 1);
  });

  it("an upsert that would update is refused (clients may only insert or conditionally update)", async () => {
    const res = await deviceB.from("children").upsert({ family_id: A.familyId, id: "c-2", first: "Overwrite", rev: 1 }, { onConflict: "family_id,id" });
    assert.ok(res.error);
    assert.equal((await child("c-2")).first, "Original");
  });
});

describe("immutable identity and guards (even for the server)", () => {
  it("family_id and id can never change", async () => {
    const other = await newParent("rev-other");
    await assert.rejects(db.query("update public.children set family_id = $1 where family_id = $2 and id = 'c-1'", [other.familyId, A.familyId]), /cannot change/);
    await assert.rejects(db.query("update public.children set id = 'c-1-renamed' where family_id = $1 and id = 'c-1'", [A.familyId]), /cannot change/);
    const svc = await serviceClient().from("children").update({ id: "renamed" }).eq("family_id", A.familyId).eq("id", "c-1");
    assert.ok(svc.error);
  });

  it("a photo's hash, type and size never change", async () => {
    const id = newPhotoId();
    must(await A.client.from("photos").insert({ family_id: A.familyId, id, mime_type: "image/jpeg", byte_size: 3, sha256: "d".repeat(64) }));
    await assert.rejects(db.query("update public.photos set sha256 = $1 where family_id = $2 and id = $3", ["e".repeat(64), A.familyId, id]), /cannot change/);
    await assert.rejects(db.query("update public.photos set byte_size = 4 where family_id = $1 and id = $2", [A.familyId, id]), /cannot change/);
  });

  it("a goal's owner never changes", async () => {
    must(await A.client.from("goals").insert({ family_id: A.familyId, id: "g-1", owner_user_id: A.id, title: "Walk daily" }));
    const other = await newParent("rev-goal");
    await assert.rejects(db.query("update public.goals set owner_user_id = $1 where family_id = $2 and id = 'g-1'", [other.id, A.familyId]), /cannot change/);
  });

  it("server writes also take revisions and change numbers", async () => {
    const before = await child("c-2");
    must(await serviceClient().from("children").update({ notes: "server" }).eq("family_id", A.familyId).eq("id", "c-2"));
    const now = await child("c-2");
    assert.equal(now.rev, before.rev + 1);
    assert.ok(now.change_seq > before.change_seq);
    assert.equal(now.updated_by, null);
  });

  it("references are checked within the family", async () => {
    assert.ok((await A.client.from("plans").insert({ family_id: A.familyId, id: "p-1", activity_id: "dotting", date: "2026-10-01", child_ids: ["c-2", "missing"] })).error);
    must(await A.client.from("plans").insert({ family_id: A.familyId, id: "p-1", activity_id: "dotting", date: "2026-10-01", child_ids: ["c-2", "r-1"] }));
    assert.ok((await A.client.from("entries").insert({ family_id: A.familyId, id: "e-1", child_id: "c-2", date: "2026-10-01", photo_ids: [newPhotoId()] })).error);
    assert.ok((await A.client.from("children").insert({ family_id: A.familyId, id: "c-3", photo_ref: newPhotoId() })).error);
    must(await A.client.from("children").insert({ family_id: A.familyId, id: "c-3", photo_ref: "bundled:maya" }));
  });

  it("text is stored exactly as given (Chinese, emoji, combining marks)", async () => {
    const text = "宝宝第一次说“妈妈” 🎉 — é vs é";
    must(await A.client.from("children").insert({ family_id: A.familyId, id: "u-1", first: "小明", last: "", notes: text }));
    const row = (must(await A.client.from("children").select("first, last, notes").eq("id", "u-1")) as { first: string; last: string; notes: string }[])[0];
    assert.equal(row.first, "小明");
    assert.equal(row.last, "");
    assert.equal(row.notes, text);
  });

  it("every Phase 1 id form is accepted", async () => {
    for (const id of ["r1", "c-1712345678901", "m-2f1c6a8e-1b7d-4c3e-9a2f-0d4b5e6f7a8b", "entry~2", "emma"]) {
      must(await A.client.from("saved_activities").insert({ family_id: A.familyId, id }));
    }
    assert.ok((await A.client.from("saved_activities").insert({ family_id: A.familyId, id: "" })).error);
    assert.ok((await A.client.from("saved_activities").insert({ family_id: A.familyId, id: "bad\nid" })).error);
  });
});
