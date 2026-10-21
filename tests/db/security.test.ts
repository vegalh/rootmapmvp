// Two-account security matrix (docs/data-architecture-phase2.md section 7.5), through the same API path the
// app will use. Storage cases (9, 14) are in storage.test.ts.
// A and B are unrelated parents, each with their own family.

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { anonClient, must, newParent, newPhotoId } from "./helpers.ts";

type Parent = Awaited<ReturnType<typeof newParent>>;
let A: Parent;
let B: Parent;
const aPhoto = newPhotoId();

const FAMILY_TABLES = ["children", "entries", "activity_records", "plans", "goals", "saved_activities", "saved_collections", "photos", "record_versions", "cloud_migrations"];

before(async () => {
  [A, B] = await Promise.all([newParent("sec-a"), newParent("sec-b")]);
  const f = A.familyId;
  must(await A.client.from("children").insert({ family_id: f, id: "a-child", first: "Mia", last: "李" }));
  must(await A.client.from("children").insert({ family_id: f, id: "emma", first: "Maya", origin: "demo" }));
  must(await A.client.from("photos").insert({ family_id: f, id: aPhoto, mime_type: "image/jpeg", byte_size: 10, sha256: "a".repeat(64) }));
  must(await A.client.from("entries").insert({ family_id: f, id: "a-entry", child_id: "a-child", date: "2026-10-01", text: "第一次走路", photo_ids: [aPhoto] }));
  must(await A.client.from("entries").insert({ family_id: f, id: "a-deleted", child_id: "a-child", date: "2026-10-02", text: "gone", deleted_at: new Date().toISOString() }));
  must(await A.client.from("activity_records").insert({ family_id: f, id: "a-tried", child_id: "a-child", kind: "tried", activity_id: "water-pouring", date: "2026-10-03" }));
  must(await A.client.from("plans").insert({ family_id: f, id: "a-plan", activity_id: "dotting", date: "2026-10-04", child_ids: ["a-child"] }));
  must(await A.client.from("goals").insert({ family_id: f, id: "a-goal", owner_user_id: A.id, title: "Read together" }));
  must(await A.client.from("saved_activities").insert({ family_id: f, id: "water-pouring" }));
  must(await A.client.from("saved_collections").insert({ family_id: f, id: "rainy-day" }));
  must(await A.client.from("profiles").insert({ user_id: A.id, display_name: "A" }));
  must(await A.client.from("user_settings").insert({ user_id: A.id, key: "language", value: "zh" }));
});

describe("cross-family isolation", () => {
  it("1. B cannot read A's child by its key", async () => {
    const rows = must(await B.client.from("children").select("*").eq("family_id", A.familyId).eq("id", "a-child"));
    assert.deepEqual(rows, []);
  });

  it("2. B sees only B's rows in every table", async () => {
    for (const t of FAMILY_TABLES) {
      const rows = must(await B.client.from(t).select("family_id")) as { family_id: string }[];
      assert.ok(rows.every(r => r.family_id === B.familyId), `${t} leaked another family's rows`);
    }
    assert.deepEqual((must(await B.client.from("families").select("id")) as { id: string }[]).map(r => r.id), [B.familyId]);
    assert.ok((must(await B.client.from("family_members").select("user_id")) as { user_id: string }[]).every(r => r.user_id === B.id));
    assert.deepEqual(must(await B.client.from("profiles").select("*").eq("user_id", A.id)), []);
    assert.deepEqual(must(await B.client.from("user_settings").select("*").eq("user_id", A.id)), []);
  });

  it("3. B cannot read A's soft-deleted entry", async () => {
    assert.deepEqual(must(await B.client.from("entries").select("*").eq("id", "a-deleted")), []);
  });

  it("4. B cannot update or soft-delete A's child", async () => {
    const renamed = must(await B.client.from("children").update({ first: "Hacked" }).eq("family_id", A.familyId).eq("id", "a-child").select());
    assert.deepEqual(renamed, []);
    const deleted = must(await B.client.from("children").update({ deleted_at: new Date().toISOString() }).eq("id", "a-child").select());
    assert.deepEqual(deleted, []);
    const [mine] = must(await A.client.from("children").select("first, deleted_at").eq("id", "a-child")) as { first: string; deleted_at: string | null }[];
    assert.equal(mine.first, "Mia");
    assert.equal(mine.deleted_at, null);
  });

  it("5. B cannot insert into A's family", async () => {
    for (const t of ["children", "saved_activities", "saved_collections"]) {
      const { error } = await B.client.from(t).insert({ family_id: A.familyId, id: "intruder" });
      assert.ok(error, `${t}: insert into another family was accepted`);
    }
    const { error } = await B.client.from("entries").insert({ family_id: A.familyId, id: "intruder", child_id: "a-child", date: "2026-10-05" });
    assert.ok(error);
    assert.deepEqual(must(await A.client.from("children").select("id").eq("id", "intruder")), []);
  });

  it("6. B can use the same id as A in B's own family, learning nothing about A", async () => {
    must(await B.client.from("children").insert({ family_id: B.familyId, id: "emma", first: "Emma" }));
    const [a] = must(await A.client.from("children").select("first").eq("id", "emma")) as { first: string }[];
    assert.equal(a.first, "Maya");
  });

  it("7. B cannot move a row into A's family", async () => {
    must(await B.client.from("children").insert({ family_id: B.familyId, id: "b-child", first: "Leo" }));
    const { error } = await B.client.from("children").update({ family_id: A.familyId }).eq("family_id", B.familyId).eq("id", "b-child");
    assert.ok(error, "family_id change was accepted");
    assert.deepEqual(must(await A.client.from("children").select("id").eq("id", "b-child")), []);
  });

  it("8. B cannot reference A's child or photo", async () => {
    const f = B.familyId;
    const attempts = [
      B.client.from("entries").insert({ family_id: f, id: "b-e1", child_id: "a-child", date: "2026-10-06" }),
      B.client.from("activity_records").insert({ family_id: f, id: "b-r1", child_id: "a-child", date: "2026-10-06" }),
      B.client.from("plans").insert({ family_id: f, id: "b-p1", activity_id: "dotting", date: "2026-10-06", child_ids: ["a-child"] }),
      B.client.from("entries").insert({ family_id: f, id: "b-e2", child_id: "emma", date: "2026-10-06", photo_ids: [aPhoto] }),
      B.client.from("children").insert({ family_id: f, id: "b-c2", photo_ref: aPhoto }),
    ];
    for (const [i, res] of (await Promise.all(attempts)).entries()) assert.ok(res.error, `attempt ${i} was accepted`);
  });

  it("10. B cannot add themselves to A's family", async () => {
    const { error } = await B.client.from("family_members").insert({ family_id: A.familyId, user_id: B.id, role: "parent" });
    assert.ok(error);
    assert.deepEqual(must(await B.client.from("children").select("id").eq("family_id", A.familyId)), []);
  });

  it("11. create_family() cannot be called twice", async () => {
    const { error } = await B.client.rpc("create_family", { family_name: "second" });
    assert.ok(error);
    assert.equal((must(await B.client.from("family_members").select("family_id")) as unknown[]).length, 1);
  });

  it("12. private helpers are not callable, and forged user metadata grants nothing", async () => {
    for (const fn of ["is_family_member", "my_family_ids", "stamp_row", "photo_object_allowed"]) {
      const { error } = await B.client.rpc(fn, {});
      assert.ok(error, `${fn} is exposed`);
    }
    must(await B.client.auth.updateUser({ data: { family_id: A.familyId, role: "service_role", is_admin: true } }));
    await B.client.auth.refreshSession();
    assert.deepEqual(must(await B.client.from("children").select("id").eq("family_id", A.familyId)), []);
  });

  it("13. clients cannot write server-controlled columns", async () => {
    const f = B.familyId;
    const spoofs: Record<string, unknown>[] = [{ rev: 999 }, { change_seq: 999 }, { updated_by: A.id }, { server_updated_at: "2000-01-01T00:00:00Z" }];
    for (const s of spoofs) {
      const ins = await B.client.from("children").insert({ family_id: f, id: `spoof-${Object.keys(s)[0]}`, ...s });
      assert.ok(ins.error, `insert with ${JSON.stringify(s)} was accepted`);
      const upd = await B.client.from("children").update(s).eq("family_id", f).eq("id", "b-child");
      assert.ok(upd.error, `update of ${JSON.stringify(s)} was accepted`);
    }
    const [row] = must(await B.client.from("children").select("rev, updated_by").eq("id", "b-child")) as { rev: number; updated_by: string }[];
    assert.equal(row.rev, 1);
    assert.equal(row.updated_by, B.id);

    const bPhoto = newPhotoId();
    assert.ok((await B.client.from("photos").insert({ family_id: f, id: bPhoto, mime_type: "image/jpeg", byte_size: 5, sha256: "b".repeat(64), verified_at: new Date().toISOString() })).error);
    must(await B.client.from("photos").insert({ family_id: f, id: bPhoto, mime_type: "image/jpeg", byte_size: 5, sha256: "b".repeat(64) }));
    for (const s of [{ verified_at: new Date().toISOString() }, { server_sha256: "b".repeat(64) }, { sha256: "c".repeat(64) }, { byte_size: 6 }, { mime_type: "image/png" }]) {
      assert.ok((await B.client.from("photos").update(s).eq("id", bPhoto)).error, `photo update ${JSON.stringify(s)} was accepted`);
    }
    assert.ok((await B.client.from("goals").insert({ family_id: f, id: "b-goal", owner_user_id: A.id, title: "x" })).error, "goal for another user accepted");
    must(await B.client.from("goals").insert({ family_id: f, id: "b-goal", owner_user_id: B.id, title: "x" }));
    assert.ok((await B.client.from("goals").update({ owner_user_id: A.id }).eq("id", "b-goal")).error);
    assert.ok((await B.client.from("cloud_migrations").insert({ family_id: f, id: "m1", device_id: "d", status: "complete" })).error);
    must(await B.client.from("cloud_migrations").insert({ family_id: f, id: "m1", device_id: "d" }));
    assert.ok((await B.client.from("cloud_migrations").update({ status: "complete" }).eq("id", "m1")).error);
    assert.ok((await B.client.from("families").update({ change_seq: 0, purged_through_seq: 0 }).eq("id", f)).error);
    const version = { family_id: f, id: "v1", table_name: "children", record_id: "b-child", version: { first: "x" }, reason: "field_conflict" };
    assert.ok((await B.client.from("record_versions").insert({ ...version, created_by: A.id })).error, "created_by was insertable");
    const [v] = must(await B.client.from("record_versions").insert(version).select("created_by")) as { created_by: string }[];
    assert.equal(v.created_by, B.id);
    assert.ok((await B.client.from("record_versions").update({ version: { first: "y" } }).eq("id", "v1")).error, "saved version was editable");
  });

  it("15. no session: nothing readable or writable", async () => {
    const anon = anonClient();
    for (const t of [...FAMILY_TABLES, "families", "family_members", "profiles", "user_settings"]) {
      const { data, error } = await anon.from(t).select("*").limit(1);
      assert.ok(error || (data ?? []).length === 0, `${t} readable without a session`);
    }
    assert.ok((await anon.from("children").insert({ family_id: A.familyId, id: "anon" })).error);
    assert.ok((await anon.rpc("create_family", { family_name: "anon" })).error);
  });

  it("16. no client can hard-delete a row", async () => {
    const { error } = await B.client.from("children").delete().eq("family_id", B.familyId).eq("id", "b-child");
    assert.ok(error, "delete was accepted");
    assert.equal((must(await B.client.from("children").select("id").eq("id", "b-child")) as unknown[]).length, 1);
    assert.ok((await A.client.from("family_members").delete().eq("user_id", A.id)).error);
  });

  it("A cannot reach B's data either, and still reaches its own", async () => {
    assert.deepEqual(must(await A.client.from("children").select("*").eq("family_id", B.familyId)), []);
    assert.deepEqual(must(await A.client.from("children").update({ first: "x" }).eq("family_id", B.familyId).select()), []);
    const own = must(await A.client.from("children").select("id").eq("family_id", A.familyId)) as unknown[];
    assert.equal(own.length, 2);
    const [entry] = must(await A.client.from("entries").select("text").eq("id", "a-entry")) as { text: string }[];
    assert.equal(entry.text, "第一次走路");
  });
});
