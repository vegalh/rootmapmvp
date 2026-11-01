// Account deletion and data retention (docs/data-architecture-phase2.md section 10 and section 19 "Known
// limitations": account deletion is "not yet built"). This suite does not test a deletion feature (there is
// none); it pins down what *actually* happens today when a user's auth account is removed (the only way an
// operator can act on a deletion or GDPR/COPPA erasure request right now), so that behaviour cannot silently
// regress and so the gap it documents is backed by a reproducible test rather than a claim.
//
// Since Shared Child Profiles Phase 1a (docs/shared-child-profiles-phase1a.md) every child has exactly one owner, so
// the account of a parent who owns a child can't be deleted on its own: that would leave the child without an owner.
// An operator removes the family first (which takes its children and memberships with it), then the account.
//
// Synthetic test accounts only, against the local Supabase stack (see helpers.ts: refuses any non-local URL).

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { must, newParent, newPhotoId, serviceClient, sha256 } from "./helpers.ts";

type Parent = Awaited<ReturnType<typeof newParent>>;
let D: Parent; // owns a child: their account can't be deleted until the family is removed
let E: Parent; // no children: their account is deleted directly, and the family is orphaned
let other: Parent; // an unrelated family, used to confirm no cross-family effect

async function addPhoto(p: Parent) {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  must(await p.client.from("photos").insert({ family_id: p.familyId, id: newPhotoId(), mime_type: "image/jpeg", byte_size: bytes.length, sha256: sha256(bytes) }));
}

before(async () => {
  [D, E, other] = await Promise.all([newParent("del-d"), newParent("del-e"), newParent("del-other")]);
  const f = D.familyId;
  must(await D.client.from("children").insert({ family_id: f, id: "d-child", first: "Robin" }));
  must(await D.client.from("entries").insert({ family_id: f, id: "d-entry", child_id: "d-child", date: "2026-10-10", text: "sensitive note" }));
  must(await D.client.from("goals").insert({ family_id: f, id: "d-goal", owner_user_id: D.id, title: "Owned by D" }));
  must(await D.client.from("profiles").insert({ user_id: D.id, display_name: "D" }));
  must(await D.client.from("user_settings").insert({ user_id: D.id, key: "language", value: "en" }));
  await addPhoto(D);

  must(await E.client.from("plans").insert({ family_id: E.familyId, id: "e-plan", activity_id: "dotting", date: "2026-10-10", child_ids: [] }));
  must(await E.client.from("goals").insert({ family_id: E.familyId, id: "e-goal", owner_user_id: E.id, title: "Owned by E" }));
  must(await E.client.from("profiles").insert({ user_id: E.id, display_name: "E" }));
  await addPhoto(E);

  // The underlying auth user is removed: today, the only lever available to act on a deletion or erasure
  // request (there is no app-level "delete my account" flow; see docs section 19 "Known limitations").
  const { error } = await serviceClient().auth.admin.deleteUser(E.id);
  if (error) throw error;
});

describe("deleting the auth user of a parent who owns a child", () => {
  it("is refused while they own a child, and changes nothing", async () => {
    const { error } = await serviceClient().auth.admin.deleteUser(D.id);
    assert.ok(error, "an owner's account can't be deleted while the child would be left without an owner");
    const svc = serviceClient();
    assert.deepEqual(must(await svc.from("child_memberships").select("user_id, role").eq("family_id", D.familyId).eq("child_id", "d-child")), [{ user_id: D.id, role: "owner" }]);
    assert.equal((must(await svc.from("family_members").select("user_id").eq("user_id", D.id)) as unknown[]).length, 1);
    assert.equal((must(await svc.from("profiles").select("user_id").eq("user_id", D.id)) as unknown[]).length, 1);
    // D still uses RootMap as before.
    assert.deepEqual(must(await D.client.from("children").select("id, first")), [{ id: "d-child", first: "Robin" }]);
    assert.deepEqual(must(await D.client.from("entries").select("id")), [{ id: "d-entry" }]);
  });

  it("after an operator removes the family, the account is deleted and nothing of either remains", async () => {
    const svc = serviceClient();
    must(await svc.from("families").delete().eq("id", D.familyId));
    const { error } = await svc.auth.admin.deleteUser(D.id);
    assert.equal(error, null);
    for (const t of ["children", "entries", "photos", "child_memberships", "family_members"]) {
      assert.deepEqual(must(await svc.from(t).select("family_id").eq("family_id", D.familyId)), [], t);
    }
    assert.deepEqual(must(await svc.from("families").select("id").eq("id", D.familyId)), []);
    assert.deepEqual(must(await svc.from("profiles").select("user_id").eq("user_id", D.id)), []);
    assert.deepEqual(must(await svc.from("user_settings").select("user_id").eq("user_id", D.id)), []);
    assert.deepEqual(must(await svc.from("goals").select("id").eq("family_id", D.familyId).eq("id", "d-goal")), []);
    // Photo files in storage (none uploaded here) are not removed by this: the bucket has no link to the rows.
  });

  it("the deleted user's still-unexpired access token reads nothing, and the server no longer recognises the account", async () => {
    // A JWT already issued is self-contained and stays signature-valid until it expires (lib/cloud/auth.ts,
    // `sessionValid`'s doc comment: "An access token keeps working ... even after ... its account removed").
    assert.deepEqual(must(await D.client.from("children").select("id")), []);
    assert.deepEqual(must(await D.client.from("child_memberships").select("child_id")), []);
    const { data, error } = await D.client.auth.getUser();
    assert.ok(error || !data.user, "the Auth server should no longer recognise a deleted user's token");
  });
});

describe("deleting the auth user of a parent with no children", () => {
  it("removes rows that are keyed directly by the user id (ON DELETE CASCADE)", async () => {
    const svc = serviceClient();
    assert.deepEqual(must(await svc.from("family_members").select("user_id").eq("user_id", E.id)), []);
    assert.deepEqual(must(await svc.from("profiles").select("user_id").eq("user_id", E.id)), []);
    // A goal is owned by one parent (owner_user_id references auth.users on delete cascade): it goes with them.
    assert.deepEqual(must(await svc.from("goals").select("id").eq("family_id", E.familyId).eq("id", "e-goal")), []);
  });

  it("CONFIRMED GAP: family-scoped data is NOT removed — it is orphaned, not erased", async () => {
    const svc = serviceClient();
    // The family row survives deletion: families.created_by is `on delete set null`, not cascaded, and nothing
    // else deletes the family itself.
    const [family] = must(await svc.from("families").select("id, created_by").eq("id", E.familyId)) as { id: string; created_by: string | null }[];
    assert.ok(family, "the family row should still exist (documents the gap)");
    assert.equal(family.created_by, null);
    assert.deepEqual(must(await svc.from("family_members").select("user_id").eq("family_id", E.familyId)), []);
    // No one can reach it through the API any more, but its plan and photo metadata (and, by the same gap, the
    // photo's file in storage) stay in the database indefinitely.
    assert.deepEqual(must(await svc.from("plans").select("id").eq("family_id", E.familyId)), [{ id: "e-plan" }]);
    assert.equal((must(await svc.from("photos").select("id").eq("family_id", E.familyId)) as unknown[]).length, 1);
  });

  it("the orphaned family is unreachable by every other account (the gap is retention, not an access hole)", async () => {
    assert.deepEqual(must(await other.client.from("plans").select("id").eq("family_id", E.familyId)), []);
    assert.deepEqual(must(await other.client.from("photos").select("id").eq("family_id", E.familyId)), []);
    const { error } = await other.client.from("children").insert({ family_id: E.familyId, id: "intruder" });
    assert.ok(error, "an orphaned family must still refuse writes from an unrelated account");
  });

  it("other families are completely unaffected", async () => {
    const own = must(await other.client.from("children").select("id").eq("family_id", other.familyId));
    assert.equal((own as unknown[]).length, 0); // "other" never added a child; just confirms the family itself still works
    must(await other.client.from("children").insert({ family_id: other.familyId, id: "still-works" }));
    assert.equal((must(await other.client.from("children").select("id").eq("family_id", other.familyId)) as unknown[]).length, 1);
  });
});
