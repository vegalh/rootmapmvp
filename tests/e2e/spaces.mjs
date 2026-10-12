// Local spaces and the outbox (Phase 2B-2 M3), with cloud features ON, against the local Supabase stack. Run with
// `npm run test:e2e:cloud`.
//
// One device, a guest who already uses RootMap, then two accounts: each space is its own database; switching never
// shows another space's data; the guest database is never changed; every account change has its outbox entry,
// written in the same transaction (a failed or interrupted write leaves neither); nothing is uploaded.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { admin, newDevice, sleep, startServer, stepper, ui } from "./cloudkit.mjs";

const server = await startServer();
const BASE = server.base;
let page, u;
const { step, finish } = stepper(() => page);

const store = body => page.eval(`import("/src/lib/data/store.ts").then(async S => { ${body} })`);
const child = (id, first) => ({ id, first, last: "Test", dob: "2022-05-01", enrolled: "", lessons: 0, group: "Primary", photo: "", createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z", deletedAt: null, origin: "user", position: 100 });
const addChild = (id, first) => store(`return S.write({ collections: { children: [${JSON.stringify(child(id, first))}] } }, { rollback: true });`);
const childNames = () => store(`return S.getCollection("children").filter(c => !c.deletedAt).map(c => c.first).sort();`);
const accountDb = id => `rootmap-account-${id}`;
// Records and outbox of a database, for comparisons (settings are left out: the app records its own start-up ones).
const dataOf = async name => {
  const d = await u.dump(name);
  return JSON.stringify({ ...Object.fromEntries(Object.entries(d).filter(([k]) => !["settings", "meta"].includes(k))) });
};
// Every record in an account space has exactly one outbox entry, and every entry has its record.
async function assertOutboxConsistent(name) {
  const d = await u.dump(name);
  const records = [];
  for (const c of ["children", "records", "observations", "entries", "plans", "goals", "saved", "photos"]) for (const r of d[c]) records.push([`${c}:${r.id}`, r.deletedAt ? "delete" : "put"]);
  const entries = d.outbox.map(e => [e.key, e.op]);
  assert.deepEqual(entries.sort(), records.sort(), "outbox and records match one to one");
  const meta = d.meta.find(m => m.key === "space");
  for (const e of d.outbox) assert.equal(e.deviceId, meta.deviceId);
  return d;
}

const emailA = `a-${randomUUID()}@example.com`;
const emailB = `b-${randomUUID()}@example.com`;
let guestBefore, idA, idB, aAfter;

try {
  // A device where RootMap was already in use without an account.
  page = await newDevice("spaces", 9348, `if (location.origin === ${JSON.stringify(BASE)} && !localStorage.getItem("rootmap-data-store")) localStorage.setItem("rootmap-seed-version", "2");`);
  u = ui(page);
  await page.nav(`${BASE}/`);
  await u.appReady();
  await u.waitCloud("signed-out");

  await step("Guest space: the original database, unchanged in layout (no outbox), holding the parent's guest data", async () => {
    assert.deepEqual(await u.space(), { kind: "guest" });
    assert.equal(await addChild("c-guest", "Gina"), null);
    assert.ok((await childNames()).includes("Gina"));
    const d = await u.dump("rootmap");
    assert.ok(!("outbox" in d) && !("syncRecords" in d), "guest database has no sync stores");
    assert.deepEqual(await store(`return S.pendingOutbox();`), []);
    await sleep(300);
    guestBefore = JSON.stringify(await u.dump("rootmap"));
  });

  await step("Signing in as A opens A's own, new space: empty, with outbox and device id; the guest database is unchanged", async () => {
    await u.openProfile();
    await u.click("Sign in or create an account");
    await u.welcomeShown();
    await u.signIn(emailA, "Create an account");
    idA = (await u.cloudState()).user.userId;
    assert.deepEqual(await u.space(), { kind: "account", userId: idA });
    assert.deepEqual(await childNames(), [], "no guest children in A's space");
    assert.ok(!(await u.has("Gina")));
    const d = await u.dump(accountDb(idA));
    assert.ok("outbox" in d && "syncRecords" in d);
    assert.deepEqual(d.outbox, []);
    const meta = d.meta.find(m => m.key === "space");
    assert.equal(meta.userId, idA);
    assert.equal(meta.deviceId, await page.eval(`localStorage.getItem("rootmap.device-id")`));
    assert.match(meta.deviceId, /^d-[0-9a-f-]{36}$/);
    assert.equal(JSON.stringify(await u.dump("rootmap")), guestBefore);
  });

  await step("Changes in A's space are queued in A's outbox in the same transaction; nothing is uploaded", async () => {
    assert.equal(await addChild("c-ada", "Ada"), null);
    assert.equal(await addChild("c-gone", "Temp"), null);
    // A photo, as the photo picker stores it.
    const photo = await store(`const blob = await (await fetch("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")).blob(); return S.savePhoto(blob, { width: 1, height: 1 });`);
    assert.equal(photo.ok, true);
    const queued = await store(`return S.pendingOutbox().find(e => e.key === "children:c-gone");`);
    // Deleting it updates its one entry: op "delete", same place in the queue.
    assert.equal(await store(`const c = S.getCollection("children").find(c => c.id === "c-gone"); return S.write({ collections: { children: [{ ...c, deletedAt: new Date().toISOString() }] } }, { rollback: true });`), null);
    const d = await assertOutboxConsistent(accountDb(idA));
    const gone = d.outbox.find(e => e.key === "children:c-gone");
    assert.equal(gone.op, "delete");
    assert.equal(gone.queuedAt, queued.queuedAt);
    assert.ok(gone.seq > queued.seq);
    assert.ok(d.outbox.some(e => e.key === `photos:${photo.ref}`));
    // Memory and storage agree.
    assert.deepEqual((await store(`return S.pendingOutbox();`)).map(e => e.key).sort(), d.outbox.map(e => e.key).sort());
    const { familyId } = (await u.cloudState()).account;
    assert.deepEqual(await admin(`/rest/v1/children?family_id=eq.${familyId}&select=id`), [], "nothing uploaded");
    assert.equal(JSON.stringify(await u.dump("rootmap")), guestBefore);
  });

  await step("A write that fails part-way stores nothing: no record and no outbox entry", async () => {
    const before = await dataOf(accountDb(idA));
    // The second record can't be stored (IndexedDB can't keep a function), so the whole change must fail.
    const failure = await store(`return S.write({ collections: { children: [${JSON.stringify(child("c-half", "Half"))}, { ...${JSON.stringify(child("c-bad", "Bad"))}, oops: () => 1 }] } }, { rollback: true });`);
    assert.ok(failure, "the write reports a failure");
    assert.equal(await dataOf(accountDb(idA)), before, "nothing stored");
    assert.equal(await store(`return S.pendingOutbox().some(e => e.id === "c-half" || e.id === "c-bad");`), false, "nothing queued in memory");
    assert.ok(!(await childNames()).includes("Half"));
  });

  await step("A write interrupted by closing the page is stored completely or not at all, records and outbox together", async () => {
    // 400 records in one change, then the page reloads at once, while the transaction may still be running.
    const many = Array.from({ length: 400 }, (_, i) => child(`c-bulk-${i}`, `Bulk${i}`));
    const loaded = page.waitEvent("Page.loadEventFired", 20000);
    await page.eval(`import("/src/lib/data/store.ts").then(S => { S.write({ collections: { children: ${JSON.stringify(many)} } }); location.reload(); })`);
    await loaded;
    await u.appReady();
    const d = await assertOutboxConsistent(accountDb(idA));
    const stored = d.children.filter(c => c.id.startsWith("c-bulk-")).length;
    assert.ok(stored === 0 || stored === 400, `all or nothing (stored ${stored})`);
    console.log(`      (interrupted write: ${stored ? "committed before the reload" : "not committed"})`);
    aAfter = await dataOf(accountDb(idA));
  });

  await step("Signing out returns to the guest space: guest data exactly as before, none of A's data", async () => {
    await u.signOut();
    assert.deepEqual(await u.space(), { kind: "guest" });
    const names = await childNames();
    assert.ok(names.includes("Gina"));
    assert.ok(!names.includes("Ada"));
    assert.equal(JSON.stringify(await u.dump("rootmap")), guestBefore);
    assert.deepEqual(await store(`return S.pendingOutbox();`), []);
  });

  await step("Signing in as B opens B's own empty space: no guest data and none of A's; B's changes stay in B", async () => {
    await u.openProfile();
    await u.click("Sign in or create an account");
    await u.welcomeShown();
    await u.signIn(emailB, "Create an account");
    idB = (await u.cloudState()).user.userId;
    assert.notEqual(idB, idA);
    assert.deepEqual(await u.space(), { kind: "account", userId: idB });
    assert.deepEqual(await childNames(), []);
    assert.equal(await addChild("c-bea", "Bea"), null);
    await assertOutboxConsistent(accountDb(idB));
    const b = await u.dump(accountDb(idB));
    assert.deepEqual(b.children.map(c => c.id), ["c-bea"]);
    assert.equal(await dataOf(accountDb(idA)), aAfter, "A's space untouched while B is signed in");
    assert.equal(JSON.stringify(await u.dump("rootmap")), guestBefore);
  });

  await step("Switching back to A (sign out, sign in) shows exactly A's data again, and none of B's", async () => {
    await u.signOut();
    await u.openProfile();
    await u.click("Sign in or create an account");
    await u.welcomeShown();
    await sleep(1100);
    await u.signIn(emailA);
    assert.deepEqual(await u.space(), { kind: "account", userId: idA });
    const names = await childNames();
    assert.ok(names.includes("Ada"));
    assert.ok(!names.includes("Bea") && !names.includes("Gina"));
    assert.equal(await dataOf(accountDb(idA)), aAfter);
    const names2 = await u.dbNames();
    for (const n of ["rootmap", accountDb(idA), accountDb(idB)]) assert.ok(names2.includes(n), n);
  });

  await step("The guest database was never changed, and no account's records appear in another space", async () => {
    assert.equal(JSON.stringify(await u.dump("rootmap")), guestBefore);
    const a = await u.dump(accountDb(idA)), b = await u.dump(accountDb(idB)), g = await u.dump("rootmap");
    const ids = d => new Set(d.children.map(c => c.id));
    assert.ok(!ids(a).has("c-guest") && !ids(b).has("c-guest"));
    assert.ok(!ids(b).has("c-ada") && !ids(g).has("c-ada"));
    assert.ok(!ids(a).has("c-bea") && !ids(g).has("c-bea"));
    for (const id of [idA, idB]) {
      const { familyId } = { familyId: (await admin(`/rest/v1/family_members?user_id=eq.${id}&select=family_id`))[0].family_id };
      for (const table of ["children", "entries", "photos"]) assert.deepEqual(await admin(`/rest/v1/${table}?family_id=eq.${familyId}&select=id`), [], `no ${table} uploaded`);
    }
  });
} finally {
  await page?.close().catch(() => undefined);
  server.stop();
}
process.exit(finish());
