// Children shared between families, in the real app (Shared Child Profiles Phase 2b): browsers with their own
// IndexedDB, the app's runner, store and sync, against the local Supabase stack. Shared sync is switched on only for
// this dev server (VITE_ROOTMAP_SHARED_SYNC=on, honoured in development builds only). Run with `npm run test:e2e:cloud`.
//
// O owns Mia and Leo (family FO). E is an editor of Mia, a viewer of Leo, and a viewer of P's own "c-mia" (family FP);
// E also has a child of their own with the id "c-mia". V is a viewer of Mia. W is an unrelated account. Memberships
// are made by the server (no invitations yet).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { API, PASSWORD, SERVICE, admin, newDevice, sleep, startServer, stepper, ui } from "./cloudkit.mjs";

const server = await startServer({ VITE_ROOTMAP_SHARED_SYNC: "on" });
const BASE = server.base;
let page;
const { step, finish } = stepper(() => page);

const SEP = "\u001f";
const sid = (familyId, id) => `${familyId}${SEP}${id}`;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const now = () => new Date().toISOString();
const rec = r => ({ createdAt: now(), updatedAt: now(), deletedAt: null, origin: "user", position: 100, ...r });
const child = (id, first) => rec({ id, first, last: "Test", dob: "2022-05-01", enrolled: "", lessons: 0, group: "Primary", photo: "" });
const entry = (id, childId, text, photos = []) => rec({ id, childId, date: "2026-10-20", title: "", text, photos });

const store = (p, body) => p.eval(`import("/src/lib/data/store.ts").then(async S => { ${body} })`);
const write = (p, collections) => store(p, `return S.write({ collections: ${JSON.stringify(collections)} }, { rollback: true });`);
const get = (p, collection, id) => store(p, `return S.getCollection(${JSON.stringify(collection)}).find(r => r.id === ${JSON.stringify(id)}) ?? null;`);
const edit = (p, collection, id, patch) => store(p, `const r = S.getCollection(${JSON.stringify(collection)}).find(r => r.id === ${JSON.stringify(id)});
  return S.write({ collections: { ${collection}: [{ ...r, ...${JSON.stringify(patch)}, updatedAt: new Date().toISOString() }] } }, { rollback: true });`);
const savePhoto = p => store(p, `const blob = await (await fetch("data:image/png;base64,${PNG}")).blob(); return S.savePhoto(blob, { width: 1, height: 1 });`);
const syncNow = p => p.eval(`window.dispatchEvent(new Event("online"))`);
const status = p => p.eval(`import("/src/lib/sync/runner.ts").then(R => R.syncStatus())`);
// Polls a condition over the device's store, nudging sync between tries (membership changes are seen on the next round).
async function until(p, cond, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const ok = await p.eval(`import("/src/lib/data/store.ts").then(S => { const all = c => S.getCollection(c); const shown = c => S.publishedCollection(c); const meta = S.syncMeta(); const out = S.pendingOutbox(); return !!(${cond}); })`);
    if (ok) return;
    await syncNow(p);
    await sleep(500);
  }
  throw new Error(`timed out: ${label}`);
}
async function backedUp(p, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if ((await status(p)).allBackedUp) return;
    await syncNow(p);
    await sleep(500);
  }
  throw new Error(`timed out: ${label}`);
}

// The server, as the server itself (service key): accounts, a family without a browser, memberships.
async function rest(method, path, body) {
  const r = await fetch(`${API}${path}`, { method, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: body && JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const newAccount = async label => {
  const email = `${label}-${randomUUID()}@example.com`;
  const user = await rest("POST", "/auth/v1/admin/users", { email, password: PASSWORD, email_confirm: true, user_metadata: { rootmap_password: true } });
  return { email, id: user.id };
};
const grant = (familyId, childId, user, role) => rest("POST", "/rest/v1/child_memberships", { family_id: familyId, child_id: childId, user_id: user.id, role });
const setRole = (familyId, childId, user, role) => rest("PATCH", `/rest/v1/child_memberships?family_id=eq.${familyId}&child_id=eq.${childId}&user_id=eq.${user.id}`, { role });
const revoke = (familyId, childId, user) => rest("DELETE", `/rest/v1/child_memberships?family_id=eq.${familyId}&child_id=eq.${childId}&user_id=eq.${user.id}`);
const serverRow = (table, familyId, id) => admin(`/rest/v1/${table}?family_id=eq.${familyId}&id=eq.${encodeURIComponent(id)}&select=*`).then(rows => rows[0] ?? null);
const serverIds = (table, familyId) => admin(`/rest/v1/${table}?family_id=eq.${familyId}&select=id&order=id`).then(rows => rows.map(r => r.id));

// A browser signed in as `account` (new device: Welcome, then email and password).
async function signedIn(name, port, account) {
  const p = await newDevice(name, port);
  const u = ui(p);
  page = p;
  await p.nav(`${BASE}/`);
  await u.welcomeShown();
  await u.signInWithPassword(account.email);
  await u.appReady();
  return { p, u, familyId: (await u.cloudState()).account.familyId };
}
const offline = (p, on) => p.send("Network.emulateNetworkConditions", { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
const accountDb = async (u, account) => u.dump(`rootmap-account-${account.id}`);

const O = await newAccount("share-o"), E = await newAccount("share-e"), V = await newAccount("share-v"), P = await newAccount("share-p"), W = await newAccount("share-w");
let dO, dE, dV, FO, FP, photoO, photoE;

try {
  // P's family exists only on the server (made as the server would).
  const [famP] = await rest("POST", "/rest/v1/families", { name: "", created_by: P.id });
  FP = famP.id;
  await rest("POST", "/rest/v1/family_members", { family_id: FP, user_id: P.id, role: "owner" });
  await rest("POST", "/rest/v1/children", { family_id: FP, id: "c-mia", first: "Pia", last: "P", dob: "2021-01-01" });

  dO = await signedIn("share-o", 9371, O);
  FO = dO.familyId;
  await step("Set-up: O's children Mia and Leo, a Moment about each, one photo shown by both", async () => {
    photoO = (await savePhoto(dO.p)).ref;
    assert.equal(await write(dO.p, { children: [child("c-mia", "Mia"), child("c-leo", "Leo")] }), null);
    assert.equal(await write(dO.p, { entries: [entry("m-1", "c-mia", "Mia painted", [photoO]), entry("m-2", "c-leo", "Leo painted", [photoO])] }), null);
    await backedUp(dO.p, "O backed up (records and photo)");
    assert.ok((await serverRow("photos", FO, photoO)).verified_at);
  });

  dE = await signedIn("share-e", 9372, E);
  dV = await signedIn("share-v", 9373, V);
  await step("Set-up: E has a child of their own called c-mia", async () => {
    page = dE.p;
    assert.equal(await write(dE.p, { children: [child("c-mia", "Emi")] }), null);
    await backedUp(dE.p, "E backed up");
    await grant(FO, "c-mia", E, "editor");
    await grant(FO, "c-leo", E, "viewer");
    await grant(FP, "c-mia", E, "viewer");
    await grant(FO, "c-mia", V, "viewer");
  });

  await step("1. Two users share one child: Mia and her Moment reach E, with O's photo, and show in My Children", async () => {
    page = dE.p;
    await until(dE.p, `all("children").some(c => c.id === ${JSON.stringify(sid(FO, "c-mia"))} && c.first === "Mia") && all("entries").some(e => e.id === ${JSON.stringify(sid(FO, "m-1"))})`, "Mia arrived");
    const m1 = await get(dE.p, "entries", sid(FO, "m-1"));
    assert.equal(m1.childId, sid(FO, "c-mia"));
    assert.equal(m1.familyId, FO);
    await dE.p.waitFor(`import("/src/lib/data/store.ts").then(S => S.photoMeta(${JSON.stringify(photoO)})?.familyId === ${JSON.stringify(FO)} && S.hasPhotoBytes(${JSON.stringify(photoO)}))`, 30000, "O's photo downloaded from O's family");
    await dE.p.eval(`[...document.querySelectorAll(".bottom-nav button")][3].click()`);
    await dE.p.waitFor(`document.body.innerText.includes("Mia") && document.body.innerText.includes("Emi")`, 5000, "both shown");
  });

  await step("2. Identical child ids in three families stay three children; nothing of another family is uploaded anywhere", async () => {
    page = dE.p;
    await until(dE.p, `all("children").some(c => c.id === ${JSON.stringify(sid(FP, "c-mia"))})`, "P's c-mia arrived");
    assert.equal((await get(dE.p, "children", "c-mia")).first, "Emi");
    assert.equal((await get(dE.p, "children", sid(FO, "c-mia"))).first, "Mia");
    assert.equal((await get(dE.p, "children", sid(FP, "c-mia"))).first, "Pia");
    await backedUp(dE.p, "nothing waiting");
    assert.deepEqual(await serverIds("children", dE.familyId), ["c-mia"], "E's own family has only E's own child");
    assert.equal((await serverRow("children", dE.familyId, "c-mia")).first, "Emi");
    assert.deepEqual(await serverIds("children", FO), ["c-leo", "c-mia"]);
    assert.equal((await serverRow("children", FP, "c-mia")).first, "Pia");
  });

  await step("3. Owner and editor edit the same Moment in turn; each sees the other's change", async () => {
    page = dE.p;
    assert.equal(await edit(dE.p, "entries", sid(FO, "m-1"), { text: "Mia painted (E)" }), null);
    await backedUp(dE.p, "E's edit sent");
    assert.equal((await serverRow("entries", FO, "m-1")).text, "Mia painted (E)");
    page = dO.p;
    await until(dO.p, `all("entries").find(e => e.id === "m-1")?.text === "Mia painted (E)"`, "O sees E's edit");
    assert.equal(await edit(dO.p, "entries", "m-1", { text: "Mia painted (O)" }), null);
    await backedUp(dO.p, "O's edit sent");
    page = dE.p;
    await until(dE.p, `all("entries").find(e => e.id === ${JSON.stringify(sid(FO, "m-1"))})?.text === "Mia painted (O)"`, "E sees O's edit");
  });

  await step("4. Viewer: reads Mia; a change is refused once and never sent again; a new photo isn't accepted; promoted to editor, the change goes", async () => {
    page = dV.p;
    await until(dV.p, `all("entries").some(e => e.id === ${JSON.stringify(sid(FO, "m-1"))} && e.text === "Mia painted (O)")`, "V reads Mia's Moment");
    assert.equal(await edit(dV.p, "entries", sid(FO, "m-1"), { text: "V tried" }), null);
    await until(dV.p, `out.some(e => e.id === ${JSON.stringify(sid(FO, "m-1"))} && e.rejected)`, "refused and marked");
    const patches = () => dV.p.requests.filter(r => r === "PATCH /rest/v1/entries").length;
    const before = patches();
    for (let i = 0; i < 3; i++) { await syncNow(dV.p); await sleep(700); }
    assert.equal(patches(), before, "a refused change is not sent again");
    assert.equal((await status(dV.p)).allBackedUp, false, "not reported as backed up");
    assert.equal((await serverRow("entries", FO, "m-1")).text, "Mia painted (O)");
    // A photo for Mia from a viewer: refused too.
    const ph = (await savePhoto(dV.p)).ref;
    assert.equal(await write(dV.p, { entries: [entry("m-v", sid(FO, "c-mia"), "V's photo", [ph])] }), null);
    await until(dV.p, `out.some(e => e.key === ${JSON.stringify(`photos:${ph}`)} && e.rejected)`, "viewer's photo refused");
    assert.equal(await serverRow("photos", FO, ph), null);
    // Promoted: the refused change is sent on the next round.
    await setRole(FO, "c-mia", V, "editor");
    await until(dV.p, `!out.some(e => e.id === ${JSON.stringify(sid(FO, "m-1"))})`, "sent after promotion");
    assert.equal((await serverRow("entries", FO, "m-1")).text, "V tried");
    await setRole(FO, "c-mia", V, "viewer");
  });

  await step("5. Offline edits are kept and sent once back online (a network failure is retried, never treated as refusal)", async () => {
    page = dE.p;
    // E has seen V's change first (otherwise both changed the text, and the server's stays: a conflict, kept as a version).
    await until(dE.p, `all("entries").find(e => e.id === ${JSON.stringify(sid(FO, "m-1"))})?.text === "V tried"`, "E has V's change");
    await offline(dE.p, true);
    assert.equal(await edit(dE.p, "entries", sid(FO, "m-1"), { text: "written offline (E)" }), null);
    await syncNow(dE.p);
    await dE.p.waitFor(`import("/src/lib/sync/runner.ts").then(R => R.syncStatus().phase === "offline")`, 15000, "offline status");
    assert.ok(!(await store(dE.p, `return S.pendingOutbox().find(e => e.id === ${JSON.stringify(sid(FO, "m-1"))})?.rejected ?? null;`)), "not marked refused");
    await offline(dE.p, false);
    await backedUp(dE.p, "sent after reconnecting");
    assert.equal((await serverRow("entries", FO, "m-1")).text, "written offline (E)");
  });

  await step("10. Shared photo upload: E adds a photo to a Moment about Mia; it goes to Mia's family, for Mia, verified, and reaches O", async () => {
    page = dE.p;
    photoE = (await savePhoto(dE.p)).ref;
    assert.equal(await write(dE.p, { entries: [entry("m-e", sid(FO, "c-mia"), "E's photo of Mia", [photoE])] }), null);
    await backedUp(dE.p, "photo and Moment backed up");
    const row = await serverRow("photos", FO, photoE);
    assert.equal(row.child_id, "c-mia");
    assert.ok(row.verified_at);
    assert.ok(row.storage_path.startsWith(`${FO}/`));
    assert.equal(await serverRow("photos", dE.familyId, photoE), null, "not in E's own family");
    assert.deepEqual((await serverRow("entries", FO, "m-e")).photo_ids, [photoE]);
    page = dO.p;
    await until(dO.p, `all("entries").some(e => e.id === "m-e")`, "O receives the Moment");
    await dO.p.waitFor(`import("/src/lib/data/store.ts").then(S => S.hasPhotoBytes(${JSON.stringify(photoE)}))`, 30000, "O downloads E's photo");
  });

  await step("11. Shared photo download: O's photo is on E's device and V's, stored with its family", async () => {
    for (const d of [dE, dV]) {
      page = d.p;
      await d.p.waitFor(`import("/src/lib/data/store.ts").then(S => S.hasPhotoBytes(${JSON.stringify(photoO)}) && S.photoMeta(${JSON.stringify(photoO)}).familyId === ${JSON.stringify(FO)})`, 30000, "downloaded");
    }
  });

  await step("12. Unauthorized photo access: V can't add a photo (step 4); V can't read Leo's family photo it isn't shared on; nothing reaches E's own family", async () => {
    page = dV.p;
    // Leo isn't shared with V: O's photo of Leo would only be visible through Mia (it is shown by both); a photo only
    // Leo shows is not.
    const leoOnly = (await savePhoto(dO.p)).ref;
    assert.equal(await write(dO.p, { entries: [entry("m-leo2", "c-leo", "Leo only", [leoOnly])] }), null);
    await backedUp(dO.p, "O backed up Leo's photo");
    const path = (await serverRow("photos", FO, leoOnly)).storage_path;
    const res = await dV.p.eval(`import("/src/lib/cloud/client.ts").then(m => m.getCloudClient()).then(c => c.storage.from("family-photos").download(${JSON.stringify(path)})).then(r => ({ error: !!r.error }))`);
    assert.equal(res.error, true, "V downloaded a photo of a child not shared with V");
    const signed = await dV.p.eval(`import("/src/lib/cloud/client.ts").then(m => m.getCloudClient()).then(c => c.storage.from("family-photos").createSignedUrl(${JSON.stringify(path)}, 60)).then(r => ({ error: !!r.error }))`);
    assert.equal(signed.error, true, "V got a signed URL for it");
    await syncNow(dV.p); await sleep(1500);
    assert.equal(await store(dV.p, `return S.photoMeta(${JSON.stringify(leoOnly)}) ?? null;`), null, "its details never reach V");
  }, /status of 400/);

  await step("13. A backup leaves out every shared child, record, photo and draft", async () => {
    page = dE.p;
    const data = await store(dE.p, `return S.backupData();`);
    const text = JSON.stringify(data);
    assert.ok(text.includes("Emi"), "E's own child is in it");
    for (const s of ["Mia", "Pia", "Leo", FO, FP, SEP, photoO, photoE]) assert.ok(!text.includes(s), `backup contains ${JSON.stringify(s)}`);
  });

  await step("14. Restoring while signed in only adds: shared data and the account's newer records are untouched; nothing is deleted on the server", async () => {
    page = dE.p;
    const backup = await store(dE.p, `return S.backupData();`);
    assert.equal(await write(dE.p, { entries: [entry("m-own-new", "c-mia", "after the backup")] }), null);
    await backedUp(dE.p, "new own Moment sent");
    backup["rootmap-journal"].push(entry("m-from-file", "c-mia", "only in the file"));
    backup["rootmap-children"][0] = { ...backup["rootmap-children"][0], first: "Old name from the file" };
    const sharedBefore = await store(dE.p, `return JSON.stringify(["children","entries"].flatMap(c => S.getCollection(c).filter(r => r.familyId)));`);
    assert.equal(await store(dE.p, `return S.restoreData(${JSON.stringify(backup)});`), true);
    await dE.p.reload(); await dE.u.appReady();
    await backedUp(dE.p, "restore result backed up");
    assert.equal((await get(dE.p, "entries", "m-own-new")).deletedAt, null, "a record missing from the file is not deleted");
    assert.equal((await serverRow("entries", dE.familyId, "m-own-new")).deleted_at, null);
    assert.equal((await get(dE.p, "children", "c-mia")).first, "Emi", "an existing record is not reverted");
    assert.ok(await get(dE.p, "entries", "m-from-file"), "what the account lacked is added");
    assert.ok(await serverRow("entries", dE.familyId, "m-from-file"));
    assert.equal(await store(dE.p, `return JSON.stringify(["children","entries"].flatMap(c => S.getCollection(c).filter(r => r.familyId)));`), sharedBefore, "shared records untouched");
  });

  await step("15. Guest import: guest data is never matched with or copied onto a shared child", async () => {
    // A second device of E, used as a guest first: a child with Mia's name and birthday.
    const g = await newDevice("share-guest", 9374);
    const gu = ui(g);
    page = g;
    await g.nav(`${BASE}/`);
    await gu.welcomeShown();
    await gu.click("Continue as Guest");
    await gu.appReady();
    assert.equal(await store(g, `return S.write(${JSON.stringify({ collections: { children: [child("c-guest-share", "Mia")], entries: [entry("m-guest-share", "c-guest-share", "guest Moment")] } })}, { rollback: true });`), null);
    await gu.openProfile();
    await gu.click("Sign in or create an account");
    await gu.welcomeShown();
    await gu.signInWithPassword(E.email);
    await until(g, `all("children").some(c => c.id === ${JSON.stringify(sid(FO, "c-mia"))})`, "shared Mia on the new device");
    await g.waitFor(`document.querySelector(".guest-import [data-testid=import-summary]")`, 15000, "asked about the guest data");
    assert.ok(!(await g.eval(`!!document.querySelector("[data-testid=import-duplicate]")`)), "not asked whether the guest child is the shared Mia");
    await gu.click("Add to my account");
    await g.waitFor(`import("/src/lib/data/store.ts").then(S => S.guestImportState()?.status === "complete")`, 60000, "import complete");
    assert.ok(await serverRow("children", dE.familyId, "c-guest-share"), "the guest child joins E's own family");
    assert.equal(await serverRow("children", FO, "c-guest-share"), null);
    assert.equal(await serverRow("entries", FO, "m-guest-share"), null);
    assert.equal((await serverRow("children", FO, "c-mia")).first, "Mia");
    await g.close();
  });

  await step("6. Removed while offline: the refused offline change is archived with the removal; Leo, P's child and E's own stay", async () => {
    page = dE.p;
    await until(dE.p, `!out.length`, "nothing waiting");
    await offline(dE.p, true);
    assert.equal(await edit(dE.p, "entries", sid(FO, "m-1"), { text: "written on the train" }), null);
    await revoke(FO, "c-mia", E);
    await offline(dE.p, false);
    await until(dE.p, `!all("children").some(c => c.id === ${JSON.stringify(sid(FO, "c-mia"))}) && meta.scopes?.revoked?.[${JSON.stringify(sid(FO, "c-mia"))}]?.state === "done"`, "Mia removed after confirmation");
    const db = await accountDb(dE.u, E);
    const archived = db.archive.filter(a => a.source === `access-revoked:${FO}/c-mia`);
    assert.ok(archived.some(a => a.value.record?.text === "written on the train"), "the unsent change is archived");
    assert.ok(!db.entries.some(e => e.childId === sid(FO, "c-mia")), "no Moment of Mia left");
    assert.ok(!db.outbox.some(e => e.id.startsWith(`${FO}${SEP}`) && e.collection !== "photos" && e.id.includes("m-1")), "nothing of Mia left to send");
    assert.ok(db.children.some(c => c.id === sid(FO, "c-leo")), "Leo stays");
    assert.ok(db.children.some(c => c.id === sid(FP, "c-mia")), "P's child stays");
    assert.ok(db.children.some(c => c.id === "c-mia" && c.first === "Emi"), "E's own child stays");
    assert.ok(db.photoBlobs.some(b => b.id === photoO), "O's photo stays: Leo's Moment still shows it");
    assert.ok(!db.photoBlobs.some(b => b.id === photoE), "E's photo of Mia goes with Mia");
    assert.notEqual((await serverRow("entries", FO, "m-1")).text, "written on the train", "the refused change never reached O's family");
    // Archived changes are not shown and not sent.
    assert.ok(!(await dE.u.text()).includes("written on the train"));
  });

  await step("7. Removed while away, then reconnecting: P's child is removed after two answers; nothing archived", async () => {
    page = dE.p;
    await offline(dE.p, true);
    await revoke(FP, "c-mia", E);
    await sleep(500);
    await offline(dE.p, false);
    await until(dE.p, `!all("children").some(c => c.id === ${JSON.stringify(sid(FP, "c-mia"))})`, "P's child removed");
    const db = await accountDb(dE.u, E);
    assert.equal(db.archive.filter(a => a.source === `access-revoked:${FP}/c-mia`).length, 0);
    assert.equal(db.meta.find(m => m.key === "space").scopeCursors[FP], undefined, "P's family's cursors dropped");
  });

  await step("8. A reload while a removal is pending: Leo is never shown again, and is removed once the device carries on", async () => {
    page = dE.p;
    const hold = await dE.p.send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__rootmapHoldCleanup = true;" });
    await dE.p.eval(`window.__rootmapHoldCleanup = true`);
    await revoke(FO, "c-leo", E);
    await until(dE.p, `meta.scopes?.revoked?.[${JSON.stringify(sid(FO, "c-leo"))}]?.state === "pending"`, "removal decided, not done");
    const leo = JSON.stringify(sid(FO, "c-leo"));
    assert.equal(await store(dE.p, `return S.publishedCollection("children").some(c => c.id === ${leo});`), false, "hidden at once");
    assert.ok((await accountDb(dE.u, E)).children.some(c => c.id === sid(FO, "c-leo")), "still on disk");
    await dE.p.reload(); await dE.u.appReady();
    assert.equal(await store(dE.p, `return S.publishedCollection("children").some(c => c.id === ${leo});`), false, "hidden after a reload");
    assert.equal(await store(dE.p, `return S.publishedCollection("entries").some(e => e.childId === ${leo});`), false, "its Moments hidden too");
    await dE.p.eval(`[...document.querySelectorAll(".bottom-nav button")][3].click()`);
    await sleep(300);
    assert.ok(!(await dE.u.text()).includes("Leo"), "not on My Children");
    await dE.p.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: hold.identifier });
    await dE.p.reload(); await dE.u.appReady();
    await until(dE.p, `!all("children").some(c => c.id === ${leo}) && meta.scopes?.revoked?.[${leo}]?.state === "done"`, "removal done");
    const db = await accountDb(dE.u, E);
    assert.ok(!db.children.some(c => c.id === sid(FO, "c-leo")) && !db.entries.some(e => e.childId === sid(FO, "c-leo")));
    assert.ok(!db.photos.some(p => p.id === photoO) && !db.photoBlobs.some(b => b.id === photoO), "the photo goes with the last child showing it");
    assert.ok(db.children.some(c => c.id === "c-mia"), "E's own child stays");
  }, /cleanup held/);

  await step("9. Account switching: another account on the same browser sees no shared data and no archive; E's data is still there afterwards", async () => {
    page = dE.p;
    await dE.u.signOut();
    await dE.u.openProfile();
    await dE.u.click("Sign in or create an account");
    await dE.u.welcomeShown();
    await dE.u.signInWithPassword(W.email);
    const w = await dE.u.cloudState();
    assert.equal(w.user.userId, W.id);
    await backedUp(dE.p, "W synced");
    const wDb = await accountDb(dE.u, W);
    assert.ok(!JSON.stringify(wDb.children).includes(SEP) && wDb.children.length === 0);
    assert.equal(wDb.archive.length, 0, "E's archive never reaches W");
    // An outsider can't read O's photo files either.
    const path = (await serverRow("photos", FO, photoO)).storage_path;
    const res = await dE.p.eval(`import("/src/lib/cloud/client.ts").then(m => m.getCloudClient()).then(c => c.storage.from("family-photos").download(${JSON.stringify(path)})).then(r => ({ error: !!r.error }))`);
    assert.equal(res.error, true);
    await dE.u.signOut();
    await dE.u.openProfile();
    await dE.u.click("Sign in or create an account");
    await dE.u.welcomeShown();
    await dE.u.signInWithPassword(E.email);
    assert.equal((await get(dE.p, "children", "c-mia")).first, "Emi");
    assert.ok((await accountDb(dE.u, E)).archive.some(a => a.source === `access-revoked:${FO}/c-mia`), "E's archive is still in E's space");
  }, /status of 400/);
} catch (e) {
  console.log(`FAIL  (set-up) ${e.message}`);
  process.exitCode = 1;
} finally {
  for (const d of [dO, dE, dV]) await d?.p.close().catch(() => {});
  server.stop();
}
process.exit(finish() || process.exitCode || 0);
