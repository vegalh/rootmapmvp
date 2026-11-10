// The daily loop's shared data against the local stack (migration 20261110000100, docs/data-architecture-phase2.md
// section 21): "Did they enjoy it?" on activity records and the Moment ↔ tried record link through the app's sync
// engine, older clients that don't know them, and "Our routine" in family_settings with its access rules.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { SyncOffline } from "../../src/lib/sync/engine.ts";
import { setDailyColumns } from "../../src/lib/sync/mapping.ts";
import { dailyLoopOnServer, syncRoutine, type RoutineLocal, type RoutineValue } from "../../src/lib/sync/dailyLoop.ts";
import type { RoutineSetting } from "../../src/lib/todayIdeas.ts";
import { anonClient, must, newParent, secondDevice, serviceClient } from "./helpers.ts";
import { parent } from "./syncDevice.ts";

const admin = () => serviceClient();
const child = (id: string) => ({ id, first: "Mia", last: "Li", dob: "2022-03-04", enrolled: "", lessons: 0, group: "", photo: "", interests: [] });
const tried = (id: string, childId: string, fields: Record<string, unknown> = {}) => ({ id, childId, lesson: "Pouring", date: "2026-11-09", kind: "tried", activityId: "water-pouring", ...fields });
const serverRow = async (table: string, familyId: string, id: string) => must(await admin().from(table).select("*").eq("family_id", familyId).eq("id", id).single());

before(() => setDailyColumns(true));
after(() => setDailyColumns(false));

describe("daily loop: enjoyed and Moment links sync", () => {
  it("the server has the migration", async () => {
    const p = await newParent("daily-probe");
    assert.equal(await dailyLoopOnServer(p.client), true);
  });

  it("enjoyed and the Moment's tried record reach the other device; no duplicates", async () => {
    const p = await parent("daily-two");
    const a = await p.device(), b = await p.device();
    a.edit("children", child("c-1"));
    a.edit("records", tried("t-1", "c-1", { enjoyed: "loved" }));
    a.edit("entries", { id: "m-1", childId: "c-1", date: "2026-11-09", title: "Pouring Water", text: "All by herself", photos: [], recordId: "t-1" });
    await a.sync();
    assert.equal((await serverRow("activity_records", p.familyId, "t-1")).enjoyed, "loved");
    assert.equal((await serverRow("entries", p.familyId, "m-1")).record_id, "t-1");
    await b.sync();
    assert.equal(b.get("records", "t-1")?.enjoyed, "loved");
    assert.equal(b.get("entries", "m-1")?.recordId, "t-1");
    assert.deepEqual(b.outbox(), [], "downloads aren't queued again");
    // Changed on B ("Not today"), back to A; still one Moment.
    b.edit("records", { ...b.get("records", "t-1")!, enjoyed: "not-today" });
    await b.sync();
    await a.sync();
    assert.equal(a.get("records", "t-1")?.enjoyed, "not-today");
    assert.equal(must(await admin().from("entries").select("id").eq("family_id", p.familyId)).length, 1);
  });

  it("older records and Moments without them still sync; a Moment whose record is missing or deleted syncs too", async () => {
    const p = await parent("daily-old");
    const a = await p.device(), b = await p.device();
    a.edit("children", child("c-1"));
    a.edit("records", tried("t-plain", "c-1"));
    a.edit("records", tried("t-gone", "c-1"));
    a.edit("entries", { id: "m-plain", childId: "c-1", date: "2026-11-09", text: "No link", photos: [] });
    a.edit("entries", { id: "m-orphan", childId: "c-1", date: "2026-11-09", text: "Its record never synced", photos: [], recordId: "t-never-existed" });
    a.edit("entries", { id: "m-gone", childId: "c-1", date: "2026-11-09", text: "Its record was deleted", photos: [], recordId: "t-gone" });
    await a.sync();
    a.remove("records", "t-gone");
    await a.sync();
    assert.deepEqual(a.outbox(), []);
    await b.sync();
    assert.equal(b.get("records", "t-plain")?.enjoyed, undefined);
    assert.equal(b.get("entries", "m-plain")?.recordId, undefined);
    assert.equal(b.get("entries", "m-orphan")?.recordId, "t-never-existed");
    assert.equal(b.get("entries", "m-gone")?.text, "Its record was deleted", "the Moment stays");
    assert.ok(b.get("records", "t-gone")?.deletedAt);
  });

  it("feedback given offline is sent once the device is back online", async () => {
    const p = await parent("daily-offline");
    const a = await p.device(), b = await p.device();
    a.edit("children", child("c-1"));
    a.edit("records", tried("t-1", "c-1"));
    await a.sync();
    a.offline = true;
    a.edit("records", { ...a.get("records", "t-1")!, enjoyed: "loved" });
    await assert.rejects(a.sync(), SyncOffline);
    a.offline = false;
    await a.sync();
    await b.sync();
    assert.equal(b.get("records", "t-1")?.enjoyed, "loved");
  });

  it("an older client (without the columns) neither sends nor erases them", async () => {
    const p = await parent("daily-compat");
    const neu = await p.device(), old = await p.device();
    neu.edit("children", child("c-1"));
    neu.edit("records", tried("t-1", "c-1", { enjoyed: "loved" }));
    neu.edit("entries", { id: "m-1", childId: "c-1", date: "2026-11-09", text: "x", photos: [], recordId: "t-1" });
    await neu.sync();
    setDailyColumns(false);
    try {
      await old.sync();
      old.edit("records", { ...old.get("records", "t-1")!, notes: "Edited on the old phone" });
      old.edit("entries", { ...old.get("entries", "m-1")!, text: "Edited on the old phone" });
      await old.sync();
      assert.deepEqual(old.outbox(), []);
    } finally {
      setDailyColumns(true);
    }
    const record = await serverRow("activity_records", p.familyId, "t-1");
    assert.equal(record.notes, "Edited on the old phone");
    assert.equal(record.enjoyed, "loved", "kept");
    assert.equal((await serverRow("entries", p.familyId, "m-1")).record_id, "t-1", "kept");
    await neu.sync();
    assert.equal(neu.get("records", "t-1")?.enjoyed, "loved");
    assert.equal(neu.get("records", "t-1")?.notes, "Edited on the old phone");
  });

  it("the server refuses a value it doesn't know, and another family's record", async () => {
    const p = await newParent("daily-check");
    const other = await newParent("daily-outsider");
    must(await p.client.from("children").insert({ family_id: p.familyId, id: "c-1", first: "Mia" }));
    must(await p.client.from("activity_records").insert({ family_id: p.familyId, id: "t-1", child_id: "c-1", kind: "tried", date: "2026-11-09", enjoyed: "loved" }));
    const bad = await p.client.from("activity_records").update({ enjoyed: "maybe" }).eq("family_id", p.familyId).eq("id", "t-1");
    assert.ok(bad.error, "only loved / not-today");
    const theirs = must(await other.client.from("activity_records").update({ enjoyed: "not-today" }).eq("family_id", p.familyId).eq("id", "t-1").select());
    assert.deepEqual(theirs, [], "RLS: nothing of another family is changed");
    assert.equal((await serverRow("activity_records", p.familyId, "t-1")).enjoyed, "loved");
  });
});

describe("daily loop: Our routine (family_settings)", () => {
  const memory = (value: RoutineSetting): RoutineLocal & { value: RoutineSetting; seen: RoutineValue | null } => ({
    value, seen: null,
    get() { return this.value; }, set(next) { this.value = next; },
    known() { return this.seen; }, setKnown(v) { this.seen = v; },
  });

  it("follows the family across devices; the first change to reach the server wins", async () => {
    const p = await newParent("routine-two");
    const phone = memory({ routines: ["cooking", "bedtime"], answeredAt: "2026-11-10T08:00:00.000Z" });
    const tablet = memory({ routines: [] });
    await syncRoutine(p.client, p.familyId, phone);
    const tabletClient = await secondDevice(p);
    await syncRoutine(tabletClient, p.familyId, tablet);
    assert.deepEqual(tablet.value, { routines: ["cooking", "bedtime"], answeredAt: "2026-11-10T08:00:00.000Z" });
    // Both change it while apart: the tablet reaches the server first, the phone adopts its answer.
    tablet.value = { routines: ["after-dinner"], answeredAt: "2026-11-10T09:00:00.000Z" };
    phone.value = { routines: ["weekend-morning"], answeredAt: "2026-11-10T09:05:00.000Z" };
    await syncRoutine(tabletClient, p.familyId, tablet);
    await syncRoutine(p.client, p.familyId, phone);
    assert.deepEqual(phone.value.routines, ["after-dinner"]);
    // A change on one device with nothing new on the server is sent.
    phone.value = { routines: [], answeredAt: "2026-11-10T10:00:00.000Z" };
    await syncRoutine(p.client, p.familyId, phone);
    await syncRoutine(tabletClient, p.familyId, tablet);
    assert.deepEqual(tablet.value, { routines: [], answeredAt: "2026-11-10T10:00:00.000Z" }, "dismissing is an answer too");
    const rows = must(await admin().from("family_settings").select("*").eq("family_id", p.familyId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].updated_by, p.id, "set by the server");
  });

  it("an unanswered device sends nothing", async () => {
    const p = await newParent("routine-none");
    await syncRoutine(p.client, p.familyId, memory({ routines: [] }));
    assert.deepEqual(must(await admin().from("family_settings").select("*").eq("family_id", p.familyId)), []);
  });

  it("only the family's own members can read or change it; nobody can delete it or set who changed it", async () => {
    const p = await newParent("routine-rls");
    const other = await newParent("routine-other");
    must(await p.client.from("family_settings").insert({ family_id: p.familyId, key: "routine", value: { routines: ["cooking"], answeredAt: "2026-11-10T08:00:00.000Z" } }));
    assert.deepEqual(must(await other.client.from("family_settings").select("*").eq("family_id", p.familyId)), [], "not readable");
    assert.ok((await other.client.from("family_settings").insert({ family_id: p.familyId, key: "routine", value: {} })).error, "not insertable");
    assert.deepEqual(must(await other.client.from("family_settings").update({ value: {} }).eq("family_id", p.familyId).select()), [], "not updatable");
    await p.client.from("family_settings").delete().eq("family_id", p.familyId);
    assert.equal(must(await admin().from("family_settings").select("*").eq("family_id", p.familyId)).length, 1, "never deleted by a client");
    assert.ok((await p.client.from("family_settings").update({ updated_by: other.id }).eq("family_id", p.familyId)).error, "no grant on updated_by");
    assert.ok((await p.client.from("family_settings").insert({ family_id: p.familyId, key: "theme", value: {} })).error, "only known keys");
    const anon = await anonClient().from("family_settings").select("*");
    assert.ok(anon.error || !anon.data?.length, "nothing without a session");
  });
});
