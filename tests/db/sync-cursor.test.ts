// Synchronization cursor (docs/data-architecture-phase2.md section 5.5).
// Concurrency cases use direct database connections acting as the signed-in user, so a transaction can be
// held open and the order of commits forced deterministically.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type pg from "pg";
import {
  actAs, applyRows, dbConnection, must, needsFullResync, newParent, pullPage, queryAs, serviceClient, waitUntilBlocked, type PulledRow,
} from "./helpers.ts";

type Parent = Awaited<ReturnType<typeof newParent>>;
let A: Parent;
let C: Parent; // an unrelated family
let t1: pg.Client;
let t2: pg.Client;
let reader: pg.Client;
let monitor: pg.Client;

const familySeq = async (familyId: string) => Number((await monitor.query("select change_seq from public.families where id = $1", [familyId])).rows[0].change_seq);
const insertChild = (c: pg.Client, familyId: string, id: string) =>
  c.query<{ change_seq: string }>("insert into public.children (family_id, id, first) values ($1, $2, 'x') returning change_seq", [familyId, id]);
const visible = async (ids: string[]) =>
  (await queryAs<{ id: string }>(reader, A.id, "select id from public.children where family_id = $1 and id = any($2) order by id", [A.familyId, ids])).rows.map(r => r.id);

// Pulls a table from `cursor` until a page comes back empty. `between` runs after each page (simulated
// concurrent writes); `stopAfter` simulates a crash after that many pages without saving the cursor.
async function pullAll(client: Parent["client"], table: string, familyId: string, cursor: number, opts: { limit?: number; between?: (page: number) => Promise<void>; stopAfter?: number } = {}) {
  const store = new Map<string, PulledRow>();
  let pages = 0;
  for (;;) {
    const rows = await pullPage(client, table, familyId, cursor, opts.limit ?? 500);
    if (!rows.length) break;
    applyRows(store, rows);
    pages++;
    if (opts.stopAfter && pages >= opts.stopAfter) return { store, cursor, interrupted: true };
    cursor = rows[rows.length - 1].change_seq; // saved only after the page is applied
    await opts.between?.(pages);
  }
  return { store, cursor, interrupted: false };
}

before(async () => {
  [A, C] = await Promise.all([newParent("cur-a"), newParent("cur-c")]);
  [t1, t2, reader, monitor] = await Promise.all([dbConnection(), dbConnection(), dbConnection(), dbConnection()]);
});
after(() => Promise.all([t1, t2, reader, monitor].map(c => c.end())));

describe("change numbers under concurrency", () => {
  it("concurrent writes in one family commit in change-number order", async () => {
    await t1.query("begin");
    await actAs(t1, A.id);
    const s1 = Number((await insertChild(t1, A.familyId, "co-1")).rows[0].change_seq);

    await t2.query("begin");
    await actAs(t2, A.id);
    const pid2 = (await t2.query("select pg_backend_pid() as pid")).rows[0].pid;
    const second = insertChild(t2, A.familyId, "co-2");
    await waitUntilBlocked(monitor, pid2); // T2 waits for T1's lock on the family row

    assert.deepEqual(await visible(["co-1", "co-2"]), [], "uncommitted rows were visible");
    await t1.query("commit");
    const s2 = Number((await second).rows[0].change_seq);
    assert.equal(s2, s1 + 1, "the later transaction did not get the next number");
    assert.deepEqual(await visible(["co-1", "co-2"]), ["co-1"], "a higher number became visible before a lower one");
    await t2.query("commit");
    assert.deepEqual(await visible(["co-1", "co-2"]), ["co-1", "co-2"]);
  });

  it("a rolled-back write leaves no gap", async () => {
    await t1.query("begin");
    await actAs(t1, A.id);
    const r1 = Number((await insertChild(t1, A.familyId, "rb-1")).rows[0].change_seq);
    await t1.query("rollback");
    const r2 = Number((await queryAs<{ change_seq: string }>(t2, A.id, "insert into public.children (family_id, id, first) values ($1, 'rb-2', 'x') returning change_seq", [A.familyId])).rows[0].change_seq);
    assert.equal(r2, r1);
    assert.deepEqual(await visible(["rb-1"]), []);
  });

  it("different families never wait for each other", async () => {
    await t1.query("begin");
    await actAs(t1, A.id);
    await insertChild(t1, A.familyId, "ind-1");
    const started = Date.now();
    await queryAs(t2, C.id, "insert into public.children (family_id, id, first) values ($1, 'ind-2', 'x')", [C.familyId]);
    assert.ok(Date.now() - started < 2000, "a write in another family was blocked");
    await t1.query("rollback");
  });

  it("a write into a family the user does not belong to is refused before any lock is taken", async () => {
    await t1.query("begin");
    await actAs(t1, A.id);
    await insertChild(t1, A.familyId, "lock-holder");
    const started = Date.now();
    await assert.rejects(queryAs(t2, C.id, "insert into public.children (family_id, id, first) values ($1, 'intruder', 'x')", [A.familyId]), /not a member/);
    assert.ok(Date.now() - started < 2000, "the refused write waited on another family's lock");
    await t1.query("rollback");
  });
});

describe("pulling current rows", () => {
  it("several edits between pulls arrive once, as the latest state", async () => {
    const cursor = await familySeq(A.familyId);
    must(await A.client.from("children").insert({ family_id: A.familyId, id: "me-1", first: "v1" }));
    for (let i = 2; i <= 6; i++) must(await A.client.from("children").update({ first: `v${i}` }).eq("family_id", A.familyId).eq("id", "me-1"));
    const rows = await pullPage(A.client, "children", A.familyId, cursor);
    const mine = rows.filter(r => r.id === "me-1");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].rev, 6);
    assert.equal(mine[0].first, "v6");
  });

  it("a soft deletion arrives as a tombstone", async () => {
    const cursor = await familySeq(A.familyId);
    must(await A.client.from("children").update({ deleted_at: new Date().toISOString() }).eq("family_id", A.familyId).eq("id", "me-1"));
    const rows = await pullPage(A.client, "children", A.familyId, cursor);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "me-1");
    assert.ok(rows[0].deleted_at);
  });

  it("paging while rows are being updated misses nothing", async () => {
    const svc = serviceClient();
    const P = await newParent("cur-page");
    const ids = Array.from({ length: 1200 }, (_, i) => `pg-${String(i).padStart(4, "0")}`);
    for (let i = 0; i < ids.length; i += 400) {
      must(await svc.from("saved_activities").insert(ids.slice(i, i + 400).map(id => ({ family_id: P.familyId, id }))));
    }
    const touch = (some: string[]) => svc.from("saved_activities").update({ position: Math.random() }).eq("family_id", P.familyId).in("id", some);
    const { store } = await pullAll(P.client, "saved_activities", P.familyId, 0, {
      between: async page => {
        if (page !== 1) return;
        must(await touch(ids.slice(900, 920))); // not yet read: they move to higher numbers
        must(await touch(ids.slice(0, 20))); // already read: they change again
        must(await svc.from("saved_activities").update({ deleted_at: new Date().toISOString() }).eq("family_id", P.familyId).eq("id", ids[1100]));
      },
    });
    // Read the expected final state directly: the API caps one response at max_rows (1000).
    const server = (await monitor.query("select id, rev from public.saved_activities where family_id = $1", [P.familyId])).rows.map(r => ({ id: r.id as string, rev: Number(r.rev) }));
    assert.equal(server.length, ids.length);
    for (const s of server) {
      const got = store.get(s.id);
      assert.ok(got, `${s.id} was never received`);
      assert.equal(got.rev, s.rev, `${s.id}: received rev ${got.rev}, server has ${s.rev}`);
    }
    assert.ok(store.get(ids[1100])?.deleted_at, "the tombstone was not received");
  });

  it("an interrupted pull resumes from the saved cursor and loses nothing", async () => {
    const P = await newParent("cur-int");
    const svc = serviceClient();
    must(await svc.from("saved_activities").insert(Array.from({ length: 30 }, (_, i) => ({ family_id: P.familyId, id: `int-${i}` }))));
    const firstPage = await pullPage(P.client, "saved_activities", P.familyId, 0, 10);
    // Crash after the second page was fetched but before its cursor was saved.
    const crashed = await pullAll(P.client, "saved_activities", P.familyId, 0, { limit: 10, stopAfter: 2 });
    assert.ok(crashed.interrupted);
    assert.equal(crashed.cursor, firstPage[9].change_seq, "the saved cursor is not the end of the last completed page");
    const resumed = await pullAll(P.client, "saved_activities", P.familyId, crashed.cursor, { limit: 10 });
    applyRows(resumed.store, [...crashed.store.values()]);
    assert.equal(resumed.store.size, 30);
  });

  it("rolled-back writes and ignored duplicate inserts never make a pull skip a real change", async () => {
    const P = await newParent("cur-gap");
    const f = P.familyId;
    must(await P.client.from("children").insert({ family_id: f, id: "g-1", first: "one" }));
    const cursor = await familySeq(f);
    // An ignored duplicate still uses up a change number (the trigger runs before the conflict check).
    must(await P.client.from("children").upsert({ family_id: f, id: "g-1", first: "dup" }, { onConflict: "family_id,id", ignoreDuplicates: true }));
    // A rolled-back write takes a number that the next write reuses.
    await t1.query("begin");
    await actAs(t1, P.id);
    await insertChild(t1, f, "g-rolled-back");
    await t1.query("rollback");
    must(await P.client.from("children").insert({ family_id: f, id: "g-2", first: "two" }));
    must(await P.client.from("children").update({ first: "one, edited" }).eq("family_id", f).eq("id", "g-1"));
    const { store, cursor: end } = await pullAll(P.client, "children", f, cursor);
    assert.deepEqual([...store.keys()].sort(), ["g-1", "g-2"]);
    assert.equal(store.get("g-1")?.first, "one, edited");
    assert.equal(end, await familySeq(f), "the cursor did not reach the latest change");
  });

  it("a pull during an open transaction still receives that write once it commits", async () => {
    const P = await newParent("cur-open");
    const f = P.familyId;
    must(await P.client.from("children").insert({ family_id: f, id: "op-0", first: "before" }));
    let { cursor } = await pullAll(P.client, "children", f, 0);
    await t1.query("begin");
    await actAs(t1, P.id);
    await insertChild(t1, f, "op-1"); // holds the family lock, uncommitted
    const during = await pullAll(P.client, "children", f, cursor);
    assert.equal(during.store.size, 0, "an uncommitted row was visible");
    assert.equal(during.cursor, cursor, "the cursor moved past an uncommitted write");
    await t1.query("commit");
    const afterCommit = await pullAll(P.client, "children", f, during.cursor);
    assert.deepEqual([...afterCommit.store.keys()], ["op-1"]);
    cursor = afterCommit.cursor;
    assert.equal(cursor, await familySeq(f));
  });

  it("a device offline for a long time gets every change, including deletions", async () => {
    const P = await newParent("cur-off");
    const f = P.familyId;
    must(await P.client.from("children").insert([{ family_id: f, id: "o-1", first: "a" }, { family_id: f, id: "o-2", first: "b" }, { family_id: f, id: "o-3", first: "c" }]));
    must(await P.client.from("entries").insert({ family_id: f, id: "o-e1", child_id: "o-1", date: "2026-01-01", text: "x" }));
    for (let i = 0; i < 25; i++) must(await P.client.from("children").update({ first: `a${i}` }).eq("family_id", f).eq("id", "o-1"));
    must(await P.client.from("children").update({ deleted_at: new Date().toISOString() }).eq("family_id", f).eq("id", "o-2"));
    must(await P.client.from("entries").update({ deleted_at: new Date().toISOString() }).eq("family_id", f).eq("id", "o-e1"));
    assert.equal(await needsFullResync(P.client, f, 0), false);
    const children = (await pullAll(P.client, "children", f, 0)).store;
    const entries = (await pullAll(P.client, "entries", f, 0)).store;
    assert.equal(children.get("o-1")?.first, "a24");
    assert.ok(children.get("o-2")?.deleted_at);
    assert.equal(children.get("o-3")?.first, "c");
    assert.ok(entries.get("o-e1")?.deleted_at);
  });

  it("after tombstones are purged, a device behind the watermark is told to re-sync fully", async () => {
    const P = await newParent("cur-purge");
    const f = P.familyId;
    must(await P.client.from("saved_activities").insert({ family_id: f, id: "gone", deleted_at: new Date().toISOString() }));
    const oldCursor = 0;
    // Simulates the future purge job: the hard delete does not take a change number, so a device could not
    // learn about it from a pull. The job records the watermark in the same transaction.
    await monitor.query("begin");
    await monitor.query("delete from public.saved_activities where family_id = $1 and id = 'gone'", [f]);
    await monitor.query("update public.families set purged_through_seq = change_seq where id = $1", [f]);
    await monitor.query("commit");
    assert.equal(await needsFullResync(P.client, f, oldCursor), true);
    assert.equal(await needsFullResync(P.client, f, await familySeq(f)), false);
    assert.ok((await P.client.from("families").update({ purged_through_seq: 0 }).eq("id", f)).error, "a client changed the watermark");
  });
});
