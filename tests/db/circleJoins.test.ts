// Telling the person who manages a child's profile that someone joined (migration 20261102000100_circle_joins.sql;
// docs/shared-child-profiles-release-readiness.md). Straight to the API with each person's own session.
//
// O manages "kai". Ed is already an editor of it. Nina, Priya and Out are other accounts.
// Synthetic accounts only, against the local Supabase stack (helpers.ts refuses anything else).

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { anonClient, must, newParent, serviceClient } from "./helpers.ts";

type Parent = Awaited<ReturnType<typeof newParent>>;
type Join = { id: string; family_id: string; child_id: string; child_first: string; member_name: string; joined_at: string };

let O: Parent, Ed: Parent, Nina: Parent, Priya: Parent, Out: Parent;
let F: string;

const invite = async (childId: string, role = "editor") => (must(await O.client.rpc("create_invitation", { p_family_id: F, p_child_id: childId, p_role: role })) as { id: string; token: string }[])[0];
const accept = async (who: Parent, token: string) => (must(await who.client.rpc("accept_invitation", { p_token: token })) as { status: string }[])[0].status;
const joins = async (who: Parent) => must(await who.client.rpc("circle_joins")) as Join[];
const joinsFor = async (who: Parent, childId: string) => (await joins(who)).filter(j => j.child_id === childId);

before(async () => {
  [O, Ed, Nina, Priya, Out] = await Promise.all([newParent("join-o"), newParent("join-ed"), newParent("join-nina"), newParent("join-priya"), newParent("join-out")]);
  F = O.familyId;
  for (const [id, first] of [["kai", "Kai"], ["lu", "Lu"], ["mo", "Mo"]]) must(await O.client.from("children").insert({ family_id: F, id, first }));
  must(await serviceClient().from("child_memberships").insert({ family_id: F, child_id: "kai", user_id: Ed.id, role: "editor" }));
  must(await serviceClient().from("profiles").upsert([{ user_id: Nina.id, display_name: "Nina" }, { user_id: Priya.id, display_name: "" }]));
});

describe("someone joining by invitation", () => {
  it("a successful acceptance leaves one notice for the person managing the profile, with the new member's name and no email or user id", async () => {
    const inv = await invite("kai");
    assert.equal(await accept(Nina, inv.token), "ok");
    const mine = await joinsFor(O, "kai");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].id, inv.id);
    assert.equal(mine[0].child_first, "Kai");
    assert.equal(mine[0].member_name, "Nina");
    assert.equal(mine[0].family_id, F);
    assert.deepEqual(Object.keys(mine[0]).sort(), ["child_first", "child_id", "family_id", "id", "joined_at", "member_name"]);
    assert.ok(!JSON.stringify(mine).includes(Nina.email) && !JSON.stringify(mine).includes(Nina.id), "no email or user id");
  });

  it("a repeated or concurrent acceptance of the same link makes no second notice", async () => {
    const inv = await invite("lu");
    const results = await Promise.all([accept(Priya, inv.token), accept(Priya, inv.token)]);
    assert.deepEqual(results.sort(), ["accepted", "ok"]);
    assert.equal(await accept(Priya, inv.token), "accepted", "a retry later");
    assert.equal(await accept(Nina, inv.token), "accepted", "someone else with the same link");
    const mine = await joinsFor(O, "lu");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].member_name, "", "no display name: the screen says 'Someone'");
  });

  it("several invitations: each new member is a notice; someone already in the circle changing access is not", async () => {
    const a = await invite("mo"), b = await invite("mo", "viewer");
    assert.equal(await accept(Nina, a.token), "ok");
    assert.equal(await accept(Priya, b.token), "ok");
    assert.deepEqual((await joinsFor(O, "mo")).map(j => j.member_name).sort(), ["", "Nina"]);
    const again = await invite("kai", "viewer");
    assert.equal(await accept(Ed, again.token), "ok", "Ed was already an editor of Kai");
    assert.ok(!(await joinsFor(O, "kai")).some(j => j.id === again.id), "not a join");
  });

  it("only the person managing the profile sees them: members, outsiders and anonymous callers get nothing", async () => {
    for (const who of [Ed, Nina, Priya, Out]) assert.deepEqual(await joins(who), [], "no rows for anyone else");
    const nobody = anonClient();
    assert.ok((await nobody.rpc("circle_joins")).error, "anonymous: refused");
    assert.ok((await nobody.rpc("dismiss_circle_joins", { p_ids: [] })).error, "anonymous: refused");
    const direct = await Out.client.from("child_invitations").select("id");
    assert.ok(direct.error || !direct.data?.length, "the invitations table itself stays unreadable");
  });

  it("dismissing: nobody else can dismiss them; the person managing the profile can, once, from any device", async () => {
    const ids = (await joins(O)).map(j => j.id);
    assert.ok(ids.length >= 4);
    must(await Nina.client.rpc("dismiss_circle_joins", { p_ids: ids }));
    must(await Out.client.rpc("dismiss_circle_joins", { p_ids: ids }));
    assert.equal((await joins(O)).length, ids.length, "others' dismissals change nothing");
    must(await O.client.rpc("dismiss_circle_joins", { p_ids: [ids[0]] }));
    must(await O.client.rpc("dismiss_circle_joins", { p_ids: [ids[0]] }));
    assert.equal((await joins(O)).length, ids.length - 1);
  });

  it("someone removed before the notice was seen is no longer announced; a deleted child's notices are hidden", async () => {
    const before = await joinsFor(O, "mo");
    must(await O.client.rpc("remove_member", { p_family_id: F, p_child_id: "mo", p_user_id: Nina.id }));
    assert.equal((await joinsFor(O, "mo")).length, before.length - 1);
    must(await O.client.from("children").update({ deleted_at: new Date().toISOString() }).eq("family_id", F).eq("id", "mo"));
    assert.deepEqual(await joinsFor(O, "mo"), []);
    must(await O.client.from("children").update({ deleted_at: null }).eq("family_id", F).eq("id", "mo"));
  });

  it("the person managing the profile opening their own link doesn't spend it", async () => {
    const inv = await invite("lu", "viewer");
    assert.equal(await accept(O, inv.token), "already_member");
    const row = must(await serviceClient().from("child_invitations").select("accepted_at, joined_new").eq("id", inv.id).single()) as { accepted_at: string | null; joined_new: boolean };
    assert.equal(row.accepted_at, null, "still unused");
    assert.equal(await accept(Nina, inv.token), "ok", "the person it was for can still use it");
  });
});
