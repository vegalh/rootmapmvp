// Bringing guest data into an account (Phase 2B-2 M6) in the real app, with cloud features ON, against the local
// Supabase stack. Run with `npm run test:e2e:cloud`.
//
// A device used without an account (the demo content plus the parent's own child, memory with a photo, plan and
// goal) signs in: one question appears; "Add to my account" copies the parent's own records and photo into the
// account and they are uploaded, verified and completed on the server, while the demo content and the guest
// database stay exactly as they were. A second account on the same device is asked separately ("Not now" sends
// nothing). Offline, the question waits; an upload interrupted by a reload resumes and completes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { API, SERVICE, admin, newDevice, sleep, startServer, stepper, ui } from "./cloudkit.mjs";

const server = await startServer();
const BASE = server.base;
let page, u;
const { step, finish } = stepper(() => page);

const store = body => page.eval(`import("/src/lib/data/store.ts").then(async S => { ${body} })`);
const waitStatus = (cond, label, ms = 30000) => page.waitFor(`import("/src/lib/sync/runner.ts").then(R => { const s = R.syncStatus(); return ${cond}; })`, ms, label);
const importState = () => store(`return S.guestImportState();`);
const waitImport = (status, label, ms = 40000) => page.waitFor(`import("/src/lib/data/store.ts").then(S => S.guestImportState()?.status === ${JSON.stringify(status)})`, ms, label);
const now = "2026-10-12T00:00:00.000Z";
const rec = more => ({ createdAt: now, updatedAt: now, deletedAt: null, origin: "user", position: 100, ...more });
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const objects = familyId => fetch(`${API}/storage/v1/object/list/family-photos`, { method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ prefix: familyId }) }).then(r => r.json());
const serverIds = async (table, familyId) => (await admin(`/rest/v1/${table}?family_id=eq.${familyId}&select=id&order=id`)).map(r => r.id);
const guestDump = async () => JSON.stringify(await u.dump("rootmap"));
const signInFromProfile = async (email, entry) => {
  await u.openProfile();
  await u.click("Sign in or create an account");
  await u.welcomeShown();
  await u.signIn(email, entry);
};
const BLOCKED = /ERR_BLOCKED_BY_CLIENT|Failed to fetch|NetworkError/;

const emailA = `gi-a-${randomUUID()}@example.com`;
const emailB = `gi-b-${randomUUID()}@example.com`;
let guestBefore, photo, familyA, familyB;

try {
  page = await newDevice("guest-import", 9361, `if (location.origin === ${JSON.stringify(BASE)} && !localStorage.getItem("rootmap-data-store")) localStorage.setItem("rootmap-seed-version", "2");`);
  u = ui(page);
  await page.nav(`${BASE}/`);
  await u.appReady();
  await u.waitCloud("signed-out");

  await step("As a guest: the demo content plus the parent's own child, memory with a photo, plan and goal", async () => {
    photo = (await store(`const blob = await (await fetch("data:image/png;base64,${PNG}")).blob(); return S.savePhoto(blob, { width: 1, height: 1 });`)).ref;
    const write = JSON.stringify({ collections: {
      children: [rec({ id: "c-ada", first: "Ada", last: "Test", dob: "2022-05-01", enrolled: "", lessons: 0, group: "Primary", photo })],
      entries: [rec({ id: "m-ada", childId: "c-ada", date: "2026-10-10", title: "Painting", text: "Blue and yellow", photos: [photo] })],
      plans: [rec({ id: "p-ada", activityId: "dotting", date: "2026-10-14", childIds: ["c-ada"] })],
      goals: [rec({ id: "g-ada", title: "Read every night", completed: false })],
    } });
    assert.equal(await store(`return S.write(${write}, { rollback: true });`), null);
    await page.waitFor(`import("/src/lib/data/store.ts").then(S => S.getCollection("entries").some(e => e.id === "obs-o1"))`, 5000, "demo memories in place");
    await sleep(300);
    guestBefore = await guestDump();
    assert.ok(JSON.parse(guestBefore).children.some(c => c.id === "emma"), "demo children are here");
  });

  await step("Signing in: one question, with what would come and what stays", async () => {
    await signInFromProfile(emailA, "Continue with Email");
    familyA = (await u.cloudState()).account.familyId;
    await page.waitFor(`document.querySelector(".guest-import [data-testid=import-summary]")`, 15000, "the question opens by itself");
    const text = await u.text();
    assert.ok(text.includes("Bring your memories into your account?"));
    assert.ok(text.includes("Children: Ada Test"), text);
    assert.ok(text.includes("1 memories") && text.includes("1 plans") && text.includes("1 goals") && text.includes("1 photos"), text);
    assert.ok(text.includes("The sample children (Maya Hao, Leo Hao) stay on this device only."), text);
    assert.ok(!(await page.eval(`!!document.querySelector("[data-testid=import-uncertain], [data-testid=import-duplicate]")`)), "no further questions");
    assert.deepEqual(await serverIds("children", familyA), [], "nothing sent before the parent answers");
    assert.equal(await guestDump(), guestBefore);
  });

  await step("'Add to my account': uploaded, photo verified, completed on the server; the guest database unchanged", async () => {
    await u.click("Add to my account");
    await page.waitFor(`document.querySelector("[data-testid=import-status]")`, 10000, "Account page shows progress");
    await waitImport("complete", "import complete");
    assert.deepEqual(await serverIds("children", familyA), ["c-ada"]);
    assert.deepEqual(await serverIds("entries", familyA), ["m-ada"]);
    assert.deepEqual(await serverIds("plans", familyA), ["p-ada"]);
    assert.deepEqual(await serverIds("goals", familyA), ["g-ada"]);
    assert.deepEqual(await serverIds("activity_records", familyA), [], "demo activity records stay");
    assert.deepEqual(await serverIds("saved_activities", familyA), [], "default saved activities stay");
    const row = (await admin(`/rest/v1/photos?family_id=eq.${familyA}&select=id,sha256,server_sha256,verified_at`))[0];
    assert.equal(row.id, photo);
    assert.ok(row.verified_at);
    assert.equal(row.server_sha256, row.sha256);
    assert.deepEqual((await objects(familyA)).map(o => o.name), [`${photo}.png`]);
    const migration = (await admin(`/rest/v1/cloud_migrations?family_id=eq.${familyA}&select=status,completed_at`))[0];
    assert.equal(migration.status, "complete");
    await page.waitFor(`document.querySelector("[data-testid=import-status]")?.innerText.includes("Your earlier memories are in your account")`, 10000, "done message");
    await waitStatus(`s.allBackedUp`, "all backed up");
    // Shown in the account: Ada, with her memory and photo.
    assert.deepEqual(await store(`return S.getCollection("children").filter(c => !c.deletedAt).map(c => c.first);`), ["Ada"]);
    assert.equal(await guestDump(), guestBefore, "the guest database is exactly as before");
  });

  await step("After a reload: not asked again; tapping nothing re-sends anything", async () => {
    const before = page.requests.length;
    await page.nav(`${BASE}/`);
    await u.appReady();
    await u.waitCloud("signed-in");
    await sleep(2500);
    assert.ok(!(await page.eval(`!!document.querySelector(".guest-import")`)), "question not shown again");
    assert.ok(!page.requests.slice(before).some(r => r.startsWith("POST /rest/v1/children") || r.startsWith("POST /storage")), "nothing uploaded again");
    assert.equal((await admin(`/rest/v1/cloud_migrations?family_id=eq.${familyA}&select=id`)).length, 1);
  });

  await step("Another account on this device is asked separately (and told); 'Not now' sends nothing", async () => {
    await u.signOut();
    assert.equal(await guestDump(), guestBefore, "signing out shows the guest space as it was");
    await sleep(1100);
    await signInFromProfile(emailB, "Continue with Email");
    familyB = (await u.cloudState()).account.familyId;
    await page.waitFor(`document.querySelector(".guest-import [data-testid=import-summary]")`, 15000, "asked");
    assert.ok(await u.has("Some of this may already have been added to another RootMap account on this device."));
    await u.click("Not now");
    await waitStatus(`s.lastSyncedAt && s.phase === "idle"`, "B synced");
    assert.equal((await importState()).status, "dismissed");
    assert.deepEqual(await serverIds("children", familyB), []);
    assert.deepEqual(await serverIds("entries", familyB), []);
    assert.deepEqual(await serverIds("children", familyA), ["c-ada"], "A's family untouched");
  });

  await step("Offline: the question says so and nothing changes; back online, Try Again shows it", async () => {
    await u.openProfile();
    await u.click("RootMap Account");
    await page.waitFor(`document.querySelector("[data-testid=open-import]")`, 5000, "offered again on the Account page");
    await page.send("Network.setBlockedURLs", { urls: [`${API}/*`] });
    try {
      await page.eval(`document.querySelector("[data-testid=open-import]").click()`);
      await page.waitFor(`document.body.innerText.includes("You’re offline.")`, 15000, "offline message");
      assert.equal((await importState()).status, "dismissed");
    } finally {
      await page.send("Network.setBlockedURLs", { urls: [] });
    }
    await u.click("Try Again");
    await page.waitFor(`document.querySelector(".guest-import [data-testid=import-summary]")`, 15000, "ready");
  }, BLOCKED);

  await step("Interrupted by a reload while uploading: it resumes and completes, with nothing twice", async () => {
    // The photo file upload is held back, then the page is reloaded mid-way.
    await page.send("Network.setBlockedURLs", { urls: [`${API}/storage/*`, `${API}/functions/*`] });
    try {
      await u.click("Add to my account");
      await page.waitFor(`import("/src/lib/data/store.ts").then(S => S.guestImportState()?.status === "copied")`, 10000, "copied");
      await page.waitFor(`fetch(${JSON.stringify(`${API}/rest/v1/children?family_id=eq.`)} + ${JSON.stringify(familyB)} + "&select=id", { headers: { apikey: ${JSON.stringify(SERVICE)}, Authorization: "Bearer " + ${JSON.stringify(SERVICE)} } }).then(r => r.json()).then(r => r.length === 1)`, 20000, "records sent");
      await page.nav(`${BASE}/`);
      await u.appReady();
      assert.equal((await importState()).status, "copied", "still under way after the reload");
    } finally {
      await page.send("Network.setBlockedURLs", { urls: [] });
    }
    await page.eval(`window.dispatchEvent(new Event("online"))`);
    await waitImport("complete", "completed after the interruption");
    assert.deepEqual(await serverIds("children", familyB), ["c-ada"]);
    assert.deepEqual(await serverIds("entries", familyB), ["m-ada"]);
    assert.equal((await objects(familyB)).length, 1);
    assert.equal((await admin(`/rest/v1/cloud_migrations?family_id=eq.${familyB}&select=status`))[0].status, "complete");
    assert.deepEqual(await serverIds("children", familyA), ["c-ada"], "each family has its own copy");
    assert.equal(await guestDump(), guestBefore, "the guest database is still exactly as before");
  }, BLOCKED);
} finally {
  await page?.close().catch(() => undefined);
  server.stop();
}
process.exit(finish());
