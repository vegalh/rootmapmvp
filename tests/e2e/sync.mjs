// Record sync in the real app (Phase 2B-2 M4), with cloud features ON, against the local Supabase stack. Run with
// `npm run test:e2e:cloud`.
//
// Two browser profiles signed in to the same account sync children and memories both ways, including after being
// offline; photos are uploaded privately, verified by the server, then downloaded and shown on the other device;
// backup status never says "All backed up" while anything (or a photo) is waiting; the guest space (with its photo)
// is never uploaded or changed; another account receives nothing.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { API, SERVICE, admin, newDevice, sleep, startServer, stepper, ui } from "./cloudkit.mjs";

const server = await startServer();
const BASE = server.base;
let page;
const { step, finish } = stepper(() => page);

const existingDevice = `if (location.origin === ${JSON.stringify(BASE)} && !localStorage.getItem("rootmap-data-store")) localStorage.setItem("rootmap-seed-version", "2");`;
const store = (p, body) => p.eval(`import("/src/lib/data/store.ts").then(async S => { ${body} })`);
const status = p => p.eval(`import("/src/lib/sync/runner.ts").then(R => R.syncStatus())`);
const waitStatus = (p, cond, label) => p.waitFor(`import("/src/lib/sync/runner.ts").then(R => { const s = R.syncStatus(); return ${cond}; })`, 30000, label);
const syncNow = p => p.eval(`window.dispatchEvent(new Event("online"))`);
const child = (id, first) => ({ id, first, last: "Test", dob: "2022-05-01", enrolled: "", lessons: 0, group: "Primary", photo: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deletedAt: null, origin: "user", position: 100 });
const addChild = (p, id, first) => store(p, `return S.write({ collections: { children: [${JSON.stringify(child(id, first))}] } }, { rollback: true });`);
const localChild = (p, id) => store(p, `return S.getCollection("children").find(c => c.id === ${JSON.stringify(id)}) ?? null;`);
const serverChildren = familyId => admin(`/rest/v1/children?family_id=eq.${familyId}&select=id,first,rev&order=id`);
const signInFromProfile = async (u, email, entry) => {
  await u.openProfile();
  await u.click("Sign in or create an account");
  await u.welcomeShown();
  await u.signIn(email, entry);
};

const emailA = `sync-a-${randomUUID()}@example.com`;
const emailB = `sync-b-${randomUUID()}@example.com`;
let one, two, u1, u2, familyA, guestBefore, idA, guestPhoto;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const savePhoto = p => store(p, `const blob = await (await fetch("data:image/png;base64,${PNG}")).blob(); return S.savePhoto(blob, { width: 1, height: 1 });`);
const objects = familyId => fetch(`${API}/storage/v1/object/list/family-photos`, { method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ prefix: familyId }) }).then(r => r.json());

try {
  // Device 1: RootMap already in use as a guest.
  one = page = await newDevice("sync-one", 9351, existingDevice);
  u1 = ui(one);
  await one.nav(`${BASE}/`);
  await u1.appReady();
  await u1.waitCloud("signed-out");

  await step("Device 1 signs in as A; the guest space's records and photo are not uploaded", async () => {
    assert.equal(await addChild(one, "c-guest", "Gina"), null);
    guestPhoto = (await savePhoto(one)).ref;
    assert.match(guestPhoto, /^photo-/);
    await sleep(300);
    guestBefore = JSON.stringify(await u1.dump("rootmap"));
    await signInFromProfile(u1, emailA, "Create an account");
    const state = await u1.cloudState();
    idA = state.user.userId;
    familyA = state.account.familyId;
    await waitStatus(one, `s.lastSyncedAt && s.phase === "idle"`, "first sync done");
    assert.deepEqual(await serverChildren(familyA), []);
    assert.equal(JSON.stringify(await u1.dump("rootmap")), guestBefore);
  });

  await step("A child added on device 1 is backed up; the Account page says so only once it is", async () => {
    assert.equal(await addChild(one, "c-ada", "Ada"), null);
    assert.equal((await status(one)).allBackedUp, false, "not yet");
    await waitStatus(one, `s.allBackedUp`, "backed up");
    assert.deepEqual((await serverChildren(familyA)).map(c => c.id), ["c-ada"]);
    await u1.openProfile();
    await u1.click("RootMap Account");
    await one.waitFor(`document.querySelector(".sync-summary")?.innerText.includes("All backed up")`, 5000, "status shown");
  });

  // Device 2: a second browser, same account.
  two = page = await newDevice("sync-two", 9352, existingDevice);
  u2 = ui(two);
  await two.nav(`${BASE}/`);
  await u2.appReady();
  await u2.waitCloud("signed-out");

  await step("Device 2 signs in as A and receives device 1's child; nothing is queued for upload because of it", async () => {
    await sleep(1100);
    await signInFromProfile(u2, emailA);
    await two.waitFor(`import("/src/lib/data/store.ts").then(S => S.getCollection("children").some(c => c.id === "c-ada"))`, 30000, "child arrived");
    await waitStatus(two, `s.allBackedUp`, "device 2 backed up");
    assert.deepEqual(await store(two, `return S.pendingOutbox();`), []);
    await two.eval(`[...document.querySelectorAll(".bottom-nav button")][3].click()`);
    await two.waitFor(`document.body.innerText.includes("Ada")`, 5000, "shown on My Children");
  });

  await step("An edit on device 2 reaches device 1", async () => {
    await store(two, `const c = S.getCollection("children").find(c => c.id === "c-ada"); return S.write({ collections: { children: [{ ...c, first: "Adaline", updatedAt: new Date().toISOString() }] } }, { rollback: true });`);
    await waitStatus(two, `s.allBackedUp`, "device 2 sent it");
    page = one;
    await syncNow(one);
    await one.waitFor(`import("/src/lib/data/store.ts").then(S => S.getCollection("children").find(c => c.id === "c-ada")?.first === "Adaline")`, 30000, "arrived on device 1");
    const rows = await serverChildren(familyA);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rev, 2);
  });

  await step("Offline on device 1: changes are kept and the status says offline; back online they are sent and reach device 2", async () => {
    page = one;
    await one.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      assert.equal(await addChild(one, "c-off", "Otto"), null);
      await waitStatus(one, `s.phase === "offline" && s.pending === 1`, "offline, one waiting");
      assert.equal((await status(one)).allBackedUp, false);
      await one.waitFor(`document.querySelector(".sync-summary")?.innerText.includes("Offline")`, 5000, "offline shown");
      // Signing out now would leave the change on this device only: the dialog says so before anything happens.
      await u1.click("Sign out");
      await one.waitFor(`document.querySelector("[data-testid=signout-pending]")?.innerText.includes("Not backed up yet: 1.")`, 5000, "sign-out warning");
      await u1.click("Cancel");
      await one.waitFor(`!document.querySelector("[data-testid=signout-pending]")`, 5000, "dialog closed");
      assert.equal((await u1.cloudState()).status, "signed-in");
    } finally {
      await one.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    await syncNow(one);
    await waitStatus(one, `s.allBackedUp`, "sent after reconnect");
    page = two;
    await syncNow(two);
    await two.waitFor(`import("/src/lib/data/store.ts").then(S => S.getCollection("children").some(c => c.id === "c-off"))`, 30000, "arrived on device 2");
  }, /ERR_INTERNET_DISCONNECTED|Failed to fetch|net::ERR/);

  await step("Both devices change the same child at once: nothing is overwritten silently (merged, the other version kept)", async () => {
    page = one;
    await store(one, `const c = S.getCollection("children").find(c => c.id === "c-off"); return S.write({ collections: { children: [{ ...c, notes: "From device 1", updatedAt: new Date().toISOString() }] } }, { rollback: true });`);
    await store(two, `const c = S.getCollection("children").find(c => c.id === "c-off"); return S.write({ collections: { children: [{ ...c, notes: "From device 2", group: "Toddler", updatedAt: new Date().toISOString() }] } }, { rollback: true });`);
    await waitStatus(one, `s.allBackedUp`, "device 1 settled");
    await waitStatus(two, `s.allBackedUp`, "device 2 settled");
    await syncNow(one); await syncNow(two);
    await sleep(3000);
    await syncNow(one); await syncNow(two);
    await one.waitFor(`import("/src/lib/data/store.ts").then(S => S.getCollection("children").find(c => c.id === "c-off")?.group === "Toddler")`, 30000, "merged on device 1");
    const a = await localChild(one, "c-off"), b = await localChild(two, "c-off");
    assert.equal(a.notes, b.notes, "both devices agree");
    assert.equal(a.group, "Toddler");
    const versions = await admin(`/rest/v1/record_versions?family_id=eq.${familyA}&select=record_id,reason,version`);
    assert.equal(versions.length, 1);
    assert.equal(versions[0].reason, "text_conflict");
    assert.notEqual(versions[0].version.notes, a.notes, "the losing notes are kept");
  });

  await step("A photo added offline is kept; back online it is uploaded privately and verified, and only then 'All backed up'", async () => {
    page = one;
    await one.send("Network.setBlockedURLs", { urls: [`${API}/*`] });
    let photo;
    try {
      photo = (await savePhoto(one)).ref;
      const now = new Date().toISOString();
      await store(one, `return S.write({ collections: { entries: [{ id: "m-photo", childId: "c-ada", date: "2026-10-12", title: "Painting", text: "", photos: [${JSON.stringify(photo)}], createdAt: "${now}", updatedAt: "${now}", deletedAt: null, origin: "user", position: 0 }] } }, { rollback: true });`);
      await syncNow(one);
      await waitStatus(one, `s.phase === "offline" && s.photosWaiting === 1`, "offline, photo waiting");
      assert.equal((await status(one)).allBackedUp, false);
    } finally {
      await one.send("Network.setBlockedURLs", { urls: [] });
    }
    await syncNow(one);
    await waitStatus(one, `s.allBackedUp`, "photo verified");
    const row = (await admin(`/rest/v1/photos?family_id=eq.${familyA}&id=eq.${photo}&select=sha256,server_sha256,verified_at`))[0];
    assert.ok(row.verified_at);
    assert.equal(row.server_sha256, row.sha256);
    assert.deepEqual((await objects(familyA)).map(o => o.name), [`${photo}.png`]);
    await u1.openProfile();
    await u1.click("RootMap Account");
    await one.waitFor(`document.querySelector(".sync-summary")?.innerText.includes("All backed up")`, 5000, "status shown");
    page = two;
    await syncNow(two);
    await two.waitFor(`import("/src/lib/data/store.ts").then(S => S.hasPhotoBytes(${JSON.stringify(photo)}))`, 30000, "downloaded on device 2");
    // Shown on device 2's Moments, from its own verified copy.
    // Moments is no longer a tab; cancelling Quick Add → Add Moment returns to the Moments timeline.
    await two.eval(`document.querySelector(".nav-add").click()`);
    await two.waitFor(`document.querySelector(".quick-actions")`);
    await two.eval(`[...document.querySelectorAll(".quick-actions button")][1].click()`);
    await two.waitFor(`document.querySelector(".journal-editor-bar")`, 5000, "editor");
    await two.eval(`document.querySelector(".journal-editor-bar button").click()`);
    await two.waitFor(`[...document.querySelectorAll("img")].some(i => i.src.startsWith("blob:") && i.complete && i.naturalWidth > 0)`, 10000, "photo displayed");
  }, /ERR_BLOCKED_BY_CLIENT|Failed to fetch/);
  await two.close();
  two = undefined;

  await step("A photo given up on after repeated rejected uploads: the Account page shows the problem and Try Again; tapping it backs the photo up", async () => {
    page = one;
    await one.send("Network.setBlockedURLs", { urls: [`${API}/*`] });
    let photo;
    try {
      photo = (await savePhoto(one)).ref;
      const now = new Date().toISOString();
      await store(one, `return S.write({ collections: { entries: [{ id: "m-retry", childId: "c-ada", date: "2026-10-12", title: "Clay", text: "", photos: [${JSON.stringify(photo)}], createdAt: "${now}", updatedAt: "${now}", deletedAt: null, origin: "user", position: 0 }] } }, { rollback: true });`);
      // As left by three uploads the server rejected (lib/sync/photos.ts MAX_MISMATCHES).
      assert.equal(await store(one, `return S.commitSync({ records: [{ collection: "photos", record: { ...S.photoMeta(${JSON.stringify(photo)}), mismatches: 3 } }] });`), "ok");
    } finally {
      await one.send("Network.setBlockedURLs", { urls: [] });
    }
    await syncNow(one);
    await waitStatus(one, `s.photosFailed === 1 && s.phase === "idle"`, "photo reported as failed");
    assert.ok(!(await objects(familyA)).some(o => o.name.startsWith(photo)), "not uploaded while given up");
    await u1.openProfile();
    await u1.click("RootMap Account");
    await one.waitFor(`document.querySelector("[data-testid=retry-photos]")?.innerText === "Try Again"`, 5000, "Try Again shown");
    assert.ok(await u1.has("1 photos had a problem uploading"));
    await syncNow(one);
    await sleep(1500);
    assert.equal((await status(one)).photosFailed, 1, "an ordinary round still leaves it alone");
    await one.eval(`document.querySelector("[data-testid=retry-photos]").click()`);
    await waitStatus(one, `s.allBackedUp`, "backed up after Try Again");
    const row = (await admin(`/rest/v1/photos?family_id=eq.${familyA}&id=eq.${photo}&select=sha256,server_sha256,verified_at`))[0];
    assert.ok(row.verified_at);
    assert.equal(row.server_sha256, row.sha256);
    assert.ok((await objects(familyA)).some(o => o.name === `${photo}.png`));
    await one.waitFor(`!document.querySelector("[data-testid=retry-photos]") && document.querySelector(".sync-summary")?.innerText.includes("All backed up")`, 5000, "button gone, All backed up");
  }, /ERR_BLOCKED_BY_CLIENT|Failed to fetch/);

  await step("Signing out returns to the guest space unchanged; signing in as B shows and sends nothing of A's or the guest's", async () => {
    page = one;
    await u1.signOut();
    assert.equal(JSON.stringify(await u1.dump("rootmap")), guestBefore);
    await sleep(1100);
    await signInFromProfile(u1, emailB, "Create an account");
    const familyB = (await u1.cloudState()).account.familyId;
    await waitStatus(one, `s.lastSyncedAt && s.phase === "idle"`, "B synced");
    assert.deepEqual(await store(one, `return S.getCollection("children").map(c => c.id);`), []);
    assert.deepEqual(await serverChildren(familyB), []);
    assert.equal(await addChild(one, "c-bea", "Bea"), null);
    await waitStatus(one, `s.allBackedUp`, "B backed up");
    assert.deepEqual((await serverChildren(familyB)).map(c => c.id), ["c-bea"]);
    assert.deepEqual((await serverChildren(familyA)).map(c => c.id).sort(), ["c-ada", "c-off"], "A's family untouched");
    assert.equal(JSON.stringify(await u1.dump("rootmap")), guestBefore);
    assert.ok(!(await admin(`/rest/v1/children?id=eq.c-guest&select=id`)).length, "guest child never uploaded");
    assert.ok(!(await admin(`/rest/v1/photos?id=eq.${guestPhoto}&select=id`)).length, "guest photo's details never uploaded");
    for (const f of [familyA, familyB]) assert.ok(!(await objects(f)).some(o => o.name.startsWith(guestPhoto)), "guest photo file never uploaded");
    const guest = JSON.parse(guestBefore);
    assert.ok(guest.photoBlobs.some(b => b.id === guestPhoto), "the guest photo is still on the device");
  });

  await step("Back to A: A's space and backup state are as left; nothing of B's", async () => {
    await u1.signOut();
    await sleep(1100);
    await signInFromProfile(u1, emailA);
    assert.deepEqual((await u1.space()), { kind: "account", userId: idA });
    await waitStatus(one, `s.lastSyncedAt && s.phase === "idle" && s.pending === 0`, "A synced");
    const ids = await store(one, `return S.getCollection("children").filter(c => !c.deletedAt).map(c => c.id).sort();`);
    assert.deepEqual(ids, ["c-ada", "c-off"]);
  });
} finally {
  for (const p of [one, two]) await p?.close().catch(() => undefined);
  server.stop();
}
process.exit(finish());
