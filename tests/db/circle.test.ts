// A child's circle and relationship labels, Shared Child Profiles Phase 3 (docs/shared-child-profiles-phase3.md,
// migration 20261101000400_circle.sql), straight to the API with each person's own session.
//
// O manages Mia's profile; Ed adds and edits; Vw views; Out is not in the circle. Only O sees how each person can take
// part (and their ids, to manage it); everyone in the circle sees names and relationships; no one gets an email.
//
// Synthetic accounts only, against the local Supabase stack (helpers.ts refuses anything else).

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { must, newParent, serviceClient } from "./helpers.ts";

type Parent = Awaited<ReturnType<typeof newParent>>;
type Row = { user_id: string | null; display_name: string; relationship: string | null; role: string | null; is_me: boolean };
let O: Parent, Ed: Parent, Vw: Parent, Out: Parent;
let F: string;

const circle = (who: Parent, childId = "mia") => who.client.rpc("child_circle", { p_family_id: F, p_child_id: childId });
const label = (who: Parent, userId: string, relationship: string | null, childId = "mia") =>
  who.client.rpc("set_circle_relationship", { p_family_id: F, p_child_id: childId, p_user_id: userId, p_relationship: relationship });

before(async () => {
  [O, Ed, Vw, Out] = await Promise.all([newParent("circle-o"), newParent("circle-ed"), newParent("circle-vw"), newParent("circle-out")]);
  F = O.familyId;
  must(await O.client.from("children").insert({ family_id: F, id: "mia", first: "Mia" }));
  for (const [who, role] of [[Ed, "editor"], [Vw, "viewer"]] as const) {
    must(await serviceClient().from("child_memberships").insert({ family_id: F, child_id: "mia", user_id: who.id, role }));
  }
  for (const [who, name] of [[O, "Lin"], [Ed, "Grandma Wu"], [Vw, "Sarah"]] as const) {
    must(await who.client.from("profiles").insert({ user_id: who.id, display_name: name }));
  }
});

describe("a child's circle", () => {
  it("the person managing the profile sees everyone, with how each takes part, themselves first", async () => {
    const rows = must(await circle(O)) as Row[];
    assert.deepEqual(rows.map(r => [r.display_name, r.role, r.is_me]), [["Lin", "owner", true], ["Grandma Wu", "editor", false], ["Sarah", "viewer", false]]);
    assert.deepEqual(rows.map(r => r.user_id), [O.id, Ed.id, Vw.id]);
    assert.ok(rows.every(r => r.relationship === null), "no relationship until someone chooses one");
    assert.ok(!JSON.stringify(rows).includes("@"), "no email");
  });

  it("anyone else in the circle sees names and relationships, and only their own access", async () => {
    for (const [who, role] of [[Ed, "editor"], [Vw, "viewer"]] as const) {
      const rows = must(await circle(who)) as Row[];
      assert.equal(rows.length, 3);
      assert.deepEqual(rows[0], { user_id: who.id, display_name: who === Ed ? "Grandma Wu" : "Sarah", relationship: null, role, is_me: true });
      assert.ok(rows.slice(1).every(r => r.user_id === null && r.role === null && !r.is_me), "nobody else's id or access");
    }
  });

  it("someone not in the circle gets nothing, the same way whether or not the child exists", async () => {
    const real = await circle(Out), fake = await circle(Out, "no-such-child");
    assert.equal(real.error?.code, "42501");
    assert.equal(real.error?.message, fake.error?.message);
  });
});

describe("relationship labels", () => {
  it("the person managing the profile labels anyone; others only themselves; never inferred", async () => {
    must(await label(O, O.id, "mom"));
    must(await label(O, Ed.id, "grandma"));
    must(await label(Vw, Vw.id, "teacher"));
    assert.deepEqual((must(await circle(Ed)) as Row[]).map(r => [r.display_name, r.relationship]), [["Grandma Wu", "grandma"], ["Lin", "mom"], ["Sarah", "teacher"]]);
    must(await label(Vw, Vw.id, null));
    assert.equal((must(await circle(O)) as Row[]).find(r => r.display_name === "Sarah")!.relationship, null, "cleared again");
  });

  it("no one else can label someone; unknown labels and outsiders are refused; roles never change", async () => {
    assert.equal((await label(Ed, Vw.id, "family")).error?.code, "42501", "an editor labelling someone else");
    assert.equal((await label(Vw, O.id, "family")).error?.code, "42501", "a viewer labelling someone else");
    assert.equal((await label(Out, Out.id, "family")).error?.code, "42501", "an outsider");
    assert.ok((await label(O, Ed.id, "boss")).error, "a label that isn't one of the choices");
    assert.equal((await label(O, Out.id, "family")).error?.code, "42501", "someone not in the circle");
    const roles = must(await serviceClient().from("child_memberships").select("user_id, role").eq("family_id", F).eq("child_id", "mia")) as { user_id: string; role: string }[];
    assert.deepEqual(Object.fromEntries(roles.map(r => [r.user_id, r.role])), { [O.id]: "owner", [Ed.id]: "editor", [Vw.id]: "viewer" });
    // Memberships are still not writable by clients (Phase 1a).
    assert.equal((await O.client.from("child_memberships").update({ relationship: "dad" }).eq("family_id", F).eq("child_id", "mia").eq("user_id", Ed.id)).error?.code, "42501");
  });

  it("while the child is soft-deleted, only the person managing it sees the circle", async () => {
    must(await O.client.from("children").update({ deleted_at: new Date().toISOString() }).eq("family_id", F).eq("id", "mia"));
    assert.equal((must(await circle(O)) as Row[]).length, 3);
    assert.equal((await circle(Ed)).error?.code, "42501");
    assert.equal((await label(Ed, Ed.id, "family")).error?.code, "42501");
    must(await O.client.from("children").update({ deleted_at: null }).eq("family_id", F).eq("id", "mia"));
    assert.equal((must(await circle(Ed)) as Row[]).length, 3);
  });
});
