// Release readiness for Shared Child Profiles (docs/shared-child-profiles-release-readiness.md): one child shared by
// invitation link between two accounts, from the first link to removal, with each account in its own headless Chrome
// (its own profile directory: separate cookies, localStorage, sessionStorage, IndexedDB and HTTP cache) against the
// local Supabase stack. Sharing is switched on only for this dev server (VITE_ROOTMAP_SHARED_SYNC=on, development
// builds only). Run with `npm run test:e2e:cloud`.
//
// These are separate browser contexts on one computer, not physical devices. Ben's browser emulates a phone (390×844,
// device scale 3, touch, an iPhone Safari user agent); it is still Chrome's engine, not Safari or WebKit.
//
// Ana manages Kai's profile and invites Ben (Add & Edit) by link. Ben opens it on his phone, signs in, accepts, sees
// Kai's Moment and photo, adds and edits. Both edit the same Moment offline (conflict rules). Ana makes Ben View Only,
// then removes him; Ben's device cleans up, keeping his unsent change apart; Ana's records stay as they were.
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

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const WECHAT_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x1800323c) NetType/WIFI Language/zh_CN";

const store = (p, body) => p.eval(`import("/src/lib/data/store.ts").then(async S => { ${body} })`);
const write = (p, collections) => store(p, `return S.write({ collections: ${JSON.stringify(collections)} }, { rollback: true });`);
const get = (p, collection, id) => store(p, `return S.getCollection(${JSON.stringify(collection)}).find(r => r.id === ${JSON.stringify(id)}) ?? null;`);
const edit = (p, collection, id, patch) => store(p, `const r = S.getCollection(${JSON.stringify(collection)}).find(r => r.id === ${JSON.stringify(id)});
  return S.write({ collections: { ${collection}: [{ ...r, ...${JSON.stringify(patch)}, updatedAt: new Date().toISOString() }] } }, { rollback: true });`);
const savePhoto = p => store(p, `const blob = await (await fetch("data:image/png;base64,${PNG}")).blob(); return S.savePhoto(blob, { width: 1, height: 1 });`);
const syncNow = p => p.eval(`window.dispatchEvent(new Event("online"))`);
const status = p => p.eval(`import("/src/lib/sync/runner.ts").then(R => R.syncStatus())`);
async function until(p, cond, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const ok = await p.eval(`import("/src/lib/data/store.ts").then(S => { const all = c => S.getCollection(c); const meta = S.syncMeta(); const out = S.pendingOutbox(); return !!(${cond}); })`);
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
  await fetch(`${API}/rest/v1/profiles`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ user_id: user.id, display_name: label.split("-").at(-1).replace(/^./, c => c.toUpperCase()) }),
  });
  return { email, id: user.id };
};
const membership = (familyId, childId, user) => rest("GET", `/rest/v1/child_memberships?family_id=eq.${familyId}&child_id=eq.${childId}&user_id=eq.${user.id}&select=*`).then(rows => rows[0] ?? null);
const serverRow = (table, familyId, id) => admin(`/rest/v1/${table}?family_id=eq.${familyId}&id=eq.${encodeURIComponent(id)}&select=*`).then(rows => rows[0] ?? null);
const offline = (p, on) => p.send("Network.emulateNetworkConditions", { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
const text = p => p.eval(`document.body.innerText`);
const circleText = p => p.eval(`document.querySelector(".child-circle")?.innerText ?? ""`);
async function openChild(p, id) {
  await p.eval(`location.hash = "#/child/" + encodeURIComponent(${JSON.stringify(id)})`);
  await p.waitFor(`document.querySelector(".child-profile .profile-hero")`, 10000, "child page");
}
const kids = async p => { await p.eval(`location.hash = "#/kids"`); await p.waitFor(`document.querySelector(".children-page")`, 10000, "My Children"); };
const gate = p => p.waitFor(`document.querySelector("input[name=email]") || document.body.innerText.includes("Welcome to RootMap")`, 15000, "the sign-in gate");
const noSideScroll = p => p.eval(`document.documentElement.scrollWidth <= window.innerWidth + 1`);

// A phone: emulated before the first page loads, so the app starts with a mobile viewport and user agent.
async function phone(name, port, userAgent) {
  const p = await newDevice(name, port);
  await p.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await p.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await p.send("Network.setUserAgentOverride", { userAgent });
  // Everything that leaves this browser, to any host, and what the page writes to the console.
  p.seen = [];
  p.handlers.add(m => {
    if (m.method === "Network.requestWillBeSent") {
      const r = m.params.request;
      p.seen.push({ url: r.url, method: r.method, body: r.postData ?? "", referer: r.headers.Referer ?? r.headers.referer ?? "" });
    }
    if (m.method === "Runtime.consoleAPICalled") p.seen.push({ console: m.params.args.map(a => a.value ?? a.description ?? "").join(" ") });
  });
  return p;
}
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
// Ana's Manage sheet: the invite form, then the link straight from the clipboard (never read off the page).
async function createInvite(d, role = "editor") {
  await d.p.waitFor(`[...document.querySelectorAll(".child-circle button")].some(b => b.textContent === "Manage")`, 10000, "Manage button");
  await d.u.click("Manage", ".child-circle button");
  await d.p.waitFor(`document.querySelector(".circle-manage")`, 5000, "Manage sheet");
  await d.u.click("Invite Someone", ".circle-invite button");
  await d.p.waitFor(`document.querySelector(".invite-form")`, 5000, "invite form");
  if (role === "viewer") await d.u.click("View Only", ".invite-form .segmented button");
  await d.p.eval(`window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; true`);
  await d.u.click("Create Invitation Link", ".invite-form button");
  await d.p.waitFor(`document.querySelector(".invite-link-ready")`, 10000, "link ready");
  await d.u.click("Copy Link", ".invite-link-ready button");
  await d.p.waitFor(`window.__copied`, 5000, "link copied");
  const link = await d.p.eval(`window.__copied`);
  await d.u.click("Done", ".sheet-buttons button");
  return { link, token: new URL(link).hash.split("/invite/")[1] };
}
const manageRow = (p, name, js) => p.eval(`(() => { const li = [...document.querySelectorAll(".circle-manage li")].find(l => l.innerText.includes(${JSON.stringify(name)})); ${js} })()`);

const Ana = await newAccount("multi-ana"), Ben = await newAccount("multi-ben");
let dA, dB, FA, photoA, photoA2, invite;

try {
  dA = await signedIn("multi-ana", 9401, Ana);
  FA = dA.familyId;

  await step("Ana: creates Kai, adds a Moment with a photo; all backed up and the photo verified", async () => {
    page = dA.p;
    photoA = (await savePhoto(dA.p)).ref;
    assert.equal(await write(dA.p, { children: [child("c-kai", "Kai")] }), null);
    assert.equal(await write(dA.p, { entries: [entry("m-a1", "c-kai", "Kai stacked five blocks", [photoA])] }), null);
    // For Recently Deleted: another Moment with its own photo and an activity record of Kai, and a child of Ana's
    // that nobody else helps with (its deletions stay as they always were).
    photoA2 = (await savePhoto(dA.p)).ref;
    assert.equal(await write(dA.p, { children: [child("c-solo", "Sol")] }), null);
    assert.equal(await write(dA.p, { entries: [entry("m-a2", "c-kai", "Kai found a snail", [photoA2]), entry("m-solo", "c-solo", "Sol's own Moment")] }), null);
    assert.equal(await write(dA.p, { records: [rec({ id: "r-a1", childId: "c-kai", lesson: "Water pouring", activityId: "water-pouring", area: "practical-life", date: "2026-10-21" })] }), null);
    await backedUp(dA.p, "Ana backed up");
    assert.ok((await serverRow("photos", FA, photoA)).verified_at, "photo verified on the server");
  });

  await step("Ana: invites Ben (Add & Edit) from Kai's Circle; the link is a hash address on this site", async () => {
    page = dA.p;
    await openChild(dA.p, "c-kai");
    invite = await createInvite(dA);
    assert.ok(invite.link.startsWith(`${BASE}/#/invite/`), invite.link.replace(invite.token, "<token>"));
    assert.match(invite.token, /^[0-9a-f]{48}$/, "192-bit hex token");
  });

  await step("Phone user agents (iPhone Safari, Android Chrome, WeChat): signed out, the link opens the sign-in gate, keeps the address, names no child, no side scrolling", async () => {
    const p = await phone("multi-ua", 9402, IPHONE_SAFARI);
    page = p;
    try {
      for (const ua of [IPHONE_SAFARI, ANDROID_CHROME, WECHAT_IOS]) {
        await p.send("Network.setUserAgentOverride", { userAgent: ua });
        await p.nav("about:blank"); // the same address again would be a same-document navigation, with no load
        await p.nav(`${BASE}/#/invite/${invite.token}`);
        await gate(p);
        assert.equal(await p.eval(`navigator.userAgent`), ua);
        assert.equal(await p.eval(`location.hash`), "#/invite", "the token left the address bar at once");
        assert.ok(!(await p.eval(`location.href + document.URL`)).includes(invite.token));
        assert.ok((await p.eval(`sessionStorage.getItem("rootmap.pending-invite") ?? ""`)).includes(invite.token), "held for this tab only");
        assert.ok(!(await p.eval(`JSON.stringify(Object.entries(localStorage))`)).includes(invite.token), "never in localStorage");
        assert.ok(!(await text(p)).includes("Kai"), "nothing about the child before sign-in");
        assert.ok(await noSideScroll(p), "no horizontal scrolling at 390px");
      }
    } finally {
      await p.close().catch(() => {});
    }
  });

  await step("Ben, on a phone: opens the link, signs in, the same invitation is restored and previewed; tap targets fit the screen", async () => {
    const p = await phone("multi-ben", 9403, IPHONE_SAFARI);
    dB = { p, u: ui(p) };
    page = p;
    await p.nav(`${BASE}/#/invite/${invite.token}`);
    await gate(p);
    await dB.u.signInWithPassword(Ben.email);
    await p.waitFor(`document.querySelector(".invite-page") && [...document.querySelectorAll(".invite-page button")].some(b => b.textContent === "Accept")`, 15000, "preview");
    const t = await text(p);
    assert.ok(t.includes("Join Kai’s Circle") && t.includes("Invited by Ana"), t);
    assert.ok(t.includes(`Signed in as ${Ben.email}.`) && t.includes("Not you?"), "which account would accept");
    assert.equal(await p.eval(`location.hash`), "#/invite", "restored after the sign-in reload without the token in the address");
    const box = await p.eval(`(() => { const b = [...document.querySelectorAll(".invite-page button")].find(b => b.textContent === "Accept").getBoundingClientRect(); return { h: b.height, bottom: b.bottom, right: b.right, vh: innerHeight, vw: innerWidth }; })()`);
    assert.ok(box.h >= 44, `Accept is at least 44px tall (${box.h})`);
    assert.ok(box.bottom <= box.vh && box.right <= box.vw, `Accept is on screen without scrolling (${JSON.stringify(box)})`);
    assert.ok(await noSideScroll(p));
    dB.familyId = (await dB.u.cloudState()).account.familyId;
  });

  await step("Ana keeps Kai's Manage sheet open while the invitation is pending", async () => {
    page = dA.p;
    await dA.u.click("Manage", ".child-circle button");
    await dA.p.waitFor(`document.querySelector(".invite-pending")?.innerText.includes("Expires")`, 5000, "pending invitation listed");
    assert.ok(!(await dA.p.eval(`document.querySelector(".circle-manage").innerText`)).includes("Ben"));
  });

  await step("Ben accepts: membership made, Kai, her Moment and photo arrive; the spent token is in no history entry or storage", async () => {
    page = dB.p;
    await dB.p.eval(`[...document.querySelectorAll(".invite-page button")].find(b => b.textContent === "Accept").click(); true`);
    await dB.p.waitFor(`document.querySelector(".child-profile .profile-hero")`, 20000, "Kai's profile opened");
    assert.equal((await membership(FA, "c-kai", Ben)).role, "editor");
    await until(dB.p, `all("entries").some(e => e.id === ${JSON.stringify(sid(FA, "m-a1"))})`, "Ana's Moment arrived");
    await dB.p.waitFor(`import("/src/lib/data/store.ts").then(S => S.hasPhotoBytes(${JSON.stringify(photoA)}))`, 30000, "Ana's photo downloaded");
    const history = await dB.p.send("Page.getNavigationHistory");
    for (const e of history.entries) assert.ok(!e.url.includes(invite.token), `history entry ${e.url.replace(invite.token, "<token>")}`);
    const kept = await dB.p.eval(`JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)])`);
    assert.ok(!kept.includes(invite.token), "token not in localStorage or sessionStorage");
    const db = await dB.u.dump(`rootmap-account-${Ben.id}`);
    assert.ok(!JSON.stringify(db).includes(invite.token), "token not in IndexedDB");
  });

  await step("Token exposure: only the two invitation calls carry it, in a POST body to the local stack; never a URL, a Referer, the console or another host", async () => {
    const seen = dB.p.seen;
    // blob: and data: addresses (photos shown from this device's own copy) never leave the browser.
    const hosts = new Set(seen.filter(s => /^(https?|wss?):/.test(s.url ?? "")).map(s => new URL(s.url).hostname));
    for (const h of hosts) assert.ok(["localhost", "127.0.0.1"].includes(h), `request to ${h}`);
    const carrying = seen.filter(s => s.url && (s.body.includes(invite.token) || s.url.includes(invite.token) || s.referer.includes(invite.token)));
    assert.ok(carrying.length >= 2, "preview and acceptance were seen");
    for (const s of carrying) {
      assert.ok(!s.url.includes(invite.token) && !s.referer.includes(invite.token), `in a URL or Referer: ${s.url.replace(invite.token, "<token>")}`);
      assert.equal(s.method, "POST");
      assert.ok(/\/rest\/v1\/rpc\/(get_invitation_preview|accept_invitation)$/.test(new URL(s.url).pathname), new URL(s.url).pathname);
    }
    assert.ok(!seen.some(s => s.console?.includes(invite.token)), "never in the console");
  });

  await step("Ben adds a Moment and edits Ana's; Ana receives both", async () => {
    page = dB.p;
    assert.equal(await write(dB.p, { entries: [entry("m-b1", sid(FA, "c-kai"), "Kai and Ben fed the ducks")] }), null);
    assert.equal(await edit(dB.p, "entries", sid(FA, "m-a1"), { text: "Kai stacked five blocks, then six" }), null);
    await backedUp(dB.p, "Ben's changes sent");
    assert.equal((await serverRow("entries", FA, "m-b1")).updated_by, Ben.id);
    page = dA.p;
    await until(dA.p, `all("entries").some(e => e.id === "m-b1") && all("entries").find(e => e.id === "m-a1")?.text === "Kai stacked five blocks, then six"`, "Ana has both");
  });

  await step("Circle refresh: with Manage open and the invitation pending, Ben appears in Ana's sheet and circle by himself (no tap, no navigation)", async () => {
    page = dA.p;
    await dA.p.waitFor(`[...document.querySelectorAll(".circle-manage li")].some(l => l.innerText.includes("Ben")) && document.querySelector(".invite-pending")?.innerText.includes("Joined")`, 30000, "Ben in the open sheet");
    await dA.u.click("Done", ".sheet-buttons button");
    assert.ok((await circleText(dA.p)).includes("Ben"), await circleText(dA.p));
  });

  await step("Join notice: Ana's My Children says Ben joined Kai's Circle; View opens Kai; dismissed, it stays gone after a reload; Ben sees no such notice", async () => {
    page = dA.p;
    await kids(dA.p);
    await dA.p.waitFor(`document.querySelector(".circle-joins")?.innerText.includes("Ben joined Kai’s Circle.")`, 10000, "join notice");
    assert.ok(!(await dA.p.eval(`document.querySelector(".circle-joins").innerText`)).includes(Ben.email), "no email");
    await dA.u.click("View Circle", ".circle-joins button");
    await dA.p.waitFor(`location.hash === "#/child/c-kai" && document.querySelector(".child-circle")?.innerText.includes("Ben")`, 10000, "Kai's page with her circle");
    await kids(dA.p);
    await sleep(800);
    assert.ok(!(await dA.p.eval(`!!document.querySelector(".circle-joins")`)), "dismissed");
    await dA.p.reload(); await dA.u.appReady(); await kids(dA.p); await sleep(1200);
    assert.ok(!(await dA.p.eval(`!!document.querySelector(".circle-joins")`)), "still dismissed after a reload");
    page = dB.p;
    await kids(dB.p); await sleep(1000);
    assert.ok(!(await dB.p.eval(`!!document.querySelector(".circle-joins")`)), "members get no join notices");
  });

  await step("Recently Deleted: Ben deletes Ana's Moment offline and her activity record; Ana restores both, same records and photo, and Ben sees them again", async () => {
    page = dB.p;
    await until(dB.p, `all("entries").some(e => e.id === ${JSON.stringify(sid(FA, "m-a2"))}) && all("records").some(r => r.id === ${JSON.stringify(sid(FA, "r-a1"))})`, "Ben has the Moment and record");
    await offline(dB.p, true);
    assert.equal(await edit(dB.p, "entries", sid(FA, "m-a2"), { deletedAt: new Date().toISOString() }), null);
    await offline(dB.p, false);
    assert.equal(await edit(dB.p, "records", sid(FA, "r-a1"), { deletedAt: new Date().toISOString() }), null);
    await backedUp(dB.p, "Ben's deletions sent");
    const deletedRow = await serverRow("entries", FA, "m-a2");
    assert.ok(deletedRow.deleted_at, "soft-deleted on the server, not removed");
    assert.equal(deletedRow.updated_by, Ben.id);
    assert.equal((await serverRow("photos", FA, photoA2)).deleted_at, null, "the photo itself is untouched");
    // Ben (Add & Edit) has no shared section in his Recently Deleted: restoring is for the person managing the profile.
    await dB.p.eval(`location.hash = "#/recently-deleted"`);
    await dB.p.waitFor(`document.querySelector(".deleted-intro")`, 5000, "Ben's Recently Deleted");
    await sleep(800);
    assert.ok(!(await dB.p.eval(`!!document.querySelector(".deleted-shared")`)));
    page = dA.p;
    assert.equal(await edit(dA.p, "entries", "m-solo", { deletedAt: new Date().toISOString() }), null);
    await until(dA.p, `all("entries").find(e => e.id === "m-a2")?.deletedAt && all("records").find(r => r.id === "r-a1")?.deletedAt`, "Ana has both deletions");
    await dA.p.eval(`location.hash = "#/recently-deleted"`);
    await dA.p.waitFor(`document.querySelectorAll(".deleted-shared .deleted-row").length === 2`, 10000, "two shared records listed");
    const listed = await dA.p.eval(`document.querySelector(".deleted-shared").innerText`);
    assert.ok(listed.includes("Moment · Kai") && listed.includes("Kai found a snail") && listed.includes("Activity record · Kai"), listed);
    assert.ok(!listed.includes("Sol"), "a child nobody else helps with: not listed, unchanged behaviour");
    for (let i = 0; i < 2; i++) {
      await dA.p.eval(`document.querySelector(".deleted-shared .deleted-row button").click(); true`);
      await dA.p.confirmDialog();
      await dA.p.waitFor(`document.querySelectorAll(".deleted-shared .deleted-row").length === ${1 - i}`, 5000, "restored one");
    }
    await backedUp(dA.p, "restores sent");
    const restored = await serverRow("entries", FA, "m-a2");
    assert.equal(restored.deleted_at, null);
    assert.equal(restored.text, "Kai found a snail");
    assert.deepEqual(restored.photo_ids, [photoA2], "same photo");
    assert.equal(restored.created_at, deletedRow.created_at, "same record");
    assert.equal((await serverRow("activity_records", FA, "r-a1")).deleted_at, null);
    assert.ok((await serverRow("entries", FA, "m-solo")).deleted_at, "Sol's Moment stays deleted");
    page = dB.p;
    await until(dB.p, `!all("entries").find(e => e.id === ${JSON.stringify(sid(FA, "m-a2"))})?.deletedAt && !all("records").find(r => r.id === ${JSON.stringify(sid(FA, "r-a1"))})?.deletedAt`, "Ben sees both again");
    assert.ok(await dB.p.eval(`import("/src/lib/data/store.ts").then(S => S.hasPhotoBytes(${JSON.stringify(photoA2)}))`), "the photo stayed on Ben's device");
  });

  await step("Same Moment edited by both while offline: the first to reach the server keeps the text; the other is kept as a version, not lost", async () => {
    await until(dB.p, `all("entries").find(e => e.id === ${JSON.stringify(sid(FA, "m-b1"))}) && !out.length`, "Ben settled");
    await offline(dA.p, true); await offline(dB.p, true);
    // The same field on both sides, and different fields of another Moment.
    assert.equal(await edit(dA.p, "entries", "m-a1", { text: "Ana's words" }), null);
    assert.equal(await edit(dB.p, "entries", sid(FA, "m-a1"), { text: "Ben's words" }), null);
    assert.equal(await edit(dA.p, "entries", "m-b1", { title: "Ducks" }), null);
    assert.equal(await edit(dB.p, "entries", sid(FA, "m-b1"), { text: "Kai and Ben fed the ducks by the pond" }), null);
    page = dA.p;
    await offline(dA.p, false);
    await backedUp(dA.p, "Ana first");
    page = dB.p;
    await offline(dB.p, false);
    await backedUp(dB.p, "Ben second");
    const a1 = await serverRow("entries", FA, "m-a1"), b1 = await serverRow("entries", FA, "m-b1");
    assert.equal(a1.text, "Ana's words", "same field: the server's (first) version stays");
    assert.equal(b1.title, "Ducks", "different fields: Ana's title");
    assert.equal(b1.text, "Kai and Ben fed the ducks by the pond", "different fields: Ben's text");
    const versions = await admin(`/rest/v1/record_versions?family_id=eq.${FA}&record_id=eq.m-a1&select=*`);
    const lost = versions.find(v => v.version?.text === "Ben's words");
    assert.ok(lost, "Ben's text is kept as a record version");
    assert.equal(lost.reason, "text_conflict");
    assert.equal(lost.created_by, Ben.id);
    await until(dB.p, `all("entries").find(e => e.id === ${JSON.stringify(sid(FA, "m-a1"))})?.text === "Ana's words"`, "Ben converges");
    await until(dA.p, `all("entries").find(e => e.id === "m-b1")?.text === "Kai and Ben fed the ducks by the pond"`, "Ana converges");
    const count = await admin(`/rest/v1/entries?family_id=eq.${FA}&child_id=eq.c-kai&select=id`);
    assert.deepEqual(count.map(r => r.id).sort(), ["m-a1", "m-a2", "m-b1"], "no duplicates after reconnecting");
    // Who can read the kept version: Ana (manages Kai) and Ben (kept it); the API decides, per account.
    for (const d of [dA, dB]) {
      const n = await d.p.eval(`import("/src/lib/cloud/client.ts").then(async C => { const c = await C.getCloudClient(); const { data } = await c.from("record_versions").select("id").eq("family_id", ${JSON.stringify(FA)}).eq("record_id", "m-a1"); return data?.length ?? -1; })`);
      assert.ok(n >= 1, "readable by Ana and by Ben");
    }
    // Phase 5: Ben (whose change lost) is told on My Children; Ana (whose change stayed) is not.
    await kids(dB.p);
    await dB.p.waitFor(`[...document.querySelectorAll(".access-notice")].some(n => n.innerText.includes("Someone else changed"))`, 15000, "Ben's kept-edit note");
    await kids(dA.p); await sleep(800);
    assert.ok(!(await text(dA.p)).includes("Someone else changed"), "no note for the change that stayed");
    // The Moment's page shows the kept version to Ana (who manages Kai's profile) and to Ben (whose version it is).
    for (const [d, id] of [[dA, "m-a1"], [dB, sid(FA, "m-a1")]]) {
      await d.p.eval(`location.hash = "#/moment/" + encodeURIComponent(${JSON.stringify(id)})`);
      await d.p.waitFor(`document.querySelector(".kept-versions")?.innerText.includes("Ben's words")`, 10000, "kept version shown");
      assert.ok((await d.p.eval(`document.querySelector(".journal-entry-text").innerText`)).includes("Ana's words"), "the Moment itself shows the kept-first text");
    }
    // Who wrote it (Phase 5): Ana added and last changed m-a1, so her own page says nothing; Ben's names her.
    await dB.p.waitFor(`document.querySelector(".entry-authors")?.innerText.includes("Added by Ana")`, 10000, "Ben sees who added it");
    assert.ok(!(await dB.p.eval(`document.querySelector(".entry-authors").innerText`)).includes("Last changed"), "the same person is named once");
    assert.ok(!(await dA.p.eval(`!!document.querySelector(".entry-authors")`)), "nothing on a Moment written and changed only by Ana");
    // Opening the Moment cleared Ben's note.
    await kids(dB.p); await sleep(800);
    assert.ok(!(await text(dB.p)).includes("Someone else changed"), "the note is gone once the Moment was opened");
    // Ana's view of Ben's Moment m-b1: he added it.
    await dA.p.eval(`location.hash = "#/moment/m-b1"`);
    await dA.p.waitFor(`document.querySelector(".entry-authors")?.innerText.includes("Added by Ben")`, 10000, "Ana sees Ben added m-b1");
  });

  await step("Ana makes Ben View Only in Manage; Ben's screens follow (no adding or editing), and his circle line updates in place", async () => {
    page = dA.p;
    await openChild(dA.p, "c-kai");
    await dA.p.waitFor(`[...document.querySelectorAll(".child-circle button")].some(b => b.textContent === "Manage")`, 10000, "Manage button");
    await dA.u.click("Manage", ".child-circle button");
    await dA.p.waitFor(`[...document.querySelectorAll(".circle-manage li")].some(l => l.innerText.includes("Ben"))`, 5000, "Ben listed");
    await manageRow(dA.p, "Ben", `const s = li.querySelector("select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, "viewer"); s.dispatchEvent(new Event("change", { bubbles: true })); return true;`);
    for (let i = 0; i < 20 && (await membership(FA, "c-kai", Ben)).role !== "viewer"; i++) await sleep(250);
    assert.equal((await membership(FA, "c-kai", Ben)).role, "viewer");
    await dA.u.click("Done", ".sheet-buttons button");
    page = dB.p;
    await openChild(dB.p, sid(FA, "c-kai"));
    await until(dB.p, `meta.scopes?.shared?.[${JSON.stringify(sid(FA, "c-kai"))}] === "viewer"`, "Ben's device knows");
    await dB.p.waitFor(`document.querySelector(".view-only-note") && document.querySelector(".child-circle")?.innerText.includes("View Only")`, 15000, "view-only page and circle line");
    const t = await text(dB.p);
    assert.ok(!t.includes("Add Entry") && !t.includes("Add Activity"), "no add buttons");
  });

  await step("View Only: Ben can still read everything shared; a change is refused by the server, marked, and never resent", async () => {
    page = dB.p;
    assert.ok(await get(dB.p, "entries", sid(FA, "m-b1")));
    assert.ok(await dB.p.eval(`import("/src/lib/data/store.ts").then(S => S.hasPhotoBytes(${JSON.stringify(photoA)}))`));
    assert.equal(await edit(dB.p, "entries", sid(FA, "m-a1"), { text: "Ben tried as a viewer" }), null);
    await until(dB.p, `out.some(e => e.id === ${JSON.stringify(sid(FA, "m-a1"))} && e.rejected)`, "refused and marked");
    const patches = () => dB.p.seen.filter(s => s.method === "PATCH" && s.url.includes("/rest/v1/entries")).length;
    const before = patches();
    for (let i = 0; i < 3; i++) { await syncNow(dB.p); await sleep(700); }
    assert.equal(patches(), before, "not sent again");
    assert.equal((await serverRow("entries", FA, "m-a1")).text, "Ana's words");
    assert.equal(await edit(dB.p, "entries", sid(FA, "m-a2"), { deletedAt: new Date().toISOString() }), null);
    await until(dB.p, `out.some(e => e.id === ${JSON.stringify(sid(FA, "m-a2"))} && e.rejected)`, "a viewer's deletion refused too");
    assert.equal((await serverRow("entries", FA, "m-a2")).deleted_at, null, "not deleted on the server");
  });

  await step("Ana removes Ben; after confirmed membership checks Kai leaves Ben's device, his refused change is archived apart, and Ana's records are untouched", async () => {
    const before = await admin(`/rest/v1/entries?family_id=eq.${FA}&select=id,text,title,deleted_at,updated_at&order=id`);
    page = dA.p;
    await dA.u.click("Manage", ".child-circle button");
    await dA.p.waitFor(`[...document.querySelectorAll(".circle-manage li")].some(l => l.innerText.includes("Ben"))`, 5000, "Ben listed");
    await manageRow(dA.p, "Ben", `[...li.querySelectorAll("button")].find(b => b.textContent === "Remove from Circle").click(); return true;`);
    await dA.p.waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent === "Remove")`, 5000, "confirm");
    await dA.p.eval(`[...document.querySelectorAll("button")].filter(b => b.textContent === "Remove").at(-1).click(); true`);
    for (let i = 0; i < 20 && (await membership(FA, "c-kai", Ben)); i++) await sleep(250);
    assert.equal(await membership(FA, "c-kai", Ben), null);
    await dA.p.waitFor(`!document.querySelector(".circle-manage li") || ![...document.querySelectorAll(".circle-manage li")].some(l => l.innerText.includes("Ben"))`, 5000, "Ben gone from Manage");
    page = dB.p;
    // Ben is still on Kai's page: once the server refuses the circle, no names stay on his screen.
    for (let i = 0; i < 20 && (await circleText(dB.p)).includes("Ana"); i++) { await dB.p.eval(`window.dispatchEvent(new Event("focus"))`); await sleep(1000); }
    if (await dB.p.eval(`!!document.querySelector(".child-circle")`)) assert.ok(!(await circleText(dB.p)).includes("Ana"), "names taken off the screen");
    await until(dB.p, `!all("children").some(c => c.id === ${JSON.stringify(sid(FA, "c-kai"))}) && meta.scopes?.revoked?.[${JSON.stringify(sid(FA, "c-kai"))}]?.state === "done"`, "Kai removed from Ben's device");
    const db = await dB.u.dump(`rootmap-account-${Ben.id}`);
    assert.ok(!db.entries.some(e => e.familyId === FA) && !db.children.some(c => c.familyId === FA), "nothing of Kai left");
    assert.ok(!db.photoBlobs.some(b => b.id === photoA) && !db.photos.some(p => p.id === photoA), "Ana's photo bytes gone");
    const archived = db.archive.filter(a => a.source === `access-revoked:${FA}/c-kai`);
    assert.ok(archived.some(a => a.value.record?.text === "Ben tried as a viewer"), "the refused change is archived");
    assert.ok(!(await text(dB.p)).includes("Ben tried as a viewer"), "never shown");
    const after = await admin(`/rest/v1/entries?family_id=eq.${FA}&select=id,text,title,deleted_at,updated_at&order=id`);
    assert.deepEqual(after, before, "Ana's records unchanged by the removal");
    assert.ok((await serverRow("children", FA, "c-kai")).deleted_at === null);
    page = dA.p;
    assert.equal((await get(dA.p, "entries", "m-b1")).deletedAt, null, "Ben's Moment stays with Kai");
  }, /status of 403 \(Forbidden\) \S+\/rest\/v1\/rpc\/child_circle/);
  // A dev server like the others, but with a CAPTCHA site key: signing in loads the third-party script. Chrome serves
  // a stand-in for Cloudflare's script (nothing leaves this computer), and records what the browser sends with the
  // request for it.
  const captchaServer = await startServer({ VITE_ROOTMAP_SHARED_SYNC: "on", VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" });
  const dC = { p: await newDevice("multi-cy", 9404) };
  dC.u = ui(dC.p);
  page = dC.p;
  const thirdParty = [];
  await dC.p.send("Fetch.enable", { patterns: [{ urlPattern: "https://challenges.cloudflare.com/*" }] });
  const STAND_IN = `window.turnstile = { render(el, o) { window.__ts = o; return "w"; }, execute() { setTimeout(() => window.__ts.callback("stand-in-captcha-token"), 0); }, reset() {} };`;
  dC.p.handlers.add(m => {
    if (m.method !== "Fetch.requestPaused") return;
    thirdParty.push({ url: m.params.request.url, referer: m.params.request.headers.Referer ?? m.params.request.headers.referer ?? "" });
    void dC.p.send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/javascript" }], body: Buffer.from(STAND_IN).toString("base64") });
  });
  // What the page's address was at the moment the third-party script element was added (the script reads it then).
  await dC.p.send("Page.addScriptToEvaluateOnNewDocument", { source: `new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.tagName === "SCRIPT" && String(n.src).includes("challenges.cloudflare.com")) localStorage.setItem("test.addressWhenLoaded", location.href + " " + document.URL + " " + document.referrer); }).observe(document, { childList: true, subtree: true });` });
  const Cy = await newAccount("multi-cy");
  let cyInvite;
  await step("CAPTCHA isolation: the third-party script loads during sign-in with an invitation open; the address, Referer and request hold no token", async () => {
    page = dA.p;
    await openChild(dA.p, "c-kai");
    cyInvite = await createInvite(dA, "viewer");
    page = dC.p;
    await dC.p.nav(`${captchaServer.base}/#/invite/${cyInvite.token}`);
    await gate(dC.p);
    await dC.u.click("Continue with Email");
    await dC.p.waitFor(`document.querySelector("input[name=email]")`, 5000, "email step");
    await dC.u.type("input[name=email]", Cy.email);
    await dC.u.type("input[name=password]", PASSWORD);
    // Submitting asks for a CAPTCHA token first: the script is added to this page, then sign-in reloads it.
    const reloaded = dC.p.waitEvent("Page.loadEventFired", 20000);
    await dC.p.eval(`document.querySelector("form button[type=submit]").click(); true`);
    await reloaded;
    const address = (await dC.p.eval(`localStorage.getItem("test.addressWhenLoaded")`)) ?? "";
    await dC.p.eval(`localStorage.removeItem("test.addressWhenLoaded")`);
    assert.ok(address.includes("#/invite"), `recorded while the invitation was open (${address.replace(cyInvite.token, "<token>")})`);
    assert.ok(!address.includes(cyInvite.token), "no token in the address the script could read");
    assert.ok(thirdParty.length >= 1, "the CAPTCHA script was requested");
    for (const r of thirdParty) assert.ok(!r.url.includes(cyInvite.token) && !r.referer.includes(cyInvite.token), `the script's request: ${r.url}`);
    await dC.p.waitFor(`[...document.querySelectorAll(".invite-page button")].some(b => b.textContent === "Accept")`, 20000, "preview after the CAPTCHA sign-in");
    await dC.p.eval(`[...document.querySelectorAll(".invite-page button")].find(b => b.textContent === "Accept").click(); true`);
    await dC.p.waitFor(`document.querySelector(".child-profile .profile-hero")`, 20000, "Kai's profile");
    assert.equal(await dC.p.eval(`sessionStorage.getItem("rootmap.pending-invite")`), null, "forgotten once accepted");
    await until(dC.p, `all("entries").some(e => e.id === ${JSON.stringify(sid(FA, "m-a1"))})`, "Cy has the Moment");
    await dC.p.eval(`location.hash = "#/moment/" + encodeURIComponent(${JSON.stringify(sid(FA, "m-a1"))})`);
    await dC.p.waitFor(`document.querySelector(".journal-entry-text")`, 10000, "the Moment");
    await sleep(1500);
    assert.ok(!(await dC.p.eval(`!!document.querySelector(".kept-versions")`)), "someone else's kept version is never shown to a View Only member");
  });

  await step("Join notices follow the account, not the browser: on Cy's browser Ana sees 'Cy joined', Cy never does", async () => {
    page = dC.p;
    await kids(dC.p); await sleep(1000);
    assert.ok(!(await dC.p.eval(`!!document.querySelector(".circle-joins")`)), "Cy (View Only) gets none");
    await dC.u.signOut();
    await dC.u.openProfile();
    await dC.u.click("Sign in or create an account");
    await dC.u.welcomeShown();
    await dC.u.signInWithPassword(Ana.email);
    await kids(dC.p);
    await dC.p.waitFor(`document.querySelector(".circle-joins")?.innerText.includes("Cy joined Kai’s Circle.")`, 15000, "Ana's notice on this browser");
    assert.ok(!(await dC.p.eval(`document.querySelector(".circle-joins").innerText`)).includes("Ben"), "Ben's was dismissed on Ana's other browser");
    await dC.u.click("Done", ".circle-joins button");
    await dC.p.waitFor(`!document.querySelector(".circle-joins")`, 5000, "dismissed");
    page = dA.p;
    await kids(dA.p);
    await sleep(6000); // past the 5 s refresh throttle
    await dA.p.eval(`window.dispatchEvent(new Event("focus"))`);
    await sleep(1500);
    assert.ok(!(await dA.p.eval(`!!document.querySelector(".circle-joins")`)), "dismissed on one device, gone on the other");
  });
  await dC.p.close().catch(() => {});
  captchaServer.stop();
} catch (e) {
  console.log(`FAIL  (set-up) ${e.message}`);
  process.exitCode = 1;
} finally {
  for (const d of [dA, dB]) await d?.p.close().catch(() => {});
  server.stop();
}
process.exit(finish() || process.exitCode || 0);
