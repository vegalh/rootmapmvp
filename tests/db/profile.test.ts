// The parent's own profile (name/photo/contact) against the local stack: a user-scoped singleton (table
// `profiles`), not part of the record-sync engine (see src/lib/sync/profile.ts). Covers the same ground as
// tests/db/sync.test.ts for the family-scoped collections: two devices on one account, RLS isolation from
// another account, and the "pull before push" conflict rule.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureProfile } from "../../src/lib/cloud/account.ts";
import { nextProfileAction, syncProfile, type ProfileLocal, type ProfileRow } from "../../src/lib/sync/profile.ts";
import type { ProfileInfo } from "../../src/types.ts";
import { must, newPhotoId, newUser, serviceClient } from "./helpers.ts";
import { parent } from "./syncDevice.ts";

const EMPTY: ProfileInfo = { name: "", photo: "", contact: "" };

// An in-memory ProfileLocal, so each "device" in these tests is just its own supabase client + this state.
function memoryLocal(initial: ProfileInfo = EMPTY) {
  const state: { profile: ProfileInfo; known: ProfileRow | null } = { profile: initial, known: null };
  const local: ProfileLocal = {
    get: () => state.profile,
    set: next => { state.profile = next; },
    known: () => state.known,
    setKnown: row => { state.known = row; },
  };
  return { local, state };
}

const serverRow = async (userId: string) => must(await serviceClient().from("profiles").select("display_name, photo_ref, contact").eq("user_id", userId).single());

describe("profile sync: one account, two devices", () => {
  it("a name set on one device reaches the other; a later edit on the other reaches back", async () => {
    const p = await parent("profile-sync");
    const a = await p.device(), b = await p.device();
    await ensureProfile(a.client, p.user.id);

    const da = memoryLocal();
    await syncProfile(a.client, p.user.id, da.local); // first sync: adopts the empty row, nothing to push
    assert.deepEqual(da.state.profile, EMPTY);

    da.state.profile = { name: "Alex Hao", photo: "", contact: "alex@example.com" };
    await syncProfile(a.client, p.user.id, da.local); // local changed, server still empty: pushes
    assert.equal((await serverRow(p.user.id)).display_name, "Alex Hao");

    const db = memoryLocal();
    await syncProfile(b.client, p.user.id, db.local); // first sync on B: adopts what A pushed
    assert.deepEqual(db.state.profile, { name: "Alex Hao", photo: "", contact: "alex@example.com" });

    db.state.profile = { ...db.state.profile, name: "Alex H." };
    await syncProfile(b.client, p.user.id, db.local); // B's edit, server still matches what B last saw: pushes
    assert.equal((await serverRow(p.user.id)).display_name, "Alex H.");

    await syncProfile(a.client, p.user.id, da.local); // A pulls B's change
    assert.equal(da.state.profile.name, "Alex H.");
  });

  it("a photo id is kept as photo_ref and round-trips; a device offline during the edit still catches up next round", async () => {
    const p = await parent("profile-photo");
    const a = await p.device(), b = await p.device();
    await ensureProfile(a.client, p.user.id);
    const photo = newPhotoId();

    const da = memoryLocal();
    await syncProfile(a.client, p.user.id, da.local);
    da.state.profile = { name: "Mia", photo, contact: "" };
    await syncProfile(a.client, p.user.id, da.local);
    assert.equal((await serverRow(p.user.id)).photo_ref, photo);

    const db = memoryLocal();
    await syncProfile(b.client, p.user.id, db.local);
    assert.equal(db.state.profile.photo, photo);
  });

  it("both devices changing between syncs: whichever reached the server first is kept, not overwritten (last write wins by sync order, not device clocks)", async () => {
    const p = await parent("profile-conflict");
    const a = await p.device(), b = await p.device();
    await ensureProfile(a.client, p.user.id);

    const da = memoryLocal();
    const db = memoryLocal();
    await syncProfile(a.client, p.user.id, da.local);
    await syncProfile(b.client, p.user.id, db.local);

    // Both edit locally without syncing in between.
    da.state.profile = { name: "From A", photo: "", contact: "" };
    db.state.profile = { name: "From B", photo: "", contact: "" };

    await syncProfile(a.client, p.user.id, da.local); // A pushes first
    assert.equal((await serverRow(p.user.id)).display_name, "From A");

    await syncProfile(b.client, p.user.id, db.local); // B pulls A's change instead of overwriting it
    assert.equal(db.state.profile.name, "From A", "B adopts A's change rather than pushing its own over it");
    assert.equal((await serverRow(p.user.id)).display_name, "From A", "the server is unchanged by B's round");

    // Confirms the pure decision matches what just happened against the real server.
    assert.deepEqual(
      nextProfileAction({ display_name: "From A", photo_ref: null, contact: "" }, { display_name: "", photo_ref: null, contact: "" }, { display_name: "From B", photo_ref: null, contact: "" }),
      { kind: "adopt", row: { display_name: "From A", photo_ref: null, contact: "" } },
    );
  });

  it("RLS: another account can neither read nor write this parent's profile", async () => {
    const p = await parent("profile-owner");
    const a = await p.device();
    await ensureProfile(a.client, p.user.id);
    const da = memoryLocal();
    await syncProfile(a.client, p.user.id, da.local); // first sync: establishes "known" against the empty row
    da.state.profile = { name: "Private Name", photo: "", contact: "" };
    await syncProfile(a.client, p.user.id, da.local); // now a real local change: pushes

    const other = await newUser("profile-intruder");
    const { data: seen, error: selErr } = await other.client.from("profiles").select("display_name").eq("user_id", p.user.id).maybeSingle();
    assert.equal(selErr, null);
    assert.equal(seen, null, "RLS hides other users' rows rather than erroring, so a forged id reads nothing");

    const { error: updErr } = await other.client.from("profiles").update({ display_name: "Hijacked" }).eq("user_id", p.user.id);
    assert.equal(updErr, null, "RLS filters the row out rather than erroring, so the update simply matches nothing");
    assert.equal((await serverRow(p.user.id)).display_name, "Private Name", "the real owner's data is untouched");
  });
});
