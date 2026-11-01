// Shared-children sync against the local server (Shared Child Profiles Phase 2a; docs/shared-child-profiles-phase2a.md):
// the app's engine and scopes (lib/sync/engine.ts, scopes.ts) on an in-memory device (syncDevice.ts), with real
// memberships, RLS and change numbers. Sharing is still switched off in the app; these tests switch it on per call.
//
// U has their own family (child "emma", Moment "m-1"). Family F1 shares "emma" (editor) and "noah" (viewer) with U, and
// later "c-3"; family F2 shares its own "emma" (editor). The same ids in three families must never meet.
//
// Synthetic accounts only, against the local Supabase stack (helpers.ts refuses anything else).

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dbConnection, must, serviceClient } from "./helpers.ts";
import { addPhoto, parent, type Device, type Rec } from "./syncDevice.ts";
import { scopedId, type ScopeState } from "../../src/lib/sync/scopes.ts";

type Parent = Awaited<ReturnType<typeof parent>>;
let U: Parent, O1: Parent, O2: Parent;
let d: Device; // U's device
let o1: Device; // F1's owner's device
let shared: string; // a photo F1 shows in a Moment about both emma and noah
let emmaOnly: string; // a photo only F1's emma shows

const svc = () => serviceClient();
const child = (id: string, first: string) => ({ id, first, last: "Li", dob: "2022-03-04", enrolled: "", lessons: 0, group: "Primary", photo: "", interests: [] });
const entry = (id: string, childId: string, text: string, photos: string[] = []) => ({ id, childId, date: "2026-10-01", title: "", text, photos });
const grant = (familyId: string, childId: string, role: string) => svc().from("child_memberships").insert({ family_id: familyId, child_id: childId, user_id: U.user.id, role }).then(must);
const setRole = (familyId: string, childId: string, role: string) => svc().from("child_memberships").update({ role }).eq("family_id", familyId).eq("child_id", childId).eq("user_id", U.user.id).then(must);
const revoke = (familyId: string, childId: string) => svc().from("child_memberships").delete().eq("family_id", familyId).eq("child_id", childId).eq("user_id", U.user.id).then(must);
const state = () => d.m.scopes as ScopeState;
const scopedKeys = (dev: Device, familyId: string) => [...dev.records.keys()].filter(k => k.includes(familyId));
const homeSnapshot = (dev: Device) => JSON.stringify([...dev.records.entries()].filter(([k]) => !k.includes("\u001f") && !dev.records.get(k)?.familyId).sort());

before(async () => {
  [U, O1, O2] = await Promise.all([parent("mf-u"), parent("mf-o1"), parent("mf-o2")]);
  d = await U.device();
  d.edit("children", child("emma", "Maya"));
  d.edit("entries", entry("m-1", "emma", "U's own Moment"));
  await d.sync();

  o1 = await O1.device();
  o1.edit("children", child("emma", "Ella"));
  o1.edit("children", child("noah", "Nora"));
  o1.edit("children", child("c-3", "Cleo"));
  shared = await addPhoto(o1);
  emmaOnly = await addPhoto(o1);
  // A Moment about emma and noah: one entry each, the same photo.
  o1.edit("entries", entry("m-1", "emma", "F1's Moment about Ella", [shared, emmaOnly]));
  o1.edit("entries", entry("m-n", "noah", "F1's Moment about Nora", [shared]));
  o1.edit("entries", entry("m-c3", "c-3", "an old Moment about Cleo"));
  o1.edit("records", { id: "r-1", childId: "emma", lesson: "Pouring", date: "2026-10-01" });
  await o1.syncAll();

  const o2 = await O2.device();
  o2.edit("children", child("emma", "Eve"));
  o2.edit("entries", entry("m-e", "emma", "F2's Moment about Eve"));
  await o2.sync();

  await grant(O1.familyId, "emma", "editor");
  await grant(O1.familyId, "noah", "viewer");
  await grant(O2.familyId, "emma", "editor");
});

describe("multi-family sync", () => {
  it("switched off (as in the app): exactly the single-family sync, nothing of other families", async () => {
    const r = await d.scopes({ enabled: false });
    assert.equal(r.state, null);
    assert.deepEqual(r.shared, {});
    assert.deepEqual(scopedKeys(d, O1.familyId), []);
    assert.deepEqual(d.live("children").map(c => c.id), ["emma"]);
  });

  it("existing data stays as it is; each shared family arrives in its own scope; the same ids never meet", async () => {
    const before = homeSnapshot(d);
    const homeCursors = { ...d.m.cursors };
    const r = await d.scopes({ homeChildren: ["emma"] });
    // The user's own family: nothing sent or received again, nothing changed.
    assert.equal(r.home.pushed, 0);
    assert.equal(r.home.pulled, 0);
    assert.equal(homeSnapshot(d), before);
    assert.deepEqual(d.m.cursors, homeCursors);
    const byFamily = (a: { familyId: string }, b: { familyId: string }) => a.familyId.localeCompare(b.familyId);
    assert.deepEqual([...r.actions].sort(byFamily), [{ kind: "fullResync", familyId: O1.familyId }, { kind: "fullResync", familyId: O2.familyId }].sort(byFamily));
    // Three children called emma, three Moments called m-1 or similar: all apart, each with its own content.
    assert.equal(d.get("children", "emma")!.first, "Maya");
    assert.equal(d.get("children", scopedId(O1.familyId, "emma"))!.first, "Ella");
    assert.equal(d.get("children", scopedId(O2.familyId, "emma"))!.first, "Eve");
    assert.equal(d.get("entries", "m-1")!.text, "U's own Moment");
    const f1m1 = d.get("entries", scopedId(O1.familyId, "m-1"))!;
    assert.equal(f1m1.text, "F1's Moment about Ella");
    assert.equal(f1m1.childId, scopedId(O1.familyId, "emma"));
    assert.equal(f1m1.familyId, O1.familyId);
    // Only what is shared: noah (viewer) yes, c-3 no; F1's family-only data never.
    assert.ok(d.get("children", scopedId(O1.familyId, "noah")));
    assert.equal(d.get("children", scopedId(O1.familyId, "c-3")), undefined);
    assert.equal(d.get("entries", scopedId(O1.familyId, "m-c3")), undefined);
    // The photos those Moments show, marked with their family.
    assert.equal(d.get("photos", shared)!.familyId, O1.familyId);
    // Nothing of another family was sent anywhere.
    assert.deepEqual(d.outbox(), []);
  });

  it("each family has its own cursors: a change in one moves only that family's", async () => {
    const f2Cursors = structuredClone(d.m.scopeCursors[O2.familyId]);
    const homeCursors = { ...d.m.cursors };
    o1.edit("entries", { ...o1.get("entries", "m-1")!, text: "F1 edited" });
    await o1.sync();
    const r = await d.scopes({ homeChildren: ["emma"] });
    assert.equal(r.shared[O1.familyId].pulled, 1);
    assert.equal(r.shared[O2.familyId].pulled, 0);
    assert.equal(r.home.pulled, 0);
    assert.deepEqual(d.m.scopeCursors[O2.familyId], f2Cursors);
    assert.deepEqual(d.m.cursors, homeCursors);
    assert.equal(d.get("entries", scopedId(O1.familyId, "m-1"))!.text, "F1 edited");
  });

  it("a newly shared child arrives with all its earlier records (the family is downloaded again from the start)", async () => {
    await grant(O1.familyId, "c-3", "viewer");
    const r = await d.scopes({ homeChildren: ["emma"] });
    assert.deepEqual(r.actions, [{ kind: "fullResync", familyId: O1.familyId }]);
    assert.equal(d.get("children", scopedId(O1.familyId, "c-3"))!.first, "Cleo");
    assert.equal(d.get("entries", scopedId(O1.familyId, "m-c3"))!.text, "an old Moment about Cleo");
  });

  it("the owner soft-deleting a shared child is an ordinary change: it stays, marked deleted, nothing is removed", async () => {
    o1.remove("children", "c-3");
    await o1.sync();
    const r = await d.scopes({ homeChildren: ["emma"] });
    assert.deepEqual(r.actions, []);
    assert.ok(d.get("children", scopedId(O1.familyId, "c-3"))!.deletedAt);
    assert.ok(d.get("entries", scopedId(O1.familyId, "m-c3")));
  });

  it("an editor's change reaches the owner; after the role drops to viewer it is refused once and not sent again; restored, it goes", async () => {
    const key = scopedId(O1.familyId, "m-1");
    d.edit("entries", { ...d.get("entries", key)!, text: "edited by U" });
    let r = await d.scopes({ homeChildren: ["emma"] });
    assert.equal(r.shared[O1.familyId].pushed, 1);
    assert.equal(r.home.pushed, 0, "never sent into U's own family");
    await o1.sync();
    assert.equal(o1.get("entries", "m-1")!.text, "edited by U");

    await setRole(O1.familyId, "emma", "viewer");
    r = await d.scopes({ homeChildren: ["emma"] }); // the role change is seen
    d.edit("entries", { ...d.get("entries", key)!, text: "edited as a viewer" });
    r = await d.scopes({ homeChildren: ["emma"] });
    const entryKey = `entries:${key}`;
    assert.match(r.shared[O1.familyId].notSent[entryKey].reason, /access denied/);
    assert.ok(d.out.get(entryKey)!.rejected, "marked as refused");
    r = await d.scopes({ homeChildren: ["emma"] });
    assert.match(r.shared[O1.familyId].notSent[entryKey].reason, /not sent again/);
    assert.equal(d.get("entries", key)!.text, "edited as a viewer", "the local change is kept");

    await setRole(O1.familyId, "emma", "editor");
    r = await d.scopes({ homeChildren: ["emma"] });
    assert.deepEqual(r.actions, [{ kind: "clearRejections", familyId: O1.familyId }]);
    assert.equal(r.shared[O1.familyId].pushed, 1);
    await o1.sync();
    assert.equal(o1.get("entries", "m-1")!.text, "edited as a viewer");
  });

  it("an ownership transfer is a role change: no data moves, and the new owner can change the child", async () => {
    const db = await dbConnection();
    try {
      await db.query("begin");
      await db.query("update public.child_memberships set role = 'editor' where family_id = $1 and child_id = 'emma' and user_id = $2", [O1.familyId, O1.user.id]);
      await db.query("update public.child_memberships set role = 'owner' where family_id = $1 and child_id = 'emma' and user_id = $2", [O1.familyId, U.user.id]);
      await db.query("commit");
    } finally {
      await db.end();
    }
    let r = await d.scopes({ homeChildren: ["emma"] });
    assert.deepEqual(r.actions, [{ kind: "clearRejections", familyId: O1.familyId }]);
    assert.equal(state().shared[scopedId(O1.familyId, "emma")], "owner");
    d.edit("children", { ...d.get("children", scopedId(O1.familyId, "emma"))!, first: "Ella Li" });
    r = await d.scopes({ homeChildren: ["emma"] });
    assert.equal(r.shared[O1.familyId].pushed, 1);
    const [row] = must(await svc().from("children").select("first").eq("family_id", O1.familyId).eq("id", "emma")) as { first: string }[];
    assert.equal(row.first, "Ella Li");
  });

  it("losing the network for memberships is never taken as losing access; an interrupted removal finishes next time; a photo another child still shows stays", async () => {
    await revoke(O1.familyId, "noah");
    d.blobs.set(shared, new Uint8Array([1, 2, 3])); // its file on this device
    d.failing = /child_memberships/;
    for (let i = 0; i < 2; i++) await d.scopes({ homeChildren: ["emma"] });
    assert.ok(d.get("children", scopedId(O1.familyId, "noah")), "nothing removed while memberships can't be read");
    assert.deepEqual(state().absent, {});
    d.failing = null;

    let r = await d.scopes({ homeChildren: ["emma"] });
    assert.deepEqual(r.actions, [], "missing once is not enough");
    assert.ok(d.get("children", scopedId(O1.familyId, "noah")));
    d.interruptCleanup = true;
    await assert.rejects(d.scopes({ homeChildren: ["emma"] }), /interrupted/);
    assert.equal(state().revoked[scopedId(O1.familyId, "noah")].state, "pending");
    assert.ok(d.get("children", scopedId(O1.familyId, "noah")), "an interrupted removal removed nothing");

    r = await d.scopes({ homeChildren: ["emma"] });
    assert.equal(state().revoked[scopedId(O1.familyId, "noah")].state, "done");
    assert.equal(d.get("children", scopedId(O1.familyId, "noah")), undefined);
    assert.equal(d.get("entries", scopedId(O1.familyId, "m-n")), undefined);
    // emma's Moment still shows that photo: kept, with its file.
    assert.ok(d.get("photos", shared));
    assert.ok(d.blobs.has(shared));
    // Nothing else touched.
    assert.ok(d.get("children", scopedId(O1.familyId, "emma")));
    assert.ok(d.get("children", scopedId(O2.familyId, "emma")));
    assert.equal(d.get("children", "emma")!.first, "Maya");
  });

  it("a change made offline after access was removed is refused, then archived with the removal, never lost or retried forever", async () => {
    const key = scopedId(O2.familyId, "m-e");
    d.offline = true;
    d.edit("entries", { ...d.get("entries", key)!, text: "written on the train" });
    await revoke(O2.familyId, "emma");
    d.offline = false;
    let r = await d.scopes({ homeChildren: ["emma"] });
    assert.match(r.shared[O2.familyId].notSent[`entries:${key}`].reason, /access denied/);
    assert.ok(d.get("entries", key), "kept until the removal is confirmed");
    r = await d.scopes({ homeChildren: ["emma"] });
    assert.deepEqual(r.actions, [{ kind: "revoke", familyId: O2.familyId, childId: "emma" }, { kind: "dropScope", familyId: O2.familyId }]);
    assert.deepEqual(scopedKeys(d, O2.familyId), []);
    assert.equal(d.m.scopeCursors[O2.familyId], undefined);
    assert.ok(!d.outbox().some(e => e.id.includes(O2.familyId)), "nothing of F2 left to send");
    const kept = d.archive.find(a => a.source === `access-revoked:${O2.familyId}/emma`);
    assert.equal((kept?.value as { record: Rec }).record.text, "written on the train");
    assert.equal(state().revoked[scopedId(O2.familyId, "emma")].archived, 1);
    const [row] = must(await svc().from("entries").select("text").eq("family_id", O2.familyId).eq("id", "m-e")) as { text: string }[];
    assert.equal(row.text, "F2's Moment about Eve", "the refused change never reached F2");
  });

  it("when the last child showing a photo goes, the photo goes too; the user's own family is untouched", async () => {
    const before = homeSnapshot(d);
    // U owns F1's emma now; the server moves ownership back before removing U.
    const db = await dbConnection();
    try {
      await db.query("begin");
      await db.query("update public.child_memberships set role = 'viewer' where family_id = $1 and child_id = 'emma' and user_id = $2", [O1.familyId, U.user.id]);
      await db.query("update public.child_memberships set role = 'owner' where family_id = $1 and child_id = 'emma' and user_id = $2", [O1.familyId, O1.user.id]);
      await db.query("commit");
    } finally {
      await db.end();
    }
    await revoke(O1.familyId, "emma");
    await revoke(O1.familyId, "c-3");
    await d.scopes({ homeChildren: ["emma"] });
    await d.scopes({ homeChildren: ["emma"] });
    assert.deepEqual(scopedKeys(d, O1.familyId), []);
    assert.equal(d.get("photos", shared), undefined);
    assert.equal(d.get("photos", emmaOnly), undefined);
    assert.ok(!d.blobs.has(shared));
    assert.equal(homeSnapshot(d), before);
    assert.deepEqual(d.live("entries").map(e => e.id), ["m-1"]);
  });

  it("another account on the same device never uses this account's state or receives its shared children", async () => {
    await grant(O1.familyId, "noah", "viewer"); // shared with U again
    const V = await parent(`mf-v-${randomUUID().slice(0, 4)}`);
    const v = await V.device();
    v.m.scopes = structuredClone(d.m.scopes); // left behind by U, as if on the same device
    const r = await v.scopes();
    assert.equal((v.m.scopes as ScopeState).userId, V.user.id);
    assert.deepEqual(r.shared, {});
    assert.deepEqual([...v.records.keys()], []);
  });
});
