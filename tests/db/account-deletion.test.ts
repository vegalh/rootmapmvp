// Account deletion and data retention (docs/data-architecture-phase2.md section 10 and section 19 "Known
// limitations": account deletion is "not yet built"). This suite does not test a deletion feature (there is
// none); it pins down what *actually* happens today when a user's auth account is removed (the only way an
// operator can act on a deletion or GDPR/COPPA erasure request right now), so that behaviour cannot silently
// regress and so the gap it documents is backed by a reproducible test rather than a claim.
//
// Synthetic test accounts only, against the local Supabase stack (see helpers.ts: refuses any non-local URL).

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { must, newParent, newPhotoId, serviceClient, sha256 } from "./helpers.ts";

type Parent = Awaited<ReturnType<typeof newParent>>;
let D: Parent; // the parent whose auth account will be deleted
let other: Parent; // an unrelated family, used to confirm no cross-family effect

before(async () => {
  [D, other] = await Promise.all([newParent("del-d"), newParent("del-other")]);
  const f = D.familyId;
  must(await D.client.from("children").insert({ family_id: f, id: "d-child", first: "Robin" }));
  must(await D.client.from("entries").insert({ family_id: f, id: "d-entry", child_id: "d-child", date: "2026-10-10", text: "sensitive note" }));
  must(await D.client.from("goals").insert({ family_id: f, id: "d-goal", owner_user_id: D.id, title: "Owned by D" }));
  must(await D.client.from("profiles").insert({ user_id: D.id, display_name: "D" }));
  must(await D.client.from("user_settings").insert({ user_id: D.id, key: "language", value: "en" }));
  const photoId = newPhotoId();
  const bytes = new Uint8Array([1, 2, 3, 4]);
  must(await D.client.from("photos").insert({ family_id: f, id: photoId, mime_type: "image/jpeg", byte_size: bytes.length, sha256: sha256(bytes) }));

  // The underlying auth user is removed: today, the only lever available to act on a deletion or erasure
  // request (there is no app-level "delete my account" flow; see docs section 19 "Known limitations").
  const { error } = await serviceClient().auth.admin.deleteUser(D.id);
  if (error) throw error;
});

describe("deleting the auth user", () => {
  it("removes rows that are keyed directly by the user id (ON DELETE CASCADE)", async () => {
    const svc = serviceClient();
    assert.deepEqual(must(await svc.from("family_members").select("user_id").eq("user_id", D.id)), []);
    assert.deepEqual(must(await svc.from("profiles").select("user_id").eq("user_id", D.id)), []);
    assert.deepEqual(must(await svc.from("user_settings").select("user_id").eq("user_id", D.id)), []);
    // A goal is owned by one parent (owner_user_id references auth.users on delete cascade): it goes with them.
    assert.deepEqual(must(await svc.from("goals").select("id").eq("id", "d-goal")), []);
  });

  it("CONFIRMED GAP: family-scoped data is NOT removed — it is orphaned, not erased", async () => {
    const svc = serviceClient();
    // The family row survives deletion: families.created_by is `on delete set null`, not cascaded, and nothing
    // else deletes the family itself.
    const [family] = must(await svc.from("families").select("id, created_by").eq("id", D.familyId)) as { id: string; created_by: string | null }[];
    assert.ok(family, "the family row should still exist (documents the gap)");
    assert.equal(family.created_by, null);
    // It now has zero members: no one — not even a future sign-up — can ever reach it through the API, because
    // every family-data policy requires `family_id in (select private.my_family_ids())`. But the rows remain in
    // the database indefinitely: a child's profile, a developmental-observation entry, and photo metadata,
    // none of which the family's own (now deleted) parent asked to keep.
    const members = must(await svc.from("family_members").select("user_id").eq("family_id", D.familyId));
    assert.deepEqual(members, []);
    const child = must(await svc.from("children").select("id, first").eq("family_id", D.familyId).eq("id", "d-child"));
    assert.deepEqual(child, [{ id: "d-child", first: "Robin" }], "the child's record is still in the database after the parent's account was deleted");
    const entry = must(await svc.from("entries").select("id, text").eq("family_id", D.familyId).eq("id", "d-entry"));
    assert.deepEqual(entry, [{ id: "d-entry", text: "sensitive note" }], "a developmental-observation entry outlives the deleted account");
    const photos = must(await svc.from("photos").select("id").eq("family_id", D.familyId));
    assert.equal((photos as unknown[]).length, 1, "the photo's metadata row (and, by the same gap, its file in storage) is never cleaned up");
  });

  it("the orphaned family is unreachable by every other account (the gap is retention, not an access hole)", async () => {
    assert.deepEqual(must(await other.client.from("children").select("id").eq("family_id", D.familyId)), []);
    assert.deepEqual(must(await other.client.from("entries").select("id").eq("family_id", D.familyId)), []);
    const { error } = await other.client.from("children").insert({ family_id: D.familyId, id: "intruder" });
    assert.ok(error, "an orphaned family must still refuse writes from an unrelated account");
  });

  it("the deleted user's still-unexpired access token reads nothing (family_members is gone) " +
    "but the server itself no longer recognises the account", async () => {
    // A JWT already issued is self-contained and stays signature-valid until it expires (lib/cloud/auth.ts,
    // `sessionValid`'s doc comment: "An access token keeps working ... even after ... its account removed").
    // RLS still protects every row: with no family_members left for this user, `my_family_ids()` is empty, so
    // every family-data query returns nothing rather than erroring.
    assert.deepEqual(must(await D.client.from("children").select("id").eq("family_id", D.familyId)), []);
    // But asking the Auth server about this token (what `sessionValid()` does) reveals the account is gone.
    const { data, error } = await D.client.auth.getUser();
    assert.ok(error || !data.user, "the Auth server should no longer recognise a deleted user's token");
  });

  it("other families are completely unaffected", async () => {
    const own = must(await other.client.from("children").select("id").eq("family_id", other.familyId));
    assert.equal((own as unknown[]).length, 0); // "other" never added a child; just confirms the family itself still works
    must(await other.client.from("children").insert({ family_id: other.familyId, id: "still-works" }));
    assert.equal((must(await other.client.from("children").select("id").eq("family_id", other.familyId)) as unknown[]).length, 1);
  });
});
