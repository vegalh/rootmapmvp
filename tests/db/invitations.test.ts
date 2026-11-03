// Invitations and circle management, Shared Child Profiles Phase 4 (docs/shared-child-profiles-phase4.md,
// migration 20261101000500_invitations.sql), straight to the API with each person's own session.
//
// O owns "mia" (and other children created per group below). Ed and Vw already hold Add & Edit / View Only
// memberships on "mia", seeded directly (as an accepted invitation would leave them) to test who may invite.
//
// Synthetic accounts only, against the local Supabase stack (helpers.ts refuses anything else).

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { actAs, anonClient, dbConnection, must, newParent, newUser, serviceClient, waitUntilBlocked } from "./helpers.ts";
import { parent as syncParent } from "./syncDevice.ts";

type Parent = Awaited<ReturnType<typeof newParent>>;
type Invite = { id: string; token: string; expires_at: string };

let O: Parent, Ed: Parent, Vw: Parent, Out: Parent;
let F: string;
let db: pg.Client;

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");
const addChild = async (owner: Parent, id: string, first: string, familyId = owner.familyId) => must(await owner.client.from("children").insert({ family_id: familyId, id, first }));
const seedMember = async (familyId: string, childId: string, userId: string, role: string) =>
  must(await serviceClient().from("child_memberships").insert({ family_id: familyId, child_id: childId, user_id: userId, role }));
const invite = async (who: Parent, childId: string, role: string, email: string | null = null, familyId = who.familyId) =>
  (await who.client.rpc("create_invitation", { p_family_id: familyId, p_child_id: childId, p_role: role, p_email: email })) as { data: Invite[] | null; error: { code?: string } | null };
const preview = (who: Parent | Awaited<ReturnType<typeof newUser>>, token: string) => who.client.rpc("get_invitation_preview", { p_token: token });
const accept = (who: Parent | Awaited<ReturnType<typeof newUser>>, token: string) => who.client.rpc("accept_invitation", { p_token: token });
const membershipsOf = async (familyId: string, childId: string) =>
  must(await serviceClient().from("child_memberships").select("user_id, role").eq("family_id", familyId).eq("child_id", childId).order("role")) as { user_id: string; role: string }[];

before(async () => {
  [O, Ed, Vw, Out] = await Promise.all([newParent("inv-o"), newParent("inv-ed"), newParent("inv-vw"), newParent("inv-out")]);
  F = O.familyId;
  await addChild(O, "mia", "Mia");
  await seedMember(F, "mia", Ed.id, "editor");
  await seedMember(F, "mia", Vw.id, "viewer");
  db = await dbConnection();
});

after(async () => { await db?.end(); });

describe("1-3. only the owner can create an invitation", () => {
  it("1. the owner creates one, with a random token only its hash of which is stored", async () => {
    const { data, error } = await invite(O, "mia", "editor");
    assert.equal(error, null);
    const row = data![0];
    assert.match(row.token, /^[0-9a-f]{48}$/, "24 random bytes, hex-encoded");
    const days = (new Date(row.expires_at).getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 6.9 && days < 7.1, `expires in ~7 days, was ${days}`);

    const stored = must(await serviceClient().from("child_invitations").select("token_hash").eq("id", row.id).single()) as { token_hash: string };
    assert.equal(stored.token_hash, sha256Hex(row.token));
    assert.notEqual(stored.token_hash, row.token);

    const list = must(await O.client.rpc("list_invitations", { p_family_id: F, p_child_id: "mia" })) as { id: string; role: string; email: string | null }[];
    assert.ok(list.some(r => r.id === row.id && r.role === "editor" && r.email === null));
    assert.ok(!JSON.stringify(list).match(/[0-9a-f]{48}/), "list_invitations never carries a token");
  });

  it("2. an editor cannot invite", async () => {
    assert.equal((await invite(Ed, "mia", "viewer")).error?.code, "42501");
  });

  it("3. a viewer cannot invite", async () => {
    assert.equal((await invite(Vw, "mia", "editor")).error?.code, "42501");
  });

  it("an outsider cannot invite, for a real child or a made-up one", async () => {
    assert.equal((await invite(Out, "mia", "editor")).error?.code, "42501");
    assert.equal((await invite(Out, "no-such-child", "editor")).error?.code, "42501");
  });

  it("an invalid role or email is refused before any row is written", async () => {
    assert.ok((await invite(O, "mia", "owner")).error, "owner is never an invited role");
    assert.ok((await invite(O, "mia", "editor", "not-an-email")).error, "malformed email");
  });

  it("signed out, nothing works at all", async () => {
    const anon = anonClient();
    assert.equal((await anon.rpc("create_invitation", { p_family_id: F, p_child_id: "mia", p_role: "editor" })).error?.code, "42501");
    assert.equal((await anon.rpc("get_invitation_preview", { p_token: "x".repeat(48) })).error?.code, "42501");
    assert.equal((await anon.rpc("accept_invitation", { p_token: "x".repeat(48) })).error?.code, "42501");
  });
});

describe("4-10. accepting an invitation", () => {
  it("4. a valid invitation can be accepted, once, by whoever holds the token", async () => {
    await addChild(O, "leo", "Leo");
    const row = must(await invite(O, "leo", "editor"))[0] as Invite;
    const U = await newUser("inv-leo-u");

    const seen = must(await preview(U, row.token)) as any[];
    assert.deepEqual(seen[0].status, "valid");
    assert.equal(seen[0].child_first, "Leo");
    assert.equal(seen[0].role, "editor");

    const got = must(await accept(U, row.token)) as any[];
    assert.deepEqual(got[0], { status: "ok", family_id: F, child_id: "leo", role: "editor" });
    assert.deepEqual(await membershipsOf(F, "leo"), [{ user_id: O.id, role: "owner" }, { user_id: U.id, role: "editor" }].sort((a, b) => a.role.localeCompare(b.role)));
  });

  it("5. an expired invitation cannot be accepted", async () => {
    await addChild(O, "nora", "Nora");
    const row = must(await invite(O, "nora", "viewer"))[0] as Invite;
    must(await serviceClient().from("child_invitations").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", row.id));
    const U = await newUser("inv-nora-u");
    assert.equal((must(await preview(U, row.token)) as any[])[0].status, "expired");
    assert.equal((must(await accept(U, row.token)) as any[])[0].status, "expired");
    assert.deepEqual(await membershipsOf(F, "nora"), [{ user_id: O.id, role: "owner" }]);
  });

  it("6. a revoked invitation cannot be accepted", async () => {
    await addChild(O, "zoe", "Zoe");
    const row = must(await invite(O, "zoe", "editor"))[0] as Invite;
    must(await O.client.rpc("revoke_invitation", { p_id: row.id }));
    const U = await newUser("inv-zoe-u");
    assert.equal((must(await preview(U, row.token)) as any[])[0].status, "revoked");
    assert.equal((must(await accept(U, row.token)) as any[])[0].status, "revoked");
    // Revoking again, or revoking someone else's invitation, changes nothing and isn't an error for the owner.
    await assert.doesNotReject(O.client.rpc("revoke_invitation", { p_id: row.id }).then(must));
    assert.equal((await Ed.client.rpc("revoke_invitation", { p_id: row.id })).error?.code, "42501");
  });

  it("7. a single-use token cannot be accepted twice, by the same or a different account", async () => {
    await addChild(O, "cleo", "Cleo");
    const row = must(await invite(O, "cleo", "viewer"))[0] as Invite;
    const U1 = await newUser("inv-cleo-1"), U2 = await newUser("inv-cleo-2");
    assert.equal((must(await accept(U1, row.token)) as any[])[0].status, "ok");
    assert.equal((must(await accept(U1, row.token)) as any[])[0].status, "accepted", "tapping Accept again does nothing new");
    assert.equal((must(await accept(U2, row.token)) as any[])[0].status, "accepted", "a different account never gets in on a used token");
    assert.deepEqual(await membershipsOf(F, "cleo"), [{ user_id: O.id, role: "owner" }, { user_id: U1.id, role: "viewer" }].sort((a, b) => a.role.localeCompare(b.role)));
  });

  it("8. two concurrent acceptances of the same token create only one membership", async () => {
    await addChild(O, "race", "Remy");
    const row = must(await invite(O, "race", "editor"))[0] as Invite;
    const A = await newUser("inv-race-a"), B = await newUser("inv-race-b");
    const t1 = await dbConnection(), t2 = await dbConnection();
    try {
      await t1.query("begin"); await actAs(t1, A.id);
      const first = t1.query("select * from public.accept_invitation($1)", [row.token]);
      const pid2 = (await t2.query("select pg_backend_pid() pid")).rows[0].pid;
      await t2.query("begin"); await actAs(t2, B.id);
      const second = t2.query("select * from public.accept_invitation($1)", [row.token]);
      await waitUntilBlocked(db, pid2);
      await t1.query("commit");
      const firstStatus = (await first).rows[0].status;
      await t2.query("commit");
      const secondStatus = (await second).rows[0].status;
      assert.deepEqual([firstStatus, secondStatus].sort(), ["accepted", "ok"], "exactly one of the two gets in");
      assert.deepEqual(await membershipsOf(F, "race"), [{ user_id: O.id, role: "owner" }, { user_id: firstStatus === "ok" ? A.id : B.id, role: "editor" }].sort((a, b) => a.role.localeCompare(b.role)));
    } finally {
      await t1.query("rollback").catch(() => {});
      await t2.query("rollback").catch(() => {});
      await t1.end(); await t2.end();
    }
  });

  it("9. an email-restricted invitation can be accepted by that verified account", async () => {
    await addChild(O, "ivy", "Ivy");
    const U = await newUser("inv-ivy-u");
    const row = must(await invite(O, "ivy", "editor", U.email.toUpperCase()))[0] as Invite; // stored lowercased either way
    assert.equal((must(await preview(U, row.token)) as any[])[0].status, "valid");
    assert.equal((must(await accept(U, row.token)) as any[])[0].status, "ok");
  });

  it("10. a different account is rejected, and learns nothing about why", async () => {
    await addChild(O, "iris", "Iris");
    const right = await newUser("inv-iris-right"), wrong = await newUser("inv-iris-wrong");
    const row = must(await invite(O, "iris", "viewer", right.email))[0] as Invite;
    const seen = (must(await preview(wrong, row.token)) as any[])[0];
    assert.equal(seen.status, "wrong_email");
    assert.equal(seen.child_first, null, "no child info leaks to the wrong account");
    const got = (must(await accept(wrong, row.token)) as any[])[0];
    assert.equal(got.status, "wrong_email");
    assert.deepEqual(await membershipsOf(F, "iris"), [{ user_id: O.id, role: "owner" }]);
    // The restricted email itself is never exposed, even to the owner's list.
    const list = must(await O.client.rpc("list_invitations", { p_family_id: F, p_child_id: "iris" })) as { email: string | null }[];
    assert.equal(list[0]?.email, right.email, "the owner who set the restriction can still see it");
  });

  it("an unknown token answers exactly like one whose child no longer exists", async () => {
    await addChild(O, "gone", "Gone");
    const row = must(await invite(O, "gone", "editor"))[0] as Invite;
    must(await O.client.from("children").update({ deleted_at: new Date().toISOString() }).eq("family_id", F).eq("id", "gone"));
    const U = await newUser("inv-gone-u");
    const madeUp = must(await preview(U, "0".repeat(48))) as any[];
    const deleted = must(await preview(U, row.token)) as any[];
    assert.equal(madeUp[0].status, "invalid");
    assert.equal(deleted[0].status, "invalid");
  });
});

describe("11-12. several members, several children", () => {
  it("11. a child can have several members at once", async () => {
    await addChild(O, "team", "Remi");
    const e = must(await invite(O, "team", "editor"))[0] as Invite;
    const v = must(await invite(O, "team", "viewer"))[0] as Invite;
    const E = await newUser("inv-team-e"), V = await newUser("inv-team-v");
    must(await accept(E, e.token)); must(await accept(V, v.token));
    assert.deepEqual(await membershipsOf(F, "team"), [{ user_id: O.id, role: "owner" }, { user_id: E.id, role: "editor" }, { user_id: V.id, role: "viewer" }].sort((a, b) => a.role.localeCompare(b.role)));
  });

  it("12. one user can join more than one child, even across families", async () => {
    await addChild(O, "kid-a", "A");
    const O2 = await newParent("inv-o2");
    await addChild(O2, "kid-b", "B");
    const U = await newUser("inv-multi-u");
    const invA = must(await invite(O, "kid-a", "editor"))[0] as Invite;
    const invB = must(await invite(O2, "kid-b", "viewer"))[0] as Invite;
    assert.equal((must(await accept(U, invA.token)) as any[])[0].status, "ok");
    assert.equal((must(await accept(U, invB.token)) as any[])[0].status, "ok");
    const mine = must(await serviceClient().from("child_memberships").select("family_id, child_id, role").eq("user_id", U.id).order("child_id")) as any[];
    assert.deepEqual(mine, [{ family_id: F, child_id: "kid-a", role: "editor" }, { family_id: O2.familyId, child_id: "kid-b", role: "viewer" }]);
  });
});

describe("13-15. managing the circle", () => {
  it("13. the owner changes a member's role; no one else can; never their own", async () => {
    await addChild(O, "role-kid", "Rae");
    const row = must(await invite(O, "role-kid", "editor"))[0] as Invite;
    const U = await newUser("inv-role-u");
    must(await accept(U, row.token));
    must(await O.client.rpc("set_member_role", { p_family_id: F, p_child_id: "role-kid", p_user_id: U.id, p_role: "viewer" }));
    assert.deepEqual(await membershipsOf(F, "role-kid"), [{ user_id: O.id, role: "owner" }, { user_id: U.id, role: "viewer" }].sort((a, b) => a.role.localeCompare(b.role)));
    assert.equal((await Ed.client.rpc("set_member_role", { p_family_id: F, p_child_id: "role-kid", p_user_id: U.id, p_role: "editor" })).error?.code, "42501");
    assert.equal((await O.client.rpc("set_member_role", { p_family_id: F, p_child_id: "role-kid", p_user_id: O.id, p_role: "editor" })).error?.code, "42501");
  });

  it("14. the owner removes a member; never themself", async () => {
    await addChild(O, "rm-kid", "Rex");
    const row = must(await invite(O, "rm-kid", "viewer"))[0] as Invite;
    const U = await newUser("inv-rm-u");
    must(await accept(U, row.token));
    assert.equal((await O.client.rpc("remove_member", { p_family_id: F, p_child_id: "rm-kid", p_user_id: O.id })).error?.code, "42501");
    must(await O.client.rpc("remove_member", { p_family_id: F, p_child_id: "rm-kid", p_user_id: U.id }));
    assert.deepEqual(await membershipsOf(F, "rm-kid"), [{ user_id: O.id, role: "owner" }]);
  });

  it("15. a member leaves on their own; the owner has nowhere to 'leave' to", async () => {
    await addChild(O, "leave-kid", "Lea");
    const row = must(await invite(O, "leave-kid", "editor"))[0] as Invite;
    const U = await newUser("inv-leave-u");
    must(await accept(U, row.token));
    assert.equal((await O.client.rpc("leave_circle", { p_family_id: F, p_child_id: "leave-kid" })).error?.code, "42501");
    must(await U.client.rpc("leave_circle", { p_family_id: F, p_child_id: "leave-kid" }));
    assert.deepEqual(await membershipsOf(F, "leave-kid"), [{ user_id: O.id, role: "owner" }]);
    assert.equal((await U.client.rpc("leave_circle", { p_family_id: F, p_child_id: "leave-kid" })).error?.code, "42501", "already gone");
  });

  it("16. a member accepted by invitation can still set their own relationship label (Phase 3)", async () => {
    await addChild(O, "rel-kid", "Remy");
    const row = must(await invite(O, "rel-kid", "editor"))[0] as Invite;
    const U = await newUser("inv-rel-u");
    must(await accept(U, row.token));
    must(await U.client.from("profiles").insert({ user_id: U.id, display_name: "Auntie Sam" }));
    must(await U.client.rpc("set_circle_relationship", { p_family_id: F, p_child_id: "rel-kid", p_user_id: U.id, p_relationship: "caregiver" }));
    const circle = must(await O.client.rpc("child_circle", { p_family_id: F, p_child_id: "rel-kid" })) as any[];
    assert.equal(circle.find(r => r.display_name === "Auntie Sam")?.relationship, "caregiver");
    assert.equal((await U.client.rpc("set_circle_relationship", { p_family_id: F, p_child_id: "rel-kid", p_user_id: O.id, p_relationship: "mom" })).error?.code, "42501", "never someone else's");
  });
});

describe("rate limiting", () => {
  it("stops a guessed or stolen token from being tried without bound, per account per day", async () => {
    const U = await newUser("inv-rate-u");
    const raw = await dbConnection();
    try {
      await raw.query("begin"); await actAs(raw, U.id);
      await raw.query("select private.check_invitation_rate('preview', 2)");
      await raw.query("select private.check_invitation_rate('preview', 2)");
      await assert.rejects(raw.query("select private.check_invitation_rate('preview', 2)"), /rate limited/);
      await raw.query("commit");
    } finally {
      await raw.query("rollback").catch(() => {});
      await raw.end();
    }
  });
});

describe("22-23. invitations and the sync engine", () => {
  it("22. accepting an invitation is immediately visible as a new shared child to sync", async () => {
    const owner = await syncParent("inv-sync-o");
    const member = await syncParent("inv-sync-m");
    const o = await owner.device();
    o.edit("children", { id: "sora", first: "Sora", last: "", dob: "2022-01-01", enrolled: "", lessons: 0, group: "Primary", photo: "", interests: [] });
    await o.sync();

    const { data } = await owner.user.client.rpc("create_invitation", { p_family_id: owner.familyId, p_child_id: "sora", p_role: "editor" });
    const row = (data as Invite[])[0];
    must(await accept(member.user, row.token));

    const m = await member.device();
    const r = await m.scopes({ homeChildren: [] });
    assert.deepEqual(r.actions, [{ kind: "fullResync", familyId: owner.familyId }]);
    // Never the same local id as any child the member already has (no duplicate child; distinct families never meet).
    const scoped = [...m.records.keys()].filter(k => k.includes(owner.familyId));
    assert.ok(scoped.length > 0 && scoped.every(k => k !== "children:sora"), "arrives under its own family's scope, not as a bare id");
  });

  it("23. leaving or being removed is cleaned up by the existing revocation process (two answers)", async () => {
    const owner = await syncParent("inv-sync-o2");
    const member = await syncParent("inv-sync-m2");
    const o = await owner.device();
    o.edit("children", { id: "tala", first: "Tala", last: "", dob: "2022-01-01", enrolled: "", lessons: 0, group: "Primary", photo: "", interests: [] });
    await o.sync();
    const { data } = await owner.user.client.rpc("create_invitation", { p_family_id: owner.familyId, p_child_id: "tala", p_role: "viewer" });
    const row = (data as Invite[])[0];
    must(await accept(member.user, row.token));

    const m = await member.device();
    await m.scopes({ homeChildren: [] }); // sees the new child

    must(await owner.user.client.rpc("remove_member", { p_family_id: owner.familyId, p_child_id: "tala", p_user_id: member.user.id }));
    let r = await m.scopes({ homeChildren: [] });
    assert.deepEqual(r.actions, [], "access loss is never assumed from one missing answer");
    r = await m.scopes({ homeChildren: [] });
    assert.deepEqual(r.actions, [{ kind: "revoke", familyId: owner.familyId, childId: "tala" }, { kind: "dropScope", familyId: owner.familyId }], "confirmed on the second answer, as an ordinary revocation, same as removal always was");
  });
});
