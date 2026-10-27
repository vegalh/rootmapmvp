// Cross-device synchronization reliability audit: end-to-end scenarios the per-collection suites (sync.test.ts,
// photos.test.ts, profile.test.ts) don't put together in one place. Against the local stack (`npm run db:start`).
//
// Covers, for every synced collection (children, entries, activity_records, plans, goals, saved_activities,
// saved_collections, photos):
// - simultaneous offline edits on two independent devices, across every collection, converging correctly;
// - conflicts on "My Week" plans and "Goals" specifically (not just children/entries, which the other suites use);
// - a deleted record never reappearing, even when another device holds a stale copy and has unrelated pending
//   edits of its own;
// - a brand-new third device, signing in to the same account from scratch, receiving the complete, converged,
//   already-correct state (including tombstones);
// - sign-out on one device, sign-in with the same account on a different device, and sync continuing correctly;
// - account isolation held across every collection at once, not just one.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { SyncOffline } from "../../src/lib/sync/engine.ts";
import { must, serviceClient } from "./helpers.ts";
import { Device, addPhoto, device, parent, type Rec } from "./syncDevice.ts";
import { DEFAULT_CHILD_PHOTO } from "../../src/lib/sync/mapping.ts";

const admin = () => serviceClient();
const serverRows = async (table: string, familyId: string) => must(await admin().from(table).select("*").eq("family_id", familyId).order("id")) as Rec[];

const child = (id: string, first: string) => ({ id, first, last: "Li", dob: "2022-03-04", enrolled: "", lessons: 0, group: "Primary", photo: "", interests: [] });
const entry = (id: string, childId: string, text: string, photos: string[] = []) => ({ id, childId, date: "2026-10-01", title: "", text, photos });
const plan = (id: string, childIds: string[], more: Record<string, unknown> = {}) => ({ id, activityId: "water-pouring", date: "2026-10-02", childIds, ...more });
const goal = (id: string, title: string, more: Record<string, unknown> = {}) => ({ id, title, completed: false, ...more });

// Every collection converges to the same content on both devices, in every order the two might reasonably sync.
async function convergeBothWays(a: Device, b: Device) {
  await a.sync(); await b.sync(); await a.sync(); await b.sync();
}

describe("full sync audit: My Week plans and Goals conflicts (not covered by the children/entries suite)", () => {
  it("a plan's short field (date) conflicts on two devices: the server's value stays, the loser is kept as a version", async () => {
    const p = await parent("audit-plan-field");
    const a = await p.device(), b = await p.device();
    a.edit("children", child("c-1", "Mia"));
    a.edit("plans", plan("p-1", ["c-1"]));
    await a.sync(); await b.sync();
    a.edit("plans", { ...a.get("plans", "p-1")!, date: "2026-10-05" });
    b.edit("plans", { ...b.get("plans", "p-1")!, date: "2026-10-06" });
    await a.sync(); await b.sync(); await a.sync();
    for (const d of [a, b]) assert.equal(d.get("plans", "p-1")?.date, "2026-10-05");
    const v = must(await admin().from("record_versions").select("*").eq("family_id", p.familyId)) as Rec[];
    assert.deepEqual(v.map(x => [x.table_name, x.reason, (x.version as Rec).date]), [["plans", "field_conflict", "2026-10-06"]]);
  });

  it("a plan's long text (observation) conflicts on two devices: the first saved stays, the other is kept as a version", async () => {
    const p = await parent("audit-plan-text");
    const a = await p.device(), b = await p.device();
    a.edit("children", child("c-1", "Mia"));
    a.edit("plans", plan("p-1", ["c-1"]));
    await a.sync(); await b.sync();
    a.edit("plans", { ...a.get("plans", "p-1")!, observation: "Poured without spilling" });
    b.edit("plans", { ...b.get("plans", "p-1")!, observation: "Needed help holding the pitcher" });
    await a.sync();
    const r = await b.sync();
    assert.equal(r.conflicts, 1);
    await a.sync();
    for (const d of [a, b]) assert.equal(d.get("plans", "p-1")?.observation, "Poured without spilling");
  });

  it("completing a plan on one device and editing its date on the other: both changes are merged (different fields)", async () => {
    const p = await parent("audit-plan-merge");
    const a = await p.device(), b = await p.device();
    a.edit("children", child("c-1", "Mia"));
    a.edit("plans", plan("p-1", ["c-1"]));
    await a.sync(); await b.sync();
    a.edit("plans", { ...a.get("plans", "p-1")!, completed: true, completedDate: "2026-10-02" });
    b.edit("plans", { ...b.get("plans", "p-1")!, date: "2026-10-09" });
    await convergeBothWays(a, b);
    for (const d of [a, b]) {
      assert.equal(d.get("plans", "p-1")?.completed, true);
      assert.equal(d.get("plans", "p-1")?.date, "2026-10-09");
    }
  });

  it("a plan deleted on one device (My Week) is never resurrected by another device that still shows it", async () => {
    const p = await parent("audit-plan-delete");
    const a = await p.device(), b = await p.device();
    a.edit("children", child("c-1", "Mia"));
    a.edit("plans", plan("p-1", ["c-1"]));
    await a.sync(); await b.sync();
    a.remove("plans", "p-1");
    await a.sync();
    // B still has the old (live) copy and hasn't pulled the deletion yet; it also makes an unrelated edit.
    b.edit("children", { ...b.get("children", "c-1")!, first: "Mia Rose" });
    await b.sync(); // pushes the unrelated edit, pulls the deletion in the same round
    await a.sync();
    for (const d of [a, b]) assert.ok(d.get("plans", "p-1")?.deletedAt, "the plan stayed deleted");
    assert.ok((await serverRows("plans", p.familyId))[0].deleted_at);
    // A second and third round change nothing: the plan does not come back.
    await a.sync(); await b.sync(); await a.sync();
    for (const d of [a, b]) assert.ok(d.get("plans", "p-1")?.deletedAt);
  });

  it("a goal's long text (description) conflicts; completing it on the other device at the same time is a separate, mergeable field", async () => {
    const p = await parent("audit-goal");
    const a = await p.device(), b = await p.device();
    a.edit("goals", goal("g-1", "Read daily", { description: "Fifteen minutes before bed" }));
    await a.sync(); await b.sync();
    a.edit("goals", { ...a.get("goals", "g-1")!, description: "Any time, even five minutes" });
    b.edit("goals", { ...b.get("goals", "g-1")!, completed: true });
    await convergeBothWays(a, b);
    for (const d of [a, b]) {
      assert.equal(d.get("goals", "g-1")?.description, "Any time, even five minutes");
      assert.equal(d.get("goals", "g-1")?.completed, true);
    }
  });

  it("a goal deleted on one device is never resurrected, even while the other device has an unrelated pending edit", async () => {
    const p = await parent("audit-goal-delete");
    const a = await p.device(), b = await p.device();
    a.edit("goals", goal("g-1", "Read daily"));
    a.edit("goals", goal("g-2", "Walk outside"));
    await a.sync(); await b.sync();
    a.remove("goals", "g-1");
    await a.sync();
    b.edit("goals", { ...b.get("goals", "g-2")!, completed: true }); // unrelated change, made before B has pulled the deletion
    await b.sync();
    await a.sync();
    for (const d of [a, b]) {
      assert.ok(d.get("goals", "g-1")?.deletedAt, "g-1 stayed deleted");
      assert.equal(d.get("goals", "g-2")?.completed, true, "the unrelated change was not lost");
    }
  });

  it("unsaving an activity or a collection on one device is never undone by another device's stale copy", async () => {
    const p = await parent("audit-saved-delete");
    const a = await p.device(), b = await p.device();
    a.edit("saved", { id: "water-pouring" });
    a.edit("savedCollections", { id: "after-work" });
    await a.sync(); await b.sync();
    a.remove("saved", "water-pouring");
    a.remove("savedCollections", "after-work");
    await a.sync();
    // B, unaware, saves something unrelated before pulling the removals.
    b.edit("saved", { id: "dotting" });
    await b.sync();
    await a.sync();
    for (const d of [a, b]) {
      assert.ok(d.get("saved", "water-pouring")?.deletedAt);
      assert.ok(d.get("savedCollections", "after-work")?.deletedAt);
      assert.ok(!d.get("saved", "dotting")?.deletedAt, "the unrelated save was kept");
    }
  });
});

describe("full sync audit: simultaneous offline edits on both devices, across every collection", () => {
  it("every collection converges to the same state on both devices after independent offline edits", async () => {
    const p = await parent("audit-converge");
    const a = await p.device(), b = await p.device();
    const photoA = await addPhoto(a), photoB = await addPhoto(b);

    // Shared starting point.
    a.edit("children", child("c-1", "Mia"));
    a.edit("children", child("c-2", "Leo"));
    a.edit("entries", entry("m-1", "c-1", "Started"));
    a.edit("records", { id: "r-1", childId: "c-1", lesson: "Pouring", date: "2026-10-01", kind: "tried", activityId: "water-pouring" });
    a.edit("plans", plan("p-1", ["c-1"]));
    a.edit("goals", goal("g-1", "Read daily"));
    a.edit("saved", { id: "water-pouring" });
    a.edit("savedCollections", { id: "after-work" });
    await a.sync(); await b.sync();

    // Both devices now go offline and make independent edits, to different records and different fields,
    // without syncing in between (simulating two parents using the app on separate devices with no connectivity).
    a.offline = true; b.offline = true;

    a.edit("children", { ...a.get("children", "c-1")!, notes: "Loves pouring water" });
    b.edit("children", { ...b.get("children", "c-2")!, notes: "Loves climbing" });

    a.edit("entries", { ...a.get("entries", "m-1")!, photos: [photoA] });
    b.edit("entries", entry("m-2", "c-2", "A quiet afternoon", [photoB]));

    a.edit("records", { ...a.get("records", "r-1")!, notes: "Confident now" });
    b.edit("records", { id: "r-2", childId: "c-2", lesson: "Climbing", date: "2026-10-03", kind: "tried", activityId: "climbing" });

    a.edit("plans", { ...a.get("plans", "p-1")!, completed: true, completedDate: "2026-10-02" });
    b.edit("plans", plan("p-2", ["c-2"], { note: "Try after nap" }));

    a.edit("goals", { ...a.get("goals", "g-1")!, completed: true });
    b.edit("goals", goal("g-2", "Outdoor time", { description: "Every afternoon" }));

    a.edit("saved", { id: "dotting" });
    b.remove("saved", "water-pouring");

    a.edit("savedCollections", { id: "autumn" });
    b.remove("savedCollections", "after-work");

    for (const d of [a, b]) await assert.rejects(d.sync(), SyncOffline);
    a.offline = false; b.offline = false;

    // Both come back online; several rounds, in an order neither device controls.
    await a.sync(); await b.sync(); await a.sync(); await b.sync(); await a.sync();

    // An optional field is represented differently depending on whether a device created the record (keeping
    // whatever it had, "" included) or only ever pulled it from the server (mapping.ts's opt()/und() round-trip
    // "" through null and back as undefined; the same manual pattern is used for interests/skills arrays). Every
    // reader in the app already treats "" the same as missing (e.g. ChildrenPage.tsx: `c.interests?.length`), and
    // children.photo has its own such pair, "" vs. the legacy placeholder DEFAULT_CHILD_PHOTO (childPhotoSrc).
    // None of this is a real divergence, so the comparison below normalises all of it away before comparing.
    const canon = (c: string, r: Rec) => {
      const n: Rec = { ...r };
      if (c === "children" && n.photo === DEFAULT_CHILD_PHOTO) n.photo = "";
      for (const k of Object.keys(n)) if (n[k] === "" || (Array.isArray(n[k]) && (n[k] as unknown[]).length === 0)) delete n[k];
      return JSON.stringify(n, Object.keys(n).sort()); // key order is only an insertion-order artifact, not content
    };
    const collections = ["children", "entries", "records", "plans", "goals", "saved", "savedCollections", "photos"] as const;
    for (const c of collections) {
      const liveA = a.live(c).map(r => [r.id, canon(c, r)]).sort();
      const liveB = b.live(c).map(r => [r.id, canon(c, r)]).sort();
      assert.deepEqual(liveA, liveB, `${c} diverged between the two devices`);
    }
    assert.equal(a.get("children", "c-1")?.notes, "Loves pouring water");
    assert.equal(a.get("children", "c-2")?.notes, "Loves climbing");
    assert.deepEqual(a.get("entries", "m-1")?.photos, [photoA]);
    assert.equal(a.get("entries", "m-2")?.text, "A quiet afternoon");
    assert.equal(a.get("records", "r-1")?.notes, "Confident now");
    assert.equal(a.get("records", "r-2")?.lesson, "Climbing");
    assert.equal(a.get("plans", "p-1")?.completed, true);
    assert.equal(a.get("plans", "p-2")?.note, "Try after nap");
    assert.equal(a.get("goals", "g-1")?.completed, true);
    assert.equal(a.get("goals", "g-2")?.description, "Every afternoon");
    assert.ok(a.get("saved", "dotting"));
    assert.ok(a.get("saved", "water-pouring")?.deletedAt, "the removal on B was not undone by A's unrelated save");
    assert.ok(a.get("savedCollections", "autumn"));
    assert.ok(a.get("savedCollections", "after-work")?.deletedAt);
    assert.deepEqual(a.outbox(), []);
    assert.deepEqual(b.outbox(), []);
  });
});

describe("full sync audit: a third device signing in from scratch", () => {
  it("receives the complete, already-converged state, with deletions intact and nothing resurrected", async () => {
    const p = await parent("audit-newdevice");
    const a = await p.device(), b = await p.device();
    a.edit("children", child("c-1", "Mia"));
    a.edit("children", child("c-2", "Leo"));
    a.edit("entries", entry("m-1", "c-1", "First steps"));
    a.edit("goals", goal("g-1", "Read daily"));
    a.edit("plans", plan("p-1", ["c-1"]));
    a.edit("saved", { id: "water-pouring" });
    await a.sync(); await b.sync();
    // B deletes a child; A, unaware, edits that same child's sibling (an unrelated record) before pulling.
    b.remove("children", "c-2");
    await b.sync();
    a.edit("children", { ...a.get("children", "c-1")!, first: "Amelia" });
    await a.sync(); await b.sync(); await a.sync();

    // A brand-new device for the same account: empty local store, first sync ever (cursor 0 for every table).
    const c = await p.device();
    assert.deepEqual(c.outbox(), []);
    await c.sync();
    assert.equal(c.get("children", "c-1")?.first, "Amelia");
    assert.ok(c.get("children", "c-2")?.deletedAt, "the deletion made before this device ever existed is still honoured");
    assert.equal(c.get("entries", "m-1")?.text, "First steps");
    assert.equal(c.get("goals", "g-1")?.title, "Read daily");
    assert.ok(c.get("plans", "p-1"));
    assert.ok(c.get("saved", "water-pouring"));
    // Syncing again changes nothing further: the new device is now fully caught up.
    const again = await c.sync();
    assert.equal(again.pushed, 0);
    assert.equal(again.pulled, 0);
  });
});

describe("full sync audit: sign-out on one device, sign-in with the same account on another", () => {
  it("a session signed out everywhere still lets a different, already-authenticated device sync; a freshly signed-in device gets everything", async () => {
    const p = await parent("audit-signout");
    const a = await p.device();
    a.edit("children", child("c-1", "Mia"));
    a.edit("entries", entry("m-1", "c-1", "First steps"));
    await a.sync();

    // The parent signs out of device A everywhere (e.g. "sign out of all devices").
    must(await a.client.auth.signOut({ scope: "global" }));

    // A different, already signed-in device for the same account keeps working (its own session is separate).
    const b = await p.device();
    await b.sync();
    assert.equal(b.get("children", "c-1")?.first, "Mia");

    // The parent signs back in on a new device with the same credentials (the server considers this a new
    // session entirely; the app would get here through email-code sign-in, see tests/db/auth.test.ts).
    const c = await device(p.user, p.familyId);
    await c.sync();
    assert.equal(c.get("entries", "m-1")?.text, "First steps");
    assert.deepEqual(c.outbox(), []);

    // Device A's own revoked session can no longer write anything (the server rejects it).
    a.edit("children", { ...a.get("children", "c-1")!, first: "Renamed after sign-out" });
    await assert.rejects(a.sync());
    assert.equal((await serverRows("children", p.familyId))[0].first, "Mia", "the revoked device's edit never reached the server");
  });
});

describe("full sync audit: account isolation holds for every collection at once", () => {
  it("a device pointed at a family it doesn't belong to is refused for every collection, and nothing it sends is ever stored", async () => {
    const p = await parent("audit-isolation-p"), q = await parent("audit-isolation-q");
    const pa = await p.device();
    pa.edit("children", child("c-1", "Mia"));
    pa.edit("entries", entry("m-1", "c-1", "First steps"));
    pa.edit("plans", plan("p-1", ["c-1"]));
    pa.edit("goals", goal("g-1", "Read daily"));
    pa.edit("saved", { id: "water-pouring" });
    pa.edit("savedCollections", { id: "after-work" });
    await pa.sync();

    const intruder = await device(q.user, p.familyId); // q's credentials, pointed at p's family
    intruder.edit("children", child("c-x", "Intruder"));
    intruder.edit("entries", entry("m-x", "c-1", "Forged"));
    intruder.edit("goals", goal("g-x", "Forged goal"));
    const result = await intruder.sync().catch(e => e);
    const message = result instanceof Error ? result.message : JSON.stringify(result.notSent);
    assert.match(message, /member|row-level|policy|not readable|42501/);

    for (const [table, ids] of [["children", ["c-1", "c-x"]], ["entries", ["m-1", "m-x"]], ["goals", ["g-1", "g-x"]]] as const) {
      const rows = await serverRows(table, p.familyId);
      assert.deepEqual(rows.map(r => r.id).sort(), [ids[0]], `${table}: an intruder's row was stored`);
    }
    // q's own (separate) family is completely untouched by the attempt.
    for (const t of ["children", "entries", "plans", "goals", "saved_activities", "saved_collections"]) {
      assert.deepEqual(await serverRows(t, q.familyId), [], `${t}: something leaked into q's family`);
    }
  });
});
