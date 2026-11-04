// Who wrote a Moment, Shared Child Profiles Phase 5 (docs/shared-child-profiles-phase5.md, migration
// 20261103000100_entry_authors.sql), straight to the API with each person's own session.
//
// O manages Mia's profile; Ed adds and edits; Vw views; Out is not in the circle. The server records who added a
// Moment (no client can say otherwise) and tells anyone who can read it who added and last changed it, by name only.
//
// Synthetic accounts only, against the local Supabase stack (helpers.ts refuses anything else).

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { must, newParent, serviceClient } from "./helpers.ts";

type Parent = Awaited<ReturnType<typeof newParent>>;
type Row = { kind: string; display_name: string; relationship: string | null; is_me: boolean };
let O: Parent, Ed: Parent, Vw: Parent, Out: Parent;
let F: string;

const people = (who: Parent, entryId: string) => who.client.rpc("entry_people", { p_family_id: F, p_entry_id: entryId });
const createdBy = async (id: string) => (must(await serviceClient().from("entries").select("created_by, updated_by").eq("family_id", F).eq("id", id).single()) as { created_by: string | null; updated_by: string | null });

before(async () => {
  [O, Ed, Vw, Out] = await Promise.all([newParent("authors-o"), newParent("authors-ed"), newParent("authors-vw"), newParent("authors-out")]);
  F = O.familyId;
  must(await O.client.from("children").insert({ family_id: F, id: "mia", first: "Mia" }));
  for (const [who, role, relationship] of [[Ed, "editor", "grandma"], [Vw, "viewer", null]] as const) {
    must(await serviceClient().from("child_memberships").insert({ family_id: F, child_id: "mia", user_id: who.id, role, relationship }));
  }
  for (const [who, name] of [[O, "Lin"], [Ed, "Grandma Wu"], [Vw, "Sarah"]] as const) {
    must(await who.client.from("profiles").insert({ user_id: who.id, display_name: name }));
  }
});

describe("who added a Moment", () => {
  it("is set by the server, can't be claimed by a client, and never changes", async () => {
    must(await Ed.client.from("entries").insert({ family_id: F, id: "e1", child_id: "mia", date: "2026-11-01", text: "Fed the ducks" }));
    assert.deepEqual(await createdBy("e1"), { created_by: Ed.id, updated_by: Ed.id });
    // Sending it is refused outright (no column grant), on insert and on update.
    assert.ok((await O.client.from("entries").insert({ family_id: F, id: "e2", child_id: "mia", date: "2026-11-01", created_by: Ed.id })).error, "insert claiming someone else");
    assert.ok((await O.client.from("entries").update({ created_by: O.id }).eq("family_id", F).eq("id", "e1")).error, "update rewriting it");
    must(await O.client.from("entries").update({ text: "Fed the ducks by the pond" }).eq("family_id", F).eq("id", "e1"));
    assert.deepEqual(await createdBy("e1"), { created_by: Ed.id, updated_by: O.id }, "a later change keeps who added it");
  });
});

describe("entry_people", () => {
  it("tells everyone in the circle who added and last changed it, by name and relationship only", async () => {
    for (const who of [O, Ed, Vw]) {
      const rows = must(await people(who, "e1")) as Row[];
      assert.deepEqual(rows.map(r => [r.kind, r.display_name, r.relationship, r.is_me]), [
        ["added", "Grandma Wu", "grandma", who === Ed],
        ["changed", "Lin", null, who === O],
      ]);
      assert.ok(!JSON.stringify(rows).includes("@") && !JSON.stringify(rows).includes(Ed.id), "no email or user id");
    }
  });

  it("refuses anyone else, the same way whether or not the Moment exists", async () => {
    const real = await people(Out, "e1"), fake = await people(Out, "no-such-moment");
    assert.equal(real.error?.code, "42501");
    assert.equal(real.error?.message, fake.error?.message);
  });

  it("names nobody who has left the circle", async () => {
    must(await Ed.client.rpc("leave_circle", { p_family_id: F, p_child_id: "mia" }));
    const rows = must(await people(Vw, "e1")) as Row[];
    assert.deepEqual(rows.map(r => [r.kind, r.display_name, r.relationship]), [["added", "", null], ["changed", "Lin", null]]);
    assert.equal((await people(Ed, "e1")).error?.code, "42501", "and they can't read it any more");
  });
});
