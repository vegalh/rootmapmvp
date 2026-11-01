// Role-aware screens and a child's circle, in the real app (Shared Child Profiles Phase 3), with real browsers per
// person against the local Supabase stack. Sharing is switched on only for this dev server
// (VITE_ROOTMAP_SHARED_SYNC=on, development builds only). Run with `npm run test:e2e:cloud`.
//
// Lin manages Mia's and Leo's profiles. Grandma Wu can add & edit for Mia and view Leo, and has her own child Emi.
// Sarah views Mia (in Chinese). Memberships are made by the server (no invitations yet).
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
const edit = (p, collection, id, patch) => store(p, `const r = S.getCollection(${JSON.stringify(collection)}).find(r => r.id === ${JSON.stringify(id)});
  return S.write({ collections: { ${collection}: [{ ...r, ...${JSON.stringify(patch)}, updatedAt: new Date().toISOString() }] } }, { rollback: true });`);
const syncNow = p => p.eval(`window.dispatchEvent(new Event("online"))`);
const status = p => p.eval(`import("/src/lib/sync/runner.ts").then(R => R.syncStatus())`);
async function until(p, cond, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const ok = await p.eval(`import("/src/lib/data/store.ts").then(S => { const all = c => S.getCollection(c); const meta = S.syncMeta(); return !!(${cond}); })`);
    if (ok) return;
    await syncNow(p);
    await sleep(500);
  }
  throw new Error(`timed out: ${label}`);
}
async function backedUp(p, label) {
  for (let i = 0; i < 60; i++) { if ((await status(p)).allBackedUp) return; await syncNow(p); await sleep(500); }
  throw new Error(`timed out: ${label}`);
}
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
const revoke = (familyId, childId, user) => rest("DELETE", `/rest/v1/child_memberships?family_id=eq.${familyId}&child_id=eq.${childId}&user_id=eq.${user.id}`);
const serverRow = (table, familyId, id) => admin(`/rest/v1/${table}?family_id=eq.${familyId}&id=eq.${encodeURIComponent(id)}&select=*`).then(rows => rows[0] ?? null);
const offline = (p, on) => p.send("Network.emulateNetworkConditions", { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

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
const text = p => p.eval(`document.body.innerText`);
const circleText = p => p.eval(`document.querySelector(".child-circle")?.innerText ?? ""`);
const headerButtons = p => p.eval(`[...document.querySelectorAll(".child-header-actions button")].map(b => b.textContent || b.getAttribute("aria-label"))`);
async function openChild(p, id) {
  await p.eval(`location.hash = "#/child/" + encodeURIComponent(${JSON.stringify(id)})`);
  await p.waitFor(`document.querySelector(".child-profile .profile-hero")`, 10000, "child page");
}
const circleReady = (p, n) => p.waitFor(`document.querySelectorAll(".child-circle .circle-people li").length === ${n}`, 15000, `circle with ${n} people`);
const kids = async p => { await p.eval(`location.hash = "#/kids"`); await p.waitFor(`document.querySelector(".children-page")`, 10000, "My Children"); };

const Lin = await newAccount("circle-lin"), Wu = await newAccount("circle-wu"), Sarah = await newAccount("circle-sarah");
let dL, dW, dS, FL;

try {
  dL = await signedIn("circle-lin", 9381, Lin);
  FL = dL.familyId;
  dW = await signedIn("circle-wu", 9382, Wu);
  dS = await signedIn("circle-sarah", 9383, Sarah);
  for (const [a, name] of [[Lin, "Lin"], [Wu, "Grandma Wu"], [Sarah, "Sarah"]]) await rest("PATCH", `/rest/v1/profiles?user_id=eq.${a.id}`, { display_name: name });

  await step("Set-up: Mia and Leo with a Moment each; Grandma Wu's own Emi; the circle made by the server", async () => {
    page = dL.p;
    assert.equal(await write(dL.p, { children: [child("c-mia", "Mia"), child("c-leo", "Leo")] }), null);
    assert.equal(await write(dL.p, { entries: [entry("m-1", "c-mia", "Mia's first Moment"), entry("m-2", "c-leo", "Leo's first Moment")] }), null);
    await backedUp(dL.p, "Lin backed up");
    assert.equal(await write(dW.p, { children: [child("c-emi", "Emi")] }), null);
    await backedUp(dW.p, "Wu backed up");
    await grant(FL, "c-mia", Wu, "editor");
    await grant(FL, "c-leo", Wu, "viewer");
    await grant(FL, "c-mia", Sarah, "viewer");
    await until(dW.p, `all("children").some(c => c.id === ${JSON.stringify(sid(FL, "c-leo"))})`, "Wu has Mia and Leo");
    await until(dS.p, `all("entries").some(e => e.id === ${JSON.stringify(sid(FL, "m-1"))})`, "Sarah has Mia's Moment");
  });

  await step("Managing the profile: Edit and Delete; Mia's Circle by name, no access badges; Manage explains access and sets a relationship", async () => {
    page = dL.p;
    await openChild(dL.p, "c-mia");
    assert.deepEqual(await headerButtons(dL.p), ["Edit", "Remove Mia's profile"]);
    await circleReady(dL.p, 3);
    const c = await circleText(dL.p);
    for (const s of ["Mia’s Circle", "You", "Grandma Wu", "Sarah"]) assert.ok(c.includes(s), `circle shows ${s}: ${c}`);
    for (const s of ["Manage Profile", "Add & Edit", "View Only", "owner", "editor", "viewer"]) assert.ok(!c.includes(s), `no access badge "${s}" in the circle itself`);
    await dL.u.click("Manage", ".child-circle button");
    await dL.p.waitFor(`document.querySelector(".circle-manage")`, 5000, "Manage sheet");
    const m = await text(dL.p);
    for (const s of ["Manage Profile", "Add & Edit", "View Only", "Can add, edit, and organize the child’s shared growth records.", "Can view the child’s shared growth records but cannot make changes.", "Invite someone to be part of Mia’s Circle", "The person who manages Mia’s profile can invite others and manage access.", "Invitations are coming soon."]) assert.ok(m.includes(s), `Manage shows "${s}"`);
    await dL.p.eval(`(() => { const li = [...document.querySelectorAll(".circle-manage li")].find(l => l.innerText.includes("Grandma Wu")); const s = li.querySelector("select"); s.value = "grandma"; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await dL.p.waitFor(`[...document.querySelectorAll(".circle-manage li")].find(l => l.innerText.includes("Grandma Wu"))?.querySelector("select").value === "grandma"`, 10000, "relationship saved");
    await dL.p.eval(`[...document.querySelectorAll(".sheet-buttons button")].at(-1).click()`);
    await dL.p.waitFor(`document.querySelector(".child-circle")?.innerText.includes("Grandma")`, 5000, "shown in the circle");
    assert.equal((await rest("GET", `/rest/v1/child_memberships?family_id=eq.${FL}&child_id=eq.c-mia&user_id=eq.${Wu.id}&select=relationship`))[0].relationship, "grandma");
  });

  await step("Add & Edit (Mia) and View Only (Leo) on one device: write buttons only where allowed, no profile actions, one line on what she can do", async () => {
    page = dW.p;
    await openChild(dW.p, sid(FL, "c-mia"));
    assert.deepEqual(await headerButtons(dW.p), [], "no Edit or Delete");
    assert.ok(await dW.p.eval(`!!document.querySelector(".journal-write")`), "can add a Moment");
    await circleReady(dW.p, 3);
    const c = await circleText(dW.p);
    assert.ok(c.includes("You") && c.includes("Grandma") && c.includes("Lin") && c.includes("Sarah"), c);
    assert.ok(c.includes("What you can do: Add & Edit · Can add, edit, and organize the child’s shared growth records."), c);
    await dW.p.eval(`[...document.querySelectorAll(".tabs button")][1].click()`);
    await dW.p.waitFor(`[...document.querySelectorAll(".wide-primary")].some(b => b.textContent.includes("Add Activity"))`, 5000, "Add Activity");
    await openChild(dW.p, sid(FL, "c-leo"));
    assert.ok(!(await dW.p.eval(`!!document.querySelector(".journal-write")`)), "no Add Entry for a View Only child");
    assert.ok((await text(dW.p)).includes("You can look at Leo’s growth records."));
    await dW.p.waitFor(`document.querySelector(".child-circle")?.innerText.includes("View Only")`, 15000, "her access line");
    // No Edit/Delete on Leo's Moment.
    await dW.p.eval(`location.hash = "#/moment/" + encodeURIComponent(${JSON.stringify(sid(FL, "m-2"))})`);
    await dW.p.waitFor(`document.querySelector(".journal-entry")`, 5000, "Moment");
    assert.equal(await dW.p.eval(`document.querySelectorAll(".journal-editor-bar button").length`), 1, "only Back");
  });

  await step("View Only, in Chinese: 陪伴Mia成长的人, 看看成长; a missing relationship is left empty, never made up", async () => {
    page = dS.p;
    await store(dS.p, `return S.write({ settings: [["rootmap-language", "zh"]] });`);
    await openChild(dS.p, sid(FL, "c-mia"));
    await circleReady(dS.p, 3);
    const c = await circleText(dS.p);
    assert.ok(c.includes("陪伴Mia成长的人"), c);
    assert.ok(c.includes("你可以做的事: 看看成长 · 可以查看孩子的成长记录，但不能修改。"), c);
    assert.ok(c.includes("奶奶"), "Grandma Wu's relationship in Chinese");
    assert.equal(await dS.p.eval(`[...document.querySelectorAll(".circle-people li")].find(l => l.innerText.startsWith("你"))?.querySelector("small") ?? null`), null, "no relationship shown for Sarah");
    assert.ok((await text(dS.p)).includes("你可以看看Mia的成长记录。"));
    assert.ok(!(await dS.p.eval(`!!document.querySelector(".journal-write")`)));
    assert.deepEqual(await headerButtons(dS.p), []);
  });

  await step("Pickers: Mark as Tried and a new Moment offer only children she can add to; My Week only her own family", async () => {
    page = dW.p;
    await dW.p.eval(`location.hash = "#/activity/water-pouring"`);
    await dW.p.waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent.includes("Mark as Tried"))`, 10000, "activity page");
    await dW.u.click("Mark as Tried");
    await dW.p.waitFor(`document.querySelector(".child-checks")`, 5000, "Mark as Tried sheet");
    assert.deepEqual((await dW.p.eval(`[...document.querySelectorAll(".child-checks button")].map(b => b.dataset.child)`)).sort(), ["c-emi", sid(FL, "c-mia")].sort());
    await dW.p.eval(`document.querySelector(".modal-close, .sheet-close, [aria-label='Close']")?.click(); true`);
    await dW.p.eval(`history.back()`); await sleep(400);
    await dW.p.eval(`location.hash = "#/activity/water-pouring"`); await sleep(400);
    await dW.u.click("Add to My Week");
    await dW.p.waitFor(`document.querySelector(".child-checks")`, 5000, "plan sheet");
    assert.deepEqual(await dW.p.eval(`[...document.querySelectorAll(".child-checks button")].map(b => b.dataset.child)`), ["c-emi"]);
    await dW.p.eval(`location.hash = "#/new-moment"`);
    await dW.p.waitFor(`document.querySelector(".journal-editor, .child-checks")`, 10000, "editor");
    assert.deepEqual((await dW.p.eval(`[...document.querySelectorAll(".child-checks button")].map(b => b.dataset.child)`)).sort(), ["c-emi", sid(FL, "c-mia")].sort());
  });

  let original, copy;
  await step("A photo for a Moment about Emi and Mia: Emi keeps it, Mia's family gets its own copy (uploaded there, for Mia); nothing broken", async () => {
    page = dW.p;
    await kids(dW.p);
    original = (await store(dW.p, `const blob = await (await fetch("data:image/png;base64,${PNG}")).blob(); return S.savePhoto(blob, { width: 1, height: 1 });`)).ref;
    const map = await dW.p.eval(`import("/src/lib/sharedPhotos.ts").then(m => m.photosForChildren(${JSON.stringify(["c-emi", sid(FL, "c-mia")])}, [${JSON.stringify(original)}]))`);
    assert.deepEqual(map["c-emi"], [original]);
    copy = map[sid(FL, "c-mia")][0];
    assert.notEqual(copy, original);
    assert.equal(await write(dW.p, { entries: [entry("m-both", "c-emi", "Both painted", [original]), entry("m-both2", sid(FL, "c-mia"), "Both painted", [copy])] }), null);
    await backedUp(dW.p, "both Moments and photos backed up");
    assert.ok((await serverRow("photos", dW.familyId, original)).verified_at, "the original in her own family");
    const row = await serverRow("photos", FL, copy);
    assert.equal(row.child_id, "c-mia");
    assert.ok(row.verified_at, "the copy in Mia's family, verified");
    assert.equal(await serverRow("photos", FL, original), null, "no cross-family reference");
    assert.equal((await serverRow("photos", dW.familyId, original)).sha256, row.sha256, "the same picture");
    page = dL.p;
    await until(dL.p, `all("entries").some(e => e.id === "m-both2")`, "Lin receives Mia's Moment");
    await dL.p.waitFor(`import("/src/lib/data/store.ts").then(S => S.hasPhotoBytes(${JSON.stringify(copy)}))`, 30000, "and its photo");
  });

  await step("Deleting Leo's profile: Grandma Wu loses Leo and sees a gentle note; Lin can restore it from Recently Deleted", async () => {
    page = dL.p;
    await openChild(dL.p, "c-leo");
    await dL.p.eval(`document.querySelector(".child-header-actions button[aria-label]").click()`);
    await dL.p.waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent === "Delete Child")`, 5000, "confirm");
    await dL.p.eval(`[...document.querySelectorAll("button")].filter(b => b.textContent === "Delete Child").at(-1).click()`);
    await backedUp(dL.p, "deletion sent");
    page = dW.p;
    await until(dW.p, `!all("children").some(c => c.id === ${JSON.stringify(sid(FL, "c-leo"))})`, "Leo removed from her device");
    await kids(dW.p);
    await dW.p.waitFor(`document.querySelector(".access-notice")?.innerText.includes("You no longer have access to this child’s profile.")`, 10000, "the note");
    assert.ok(!(await text(dW.p)).includes("Leo"), "nothing of Leo shown");
    for (const s of ["revoked", "membership", "authoriz", "RLS"]) assert.ok(!(await text(dW.p)).toLowerCase().includes(s.toLowerCase()));
    await dW.p.eval(`[...document.querySelectorAll(".access-notice button")].find(b => b.textContent === "Done").click()`);
    await dW.p.waitFor(`!document.querySelector(".access-notice")`, 5000, "note acknowledged");
    page = dL.p;
    await dL.p.eval(`location.hash = "#/recently-deleted"`);
    await dL.p.waitFor(`document.body.innerText.includes("Leo")`, 5000, "Leo in Recently Deleted");
    await dL.p.eval(`[...document.querySelectorAll(".deleted-row button")].find(b => b.textContent === "Restore").click()`);
    await dL.p.waitFor(`[...document.querySelectorAll("button")].filter(b => b.textContent === "Restore").length > 1`, 5000, "confirm restore");
    await dL.p.eval(`[...document.querySelectorAll("button")].filter(b => b.textContent === "Restore").at(-1).click()`);
    await backedUp(dL.p, "restore sent");
    page = dW.p;
    await until(dW.p, `all("children").some(c => c.id === ${JSON.stringify(sid(FL, "c-leo"))})`, "Leo is back for Grandma Wu");
  });

  await step("Removed from Mia's circle with a change made offline: the note, and the kept change shown only as 'Moment' and a date, then discarded", async () => {
    page = dW.p;
    await offline(dW.p, true);
    assert.equal(await edit(dW.p, "entries", sid(FL, "m-1"), { text: "a private offline note" }), null);
    await revoke(FL, "c-mia", Wu);
    await offline(dW.p, false);
    await until(dW.p, `!all("children").some(c => c.id === ${JSON.stringify(sid(FL, "c-mia"))})`, "Mia removed");
    await kids(dW.p);
    await dW.p.waitFor(`document.querySelector(".access-notice")?.innerText.includes("unsent changes are kept on this device")`, 10000, "kept changes mentioned");
    await dW.p.eval(`[...document.querySelectorAll(".access-notice button")].find(b => b.textContent === "Review").click()`);
    await dW.p.waitFor(`document.querySelector(".archived-list")`, 5000, "review sheet");
    const sheet = await dW.p.eval(`document.querySelector(".archived-list").closest("[role=dialog]").innerText`);
    assert.ok(sheet.includes("Moment") && sheet.includes("Kept"), sheet);
    for (const s of ["a private offline note", "Mia", "Both painted", FL]) assert.ok(!sheet.includes(s), `the review shows "${s}"`);
    assert.ok(!(await text(dW.p)).includes("a private offline note"), "the kept text is nowhere on screen");
    await dW.p.eval(`[...document.querySelectorAll(".archived-list button")].forEach(b => b.textContent === "Discard" && b.click()); true`);
    await dW.p.waitFor(`document.body.innerText.includes("Nothing left to review.")`, 5000, "discarded");
    assert.equal((await dW.u.dump(`rootmap-account-${Wu.id}`)).archive.filter(a => a.source.startsWith("access-revoked:")).length, 0, "gone from the device");
  });

  await step("Guest: no circle, no notes, the profile's own actions as before", async () => {
    const g = await newDevice("circle-guest", 9384);
    const gu = ui(g);
    page = g;
    await g.nav(`${BASE}/`);
    await gu.welcomeShown();
    await gu.click("Continue as Guest");
    await gu.appReady();
    assert.equal(await store(g, `return S.write(${JSON.stringify({ collections: { children: [child("c-guest-circle", "Gwen")] } })}, { rollback: true });`), null);
    await openChild(g, "c-guest-circle");
    assert.deepEqual(await headerButtons(g), ["Edit", "Remove Gwen's profile"]);
    assert.ok(await g.eval(`!!document.querySelector(".journal-write")`));
    assert.ok(!(await g.eval(`!!document.querySelector(".child-circle")`)), "no circle for a guest");
    await kids(g);
    assert.ok(!(await g.eval(`!!document.querySelector(".access-notice")`)));
    await g.close();
  });
} catch (e) {
  console.log(`FAIL  (set-up) ${e.message}`);
  process.exitCode = 1;
} finally {
  for (const d of [dL, dW, dS]) await d?.p.close().catch(() => {});
  server.stop();
}
process.exit(finish() || process.exitCode || 0);
