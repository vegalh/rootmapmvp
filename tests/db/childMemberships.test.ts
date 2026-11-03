// Per-child memberships, Shared Child Profiles Phase 1a (docs/shared-child-profiles-phase1a.md,
// migration 20261101000100_child_memberships.sql): every child has exactly one owner from the moment it exists,
// existing children were given their family's owner, clients can read only their own memberships (and those of
// children they own) and change none, and nothing about access to child records changes yet.
//
// Synthetic accounts only, against the local Supabase stack (helpers.ts refuses anything else).

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { anonClient, dbConnection, must, newParent, newUser, serviceClient, waitUntilBlocked } from "./helpers.ts";
import { parent } from "./syncDevice.ts";

type Parent = Awaited<ReturnType<typeof newParent>>;
type Membership = { family_id: string; child_id: string; user_id: string; role: string };
let A: Parent; // owns A's children
let B: Parent; // an unrelated parent with their own family
let E: Awaited<ReturnType<typeof newUser>>; // given an editor membership by the server (as an invitation will later)
let db: pg.Client;

const svc = () => serviceClient();
const membersOf = async (familyId: string, childId: string) =>
  must(await svc().from("child_memberships").select("user_id, role").eq("family_id", familyId).eq("child_id", childId).order("role")) as { user_id: string; role: string }[];
const ownersOf = async (familyId: string, childId: string) => (await membersOf(familyId, childId)).filter(m => m.role === "owner");
const addMember = async (familyId: string, childId: string, userId: string, role: string) =>
  must(await svc().from("child_memberships").insert({ family_id: familyId, child_id: childId, user_id: userId, role }));

// Error code of a failed statement on a direct connection (the transaction is rolled back).
async function sqlError(c: pg.Client, statements: string[], params: unknown[][] = []): Promise<string | null> {
  await c.query("begin");
  try {
    for (const [i, s] of statements.entries()) await c.query(s, params[i] ?? []);
    await c.query("commit");
    return null;
  } catch (e) {
    await c.query("rollback");
    return (e as { code?: string }).code ?? "error";
  }
}

before(async () => {
  [A, B, E] = await Promise.all([newParent("cm-a"), newParent("cm-b"), newUser("cm-editor")]);
  must(await A.client.from("children").insert({ family_id: A.familyId, id: "a-child", first: "Mia" }));
  must(await A.client.from("children").insert({ family_id: A.familyId, id: "emma", first: "Maya", origin: "demo" }));
  must(await B.client.from("children").insert({ family_id: B.familyId, id: "emma", first: "Emma" }));
  await addMember(A.familyId, "a-child", E.id, "editor");
  db = await dbConnection();
});

after(async () => { await db?.end(); });

describe("backfill of existing children", () => {
  // Children created before the migration have no memberships. They are simulated here by creating children with the
  // owner trigger switched off, inside a transaction that is rolled back, so nothing is left behind.
  const preMigration = ["alter table public.children disable trigger t20_owner", "alter table public.children disable trigger t50_one_owner"];
  const restore = ["alter table public.children enable trigger t20_owner", "alter table public.children enable trigger t50_one_owner"];
  const insertChild = "insert into public.children (family_id, id, first, deleted_at) values ($1, $2, $3, $4)";

  it("1, 2. gives every existing child, soft-deleted ones too, its family's owner, once", async () => {
    const P = await newParent("cm-backfill");
    await db.query("begin");
    try {
      for (const s of preMigration) await db.query(s);
      await db.query(insertChild, [P.familyId, "old-1", "Ada", null]);
      await db.query(insertChild, [P.familyId, "old-2", "Ben", "2026-10-01T00:00:00Z"]);
      for (const s of restore) await db.query(s);
      const none = await db.query("select count(*)::int n from public.child_memberships where family_id = $1", [P.familyId]);
      assert.equal(none.rows[0].n, 0, "simulated pre-migration children have no memberships");

      const added = await db.query("select private.backfill_child_owners() n");
      assert.equal(added.rows[0].n, 2);
      const rows = await db.query("select child_id, user_id, role from public.child_memberships where family_id = $1 order by child_id", [P.familyId]);
      assert.deepEqual(rows.rows, [{ child_id: "old-1", user_id: P.id, role: "owner" }, { child_id: "old-2", user_id: P.id, role: "owner" }]);
      // Running it again adds nothing.
      assert.equal((await db.query("select private.backfill_child_owners() n")).rows[0].n, 0);
    } finally {
      await db.query("rollback");
    }
  });

  it("refuses, changing nothing, when a family with children has no member (ownership unclear)", async () => {
    const fid = randomUUID();
    const code = await sqlError(db, [
      ...preMigration,
      "insert into public.families (id, name) values ($1, 'orphaned')",
      insertChild,
      ...restore,
      "select private.backfill_child_owners()",
    ], [[], [], [fid], [fid, "orphan", "Cy", null]]);
    assert.equal(code, "P0001");
  });

  it("refuses, rather than choosing one, when a family with children has more than one member", async () => {
    const P = await newParent("cm-two-members");
    const second = await newUser("cm-second-member");
    const code = await sqlError(db, [
      ...preMigration,
      "insert into public.family_members (family_id, user_id, role) values ($1, $2, 'parent')",
      insertChild,
      ...restore,
      "select private.backfill_child_owners()",
    ], [[], [], [P.familyId, second.id], [P.familyId, "shared", "Dee", null]]);
    assert.equal(code, "P0001");
  });

  it("every child in the database has exactly one owner", async () => {
    const { rows } = await db.query(`
      select count(*)::int n from public.children c
      where (select count(*) from public.child_memberships m where m.family_id = c.family_id and m.child_id = c.id and m.role = 'owner') <> 1`);
    assert.equal(rows[0].n, 0);
  });
});

describe("new children", () => {
  it("3, 9. a child created the usual way gets its creator as owner, with its id and family unchanged", async () => {
    const [row] = must(await A.client.from("children").insert({ family_id: A.familyId, id: "c-new", first: "Noa" }).select("family_id, id")) as { family_id: string; id: string }[];
    assert.deepEqual(row, { family_id: A.familyId, id: "c-new" });
    assert.deepEqual(await membersOf(A.familyId, "c-new"), [{ user_id: A.id, role: "owner" }]);
  });

  it("uploading a child that is already there (as sync does) adds no second membership", async () => {
    const row = { family_id: A.familyId, id: "c-upsert", first: "Ivo" };
    must(await A.client.from("children").upsert(row, { onConflict: "family_id,id", ignoreDuplicates: true }).select());
    must(await A.client.from("children").upsert(row, { onConflict: "family_id,id", ignoreDuplicates: true }).select());
    assert.deepEqual(await membersOf(A.familyId, "c-upsert"), [{ user_id: A.id, role: "owner" }]);
  });

  it("a child created by a server job gets the family's owner", async () => {
    must(await svc().from("children").insert({ family_id: A.familyId, id: "c-server", first: "Sol" }));
    assert.deepEqual(await membersOf(A.familyId, "c-server"), [{ user_id: A.id, role: "owner" }]);
  });

  it("a soft-deleted child keeps its owner, and restoring it changes nothing", async () => {
    must(await A.client.from("children").insert({ family_id: A.familyId, id: "c-del", first: "Lia" }));
    must(await A.client.from("children").update({ deleted_at: new Date().toISOString() }).eq("family_id", A.familyId).eq("id", "c-del"));
    assert.deepEqual(await membersOf(A.familyId, "c-del"), [{ user_id: A.id, role: "owner" }]);
    must(await A.client.from("children").update({ deleted_at: null }).eq("family_id", A.familyId).eq("id", "c-del"));
    assert.deepEqual(await membersOf(A.familyId, "c-del"), [{ user_id: A.id, role: "owner" }]);
  });

  it("10. a child created on a device by the app's sync engine gets its owner, and syncs as before", async () => {
    const p = await parent("cm-sync");
    const d1 = await p.device(), d2 = await p.device();
    d1.edit("children", { id: "c-synced", first: "Ari", last: "Li", dob: "2022-03-04", enrolled: "", lessons: 0, group: "Primary", photo: "", interests: [] });
    await d1.sync();
    await d2.sync();
    assert.equal(d2.get("children", "c-synced")?.first, "Ari");
    assert.deepEqual(await membersOf(p.familyId, "c-synced"), [{ user_id: p.user.id, role: "owner" }]);
    // Nothing waits or fails because of memberships, and syncing again changes nothing.
    assert.deepEqual((await d1.sync()).notSent, {});
    assert.deepEqual(await membersOf(p.familyId, "c-synced"), [{ user_id: p.user.id, role: "owner" }]);
  });
});

describe("exactly one owner", () => {
  it("4, 5. a second owner is refused", async () => {
    const { error } = await svc().from("child_memberships").insert({ family_id: A.familyId, child_id: "a-child", user_id: B.id, role: "owner" });
    assert.equal(error?.code, "23505");
    const { error: promote } = await svc().from("child_memberships").update({ role: "owner" }).eq("family_id", A.familyId).eq("child_id", "a-child").eq("user_id", E.id);
    assert.equal(promote?.code, "23505");
    assert.deepEqual(await ownersOf(A.familyId, "a-child"), [{ user_id: A.id, role: "owner" }]);
  });

  it("6. the owner's membership can't be removed or demoted, even by the server", async () => {
    const { error: del } = await svc().from("child_memberships").delete().eq("family_id", A.familyId).eq("child_id", "a-child").eq("user_id", A.id);
    assert.equal(del?.code, "23514");
    const { error: demote } = await svc().from("child_memberships").update({ role: "editor" }).eq("family_id", A.familyId).eq("child_id", "a-child").eq("user_id", A.id);
    assert.equal(demote?.code, "23514");
    assert.deepEqual(await ownersOf(A.familyId, "a-child"), [{ user_id: A.id, role: "owner" }]);
  });

  it("a membership's child and user never change", async () => {
    const { error } = await svc().from("child_memberships").update({ user_id: B.id }).eq("family_id", A.familyId).eq("child_id", "a-child").eq("user_id", E.id);
    assert.equal(error?.code, "42501");
  });

  it("a transfer (demote and promote in one transaction, in either order) keeps exactly one owner", async () => {
    must(await A.client.from("children").insert({ family_id: A.familyId, id: "c-transfer", first: "Tom" }));
    await addMember(A.familyId, "c-transfer", E.id, "editor");
    const set = "update public.child_memberships set role = $1 where family_id = $2 and child_id = 'c-transfer' and user_id = $3";
    assert.equal(await sqlError(db, [set, set], [["editor", A.familyId, A.id], ["owner", A.familyId, E.id]]), null);
    assert.deepEqual(await membersOf(A.familyId, "c-transfer"), [{ user_id: E.id, role: "owner" }, { user_id: A.id, role: "editor" }].sort((x, y) => x.role.localeCompare(y.role)));
  });

  it("11. concurrent changes can't leave a child without an owner, or with two", async () => {
    must(await A.client.from("children").insert({ family_id: A.familyId, id: "c-race", first: "Uma" }));
    await addMember(A.familyId, "c-race", E.id, "editor");
    await addMember(A.familyId, "c-race", B.id, "viewer");
    const set = "update public.child_memberships set role = $1 where family_id = $2 and child_id = 'c-race' and user_id = $3";
    const t1 = await dbConnection(), t2 = await dbConnection();
    try {
      // A transfer to E racing the removal of E: the removal waits for the transfer, then is refused at commit.
      await t1.query("begin");
      await t1.query(set, ["editor", A.familyId, A.id]);
      await t1.query(set, ["owner", A.familyId, E.id]);
      const pid2 = (await t2.query("select pg_backend_pid() pid")).rows[0].pid;
      await t2.query("begin");
      const removal = t2.query("delete from public.child_memberships where family_id = $1 and child_id = 'c-race' and user_id = $2", [A.familyId, E.id])
        .then(() => t2.query("commit")).then(() => null, (e: { code?: string }) => e.code);
      await waitUntilBlocked(db, pid2);
      await t1.query("commit");
      assert.equal(await removal, "23514");
      await t2.query("rollback").catch(() => {});
      assert.deepEqual(await ownersOf(A.familyId, "c-race"), [{ user_id: E.id, role: "owner" }]);

      // Two transfers at once (E to A, and E to B): the second waits, then is refused.
      await t1.query("begin");
      await t1.query(set, ["editor", A.familyId, E.id]);
      await t1.query(set, ["owner", A.familyId, A.id]);
      await t2.query("begin");
      const second = t2.query(set, ["editor", A.familyId, E.id])
        .then(() => t2.query(set, ["owner", A.familyId, B.id])).then(() => t2.query("commit")).then(() => null, (e: { code?: string }) => e.code);
      await waitUntilBlocked(db, pid2);
      await t1.query("commit");
      assert.ok(["23505", "23514"].includes((await second) ?? ""), "the second transfer must fail");
      await t2.query("rollback").catch(() => {});
      assert.deepEqual(await ownersOf(A.familyId, "c-race"), [{ user_id: A.id, role: "owner" }]);
    } finally {
      await t1.end();
      await t2.end();
    }
  });

  it("removing the child itself (server only) takes its memberships with it", async () => {
    const P = await newParent("cm-remove");
    must(await P.client.from("children").insert({ family_id: P.familyId, id: "c-gone", first: "Vi" }));
    must(await svc().from("families").delete().eq("id", P.familyId));
    assert.deepEqual(await membersOf(P.familyId, "c-gone"), []);
  });
});

describe("who can read and change memberships", () => {
  it("7. no client can create, change or delete a membership, not even the owner", async () => {
    const writes = [
      A.client.from("child_memberships").insert({ family_id: A.familyId, child_id: "a-child", user_id: B.id, role: "editor" }),
      A.client.from("child_memberships").update({ role: "viewer" }).eq("family_id", A.familyId).eq("child_id", "a-child").eq("user_id", E.id),
      A.client.from("child_memberships").delete().eq("family_id", A.familyId).eq("child_id", "a-child").eq("user_id", E.id),
      E.client.from("child_memberships").update({ role: "owner" }).eq("family_id", A.familyId).eq("child_id", "a-child").eq("user_id", E.id),
      B.client.from("child_memberships").insert({ family_id: A.familyId, child_id: "a-child", user_id: B.id, role: "viewer" }),
      B.client.from("child_memberships").insert({ family_id: B.familyId, child_id: "emma", user_id: E.id, role: "editor" }),
    ];
    for (const res of await Promise.all(writes)) assert.equal(res.error?.code, "42501");
    assert.deepEqual(await membersOf(A.familyId, "a-child"), [{ user_id: E.id, role: "editor" }, { user_id: A.id, role: "owner" }]);
  });

  it("the owner sees every member of their child; a member sees only their own membership", async () => {
    const own = must(await A.client.from("child_memberships").select("user_id, role").eq("child_id", "a-child").order("role")) as Membership[];
    assert.deepEqual(own, [{ user_id: E.id, role: "editor" }, { user_id: A.id, role: "owner" }]);
    // E is only an editor of a-child (E owns c-transfer after the transfer test, and so sees its members).
    const editor = must(await E.client.from("child_memberships").select("family_id, child_id, user_id, role").eq("child_id", "a-child")) as Membership[];
    assert.deepEqual(editor, [{ family_id: A.familyId, child_id: "a-child", user_id: E.id, role: "editor" }]);
  });

  it("8. an outsider can't enumerate memberships, children or families", async () => {
    const O = await newParent("cm-outsider");
    must(await O.client.from("children").insert({ family_id: O.familyId, id: "emma", first: "Olu" }));
    const all = must(await O.client.from("child_memberships").select("family_id, child_id, user_id")) as Membership[];
    assert.deepEqual(all, [{ family_id: O.familyId, child_id: "emma", user_id: O.id }]);
    assert.deepEqual(must(await O.client.from("child_memberships").select("child_id").eq("family_id", A.familyId)), []);
    assert.deepEqual(must(await O.client.from("child_memberships").select("child_id").eq("user_id", A.id)), []);
    const anon = await anonClient().from("child_memberships").select("child_id").limit(1);
    assert.ok(anon.error || (anon.data ?? []).length === 0);
  });

  it("a membership reaches that child's records, and only that child's (Phase 1b; details in childAccess.test.ts)", async () => {
    assert.deepEqual(must(await E.client.from("children").select("id").eq("family_id", A.familyId).eq("id", "a-child")), [{ id: "a-child" }]);
    assert.deepEqual(must(await E.client.from("children").select("id").eq("family_id", A.familyId).eq("id", "emma")), []);
    must(await E.client.from("entries").insert({ family_id: A.familyId, id: "e-try", child_id: "a-child", date: "2026-10-01", text: "x" }));
  });

  it("12. families stay isolated: no child in another family, and no membership from trying", async () => {
    const { error } = await B.client.from("children").insert({ family_id: A.familyId, id: "b-intruder", first: "X" });
    assert.ok(error);
    assert.deepEqual(await membersOf(A.familyId, "b-intruder"), []);
    // The same child id in two families: two children, each with its own family's owner.
    assert.deepEqual(await membersOf(A.familyId, "emma"), [{ user_id: A.id, role: "owner" }]);
    assert.deepEqual(await membersOf(B.familyId, "emma"), [{ user_id: B.id, role: "owner" }]);
    assert.deepEqual(must(await A.client.from("child_memberships").select("child_id").eq("family_id", B.familyId)), []);
  });
});
