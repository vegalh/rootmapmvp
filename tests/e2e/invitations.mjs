// Invitations (Shared Child Profiles Phase 4), in the real app, with real browsers per person against the local
// Supabase stack. Sharing is switched on only for this dev server (VITE_ROOTMAP_SHARED_SYNC=on, development builds
// only). Run with `npm run test:e2e:cloud`.
//
// Lin manages Mia's profile and invites others to it by link, rather than the server granting membership directly
// (that is still covered by circle.mjs). This file exercises the link itself: generating it, the deep link before
// and after sign-in, acceptance and its effects, and the ways a link can stop working (single-use, expired,
// revoked, the wrong account).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { API, PASSWORD, SERVICE, admin, newDevice, sleep, startServer, stepper, ui } from "./cloudkit.mjs";

const server = await startServer({ VITE_ROOTMAP_SHARED_SYNC: "on" });
const BASE = server.base;
let page;
const { step, finish } = stepper(() => page);

const SEP = "\u001f";
const sid = (familyId, id) => `${familyId}${SEP}${id}`;
const now = () => new Date().toISOString();
const rec = r => ({ createdAt: now(), updatedAt: now(), deletedAt: null, origin: "user", position: 100, ...r });
const child = (id, first) => rec({ id, first, last: "Test", dob: "2022-05-01", enrolled: "", lessons: 0, group: "Primary", photo: "" });
const entry = (id, childId, text, photos = []) => rec({ id, childId, date: "2026-10-20", title: "", text, photos });

const store = (p, body) => p.eval(`import("/src/lib/data/store.ts").then(async S => { ${body} })`);
const write = (p, collections) => store(p, `return S.write({ collections: ${JSON.stringify(collections)} }, { rollback: true });`);
const syncNow = p => p.eval(`window.dispatchEvent(new Event("online"))`);
async function until(p, cond, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const ok = await p.eval(`import("/src/lib/data/store.ts").then(S => { const all = c => S.getCollection(c); return !!(${cond}); })`);
    if (ok) return;
    await syncNow(p);
    await sleep(500);
  }
  throw new Error(`timed out: ${label}`);
}
const status = p => p.eval(`import("/src/lib/sync/runner.ts").then(R => R.syncStatus())`);
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
// A profile row only exists once its owner signs in for the first time (account.ts upserts one, leaving an
// existing row's display_name untouched). Creating it ahead of that, with the name already set, means everyone's
// name is in place no matter which step first signs them in.
async function upsertProfile(userId, displayName) {
  await fetch(`${API}/rest/v1/profiles`, {
    method: "POST",
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ user_id: userId, display_name: displayName }),
  });
}
const newAccount = async label => {
  const email = `${label}-${randomUUID()}@example.com`;
  const user = await rest("POST", "/auth/v1/admin/users", { email, password: PASSWORD, email_confirm: true, user_metadata: { rootmap_password: true } });
  return { email, id: user.id };
};
const grant = (familyId, childId, user, role) => rest("POST", "/rest/v1/child_memberships", { family_id: familyId, child_id: childId, user_id: user.id, role });
const membership = (familyId, childId, user) => rest("GET", `/rest/v1/child_memberships?family_id=eq.${familyId}&child_id=eq.${childId}&user_id=eq.${user.id}&select=*`).then(rows => rows[0] ?? null);

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
async function openChild(p, id) {
  await p.eval(`location.hash = "#/child/" + encodeURIComponent(${JSON.stringify(id)})`);
  await p.waitFor(`document.querySelector(".child-profile .profile-hero")`, 10000, "child page");
}
const kids = async p => { await p.eval(`location.hash = "#/kids"`); await p.waitFor(`document.querySelector(".children-page")`, 10000, "My Children"); };
// Waits past the invite page's "checking" phase (get_invitation_preview resolving) to whatever it settles on, so a
// slow round trip never races the assertion that follows.
async function waitInvite(p, timeout = 10000) {
  await p.waitFor(`document.querySelector(".invite-page") && !document.body.innerText.includes(${JSON.stringify("Opening your invitation")})`, timeout, "invite page settled");
}

// Opens Mia's Manage Circle sheet (the Owner only), fills in the invite form and hands back the token straight from
// the clipboard — the same way a real parent would copy it, and the only place the raw link ever appears, so the
// test never reads it off the page's text.
async function createInvite(d, { role = "editor", email = "" } = {}) {
  await d.p.waitFor(`[...document.querySelectorAll(".child-circle button")].some(b => b.textContent === "Manage")`, 10000, "Manage button (the circle has loaded)");
  await d.p.eval(`[...document.querySelectorAll(".child-circle button")].find(b => b.textContent === "Manage")?.click(); true`);
  await d.p.waitFor(`document.querySelector(".circle-manage")`, 5000, "Manage sheet");
  await d.p.eval(`[...document.querySelectorAll(".circle-invite button")].find(b => b.textContent === "Invite Someone")?.click(); true`);
  await d.p.waitFor(`document.querySelector(".invite-form")`, 5000, "invite form");
  if (role === "viewer") await d.p.eval(`[...document.querySelectorAll(".invite-form .segmented button")].find(b => b.textContent === "View Only").click(); true`);
  if (email) await d.u.type(".invite-form input[type=email]", email);
  await d.p.eval(`window.__copied = null; navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; true`);
  await d.p.eval(`[...document.querySelectorAll(".invite-form button")].find(b => b.textContent === "Create Invitation Link").click(); true`);
  await d.p.waitFor(`document.querySelector(".invite-link-ready")`, 10000, "link ready");
  const sheetText = await d.p.eval(`document.querySelector(".circle-manage").innerText`);
  assert.ok(!sheetText.includes("http"), "the raw link is never shown as page text");
  await d.p.eval(`[...document.querySelectorAll(".invite-link-ready button")].find(b => b.textContent === "Copy Link").click(); true`);
  await d.p.waitFor(`window.__copied`, 5000, "link copied");
  const link = await d.p.eval(`window.__copied`);
  const token = new URL(link).hash.split("/invite/")[1];
  assert.ok(token && token.length > 20, `a real token (got "${token}")`);
  const id = await d.p.eval(`import("/src/lib/cloud/client.ts").then(async C => { const client = await C.getCloudClient(); const { data } = await client.rpc("list_invitations", { p_family_id: ${JSON.stringify(d.familyId)}, p_child_id: "c-mia" }); return data[0].id; })`);
  // list_invitations (above) has already settled, so the pending list below has too — read it before closing, since
  // the raw link is the only thing that disappears from the sheet, not the pending-invite summary itself.
  await d.p.waitFor(`document.querySelector(".invite-pending")`, 5000, "pending list");
  const pendingText = await d.p.eval(`document.querySelector(".invite-pending")?.innerText ?? ""`);
  await d.p.eval(`[...document.querySelectorAll("button")].find(b => b.textContent === "Done")?.click(); true`);
  return { token, id, pendingText };
}

const Lin = await newAccount("inv-lin"), Nina = await newAccount("inv-nina"), Priya = await newAccount("inv-priya"), Quinn = await newAccount("inv-quinn"), Visitor = await newAccount("inv-visitor");
let dL, dN, dP, dQ, dV, FL;

try {
  dL = await signedIn("inv-lin", 9391, Lin);
  FL = dL.familyId;
  for (const [a, name] of [[Lin, "Lin"], [Nina, "Nina"], [Priya, "Priya"]]) await upsertProfile(a.id, name);

  await step("Set-up: Mia, with a Moment, managed by Lin", async () => {
    page = dL.p;
    assert.equal(await write(dL.p, { children: [child("c-mia", "Mia")] }), null);
    assert.equal(await write(dL.p, { entries: [entry("m-1", "c-mia", "Mia's first Moment")] }), null);
    await backedUp(dL.p, "Lin backed up");
  });

  let openInvite;
  await step("Owner creates an invitation (Add & Edit, no email restriction); the link only ever reaches the clipboard", async () => {
    page = dL.p;
    await openChild(dL.p, "c-mia");
    openInvite = await createInvite(dL, { role: "editor" });
    assert.ok(openInvite.pendingText.includes("Add & Edit") && openInvite.pendingText.includes("Expires"), openInvite.pendingText || "(empty)");
  });

  await step("An Editor cannot invite: no Manage button, and the server refuses the call directly too", async () => {
    await grant(FL, "c-mia", Nina, "editor");
    dN = await signedIn("inv-nina", 9392, Nina);
    page = dN.p;
    // Mia has to reach Nina's device first: an address for a child the device doesn't have opens My Children instead.
    await until(dN.p, `all("children").some(c => c.id === ${JSON.stringify(sid(FL, "c-mia"))})`, "Mia reached Nina's device");
    await openChild(dN.p, sid(FL, "c-mia"));
    await dN.p.waitFor(`document.querySelector(".child-circle")`, 10000, "circle shown");
    assert.ok(!(await dN.p.eval(`!!([...document.querySelectorAll(".child-circle button")].find(b => b.textContent === "Manage"))`)), "no Manage button for an editor");
    const refused = await dN.p.eval(`import("/src/lib/cloud/client.ts").then(async C => { const client = await C.getCloudClient(); const { error } = await client.rpc("create_invitation", { p_family_id: ${JSON.stringify(FL)}, p_child_id: "c-mia", p_role: "viewer" }); return !!error; })`);
    assert.ok(refused, "create_invitation refused for an editor");
    await rest("DELETE", `/rest/v1/child_memberships?family_id=eq.${FL}&child_id=eq.c-mia&user_id=eq.${Nina.id}`);
  });

  await step("Deep link, signed out: no child details leak before authentication; sign in restores the same invitation", async () => {
    await dN.p.close().catch(() => {});
    const p = await newDevice("inv-nina-fresh", 9393);
    dN = { p, u: ui(p) };
    page = dN.p;
    await dN.p.nav(`${BASE}/#/invite/${openInvite.token}`);
    await dN.p.waitFor(`document.querySelector("input[name=email]") || document.body.innerText.includes("Welcome to RootMap")`, 15000, "the sign-in gate");
    assert.ok(!(await text(dN.p)).includes("Mia"), "no child name before sign-in");
    await dN.u.signInWithPassword(Nina.email);
    await waitInvite(dN.p, 15000);
    const preview = await text(dN.p);
    assert.ok(preview.includes("Join Mia’s Circle"), preview);
    assert.ok(preview.includes("Invited by Lin"), preview);
    assert.ok(preview.includes("Can add, edit, and organize the child’s shared growth records."), preview);
    dN.familyId = FL;
  });

  await step("Accepting: membership made, a full sync brings Mia and her Moment, no duplicate child, My Children shows her, and the token leaves the address bar", async () => {
    page = dN.p;
    await dN.p.eval(`[...document.querySelectorAll(".invite-page button")].find(b => b.textContent === "Accept").click(); true`);
    await dN.p.waitFor(`document.querySelector(".child-profile .profile-hero")`, 20000, "Mia's profile opened");
    assert.equal(await dN.p.eval(`location.hash`), `#/child/${encodeURIComponent(sid(FL, "c-mia"))}`, "navigated to Mia, not left on the invite hash");
    await dN.p.eval(`history.back()`); await sleep(400);
    assert.ok(!(await dN.p.eval(`location.hash`)).includes("/invite/"), "back doesn't return to the spent invite link");
    await dN.p.eval(`history.forward()`); await sleep(400);
    const m = await membership(FL, "c-mia", Nina);
    assert.equal(m.role, "editor");
    await kids(dN.p);
    assert.ok((await text(dN.p)).includes("Mia"), "Mia shown in My Children");
    assert.equal((await rest("GET", `/rest/v1/children?family_id=eq.${FL}&id=eq.c-mia&select=id`)).length, 1, "no duplicate child server-side");
    await until(dN.p, `all("entries").some(e => e.id === ${JSON.stringify(sid(FL, "m-1"))})`, "Nina received Mia's existing Moment (full initial sync)");
  });

  await step("Single-use: opening the same link again shows it's already been used, and nothing is accepted a second time", async () => {
    await dN.p.eval(`location.hash = "#/invite/${openInvite.token}"`);
    await waitInvite(dN.p, 10000);
    assert.ok((await text(dN.p)).includes("This invitation has already been used."));
    assert.ok(!(await dN.p.eval(`!!([...document.querySelectorAll(".invite-page button")].find(b => b.textContent === "Accept"))`)));
  });

  let expiredInvite, revokedInvite;
  await step("Expired invitation: a gentle explanation, not an error; cannot be accepted", async () => {
    page = dL.p;
    await openChild(dL.p, "c-mia");
    expiredInvite = await createInvite(dL, { role: "viewer" });
    await rest("PATCH", `/rest/v1/child_invitations?id=eq.${expiredInvite.id}`, { expires_at: "2000-01-01T00:00:00Z" });
    dV = await signedIn("inv-visitor", 9394, Visitor);
    page = dV.p;
    await dV.p.eval(`location.hash = "#/invite/${expiredInvite.token}"`);
    await waitInvite(dV.p, 10000);
    assert.ok((await text(dV.p)).includes("This invitation has expired. Ask them for a new link."));
    assert.ok(!(await dV.p.eval(`!!([...document.querySelectorAll(".invite-page button")].find(b => b.textContent === "Accept"))`)));
  });

  await step("Revoked invitation: cancelling it from Manage makes the link unavailable; cannot be accepted", async () => {
    page = dL.p;
    await openChild(dL.p, "c-mia");
    revokedInvite = await createInvite(dL, { role: "editor" });
    await dL.p.waitFor(`[...document.querySelectorAll(".child-circle button")].some(b => b.textContent === "Manage")`, 10000, "Manage button");
    await dL.p.eval(`[...document.querySelectorAll(".child-circle button")].find(b => b.textContent === "Manage")?.click(); true`);
    await dL.p.waitFor(`document.querySelector(".invite-pending")`, 5000, "pending invitations");
    await dL.p.eval(`[...document.querySelectorAll(".invite-pending button")][0]?.click(); true`);
    await dL.p.waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent === "Cancel Invitation")`, 5000, "confirm cancel");
    await dL.p.eval(`[...document.querySelectorAll("button")].filter(b => b.textContent === "Cancel Invitation").at(-1).click(); true`);
    await dL.p.waitFor(`document.querySelector(".invite-pending")?.innerText.includes("Canceled")`, 5000, "the pending list shows it canceled");
    await dL.p.eval(`[...document.querySelectorAll("button")].find(b => b.textContent === "Done")?.click(); true`);
    page = dV.p;
    await dV.p.eval(`location.hash = "#/invite/${revokedInvite.token}"`);
    await waitInvite(dV.p, 10000);
    assert.ok((await text(dV.p)).includes("This invitation is no longer available."));
    assert.ok(!(await dV.p.eval(`!!([...document.querySelectorAll(".invite-page button")].find(b => b.textContent === "Accept"))`)));
  });

  await step("Declining (Not Now): Today opens, the token is in no history entry, and the invitation stays pending", async () => {
    page = dL.p;
    await openChild(dL.p, "c-mia");
    const declined = await createInvite(dL, { role: "viewer" });
    page = dV.p;
    await dV.p.eval(`location.hash = "#/invite/${declined.token}"`);
    await waitInvite(dV.p, 10000);
    await dV.p.eval(`[...document.querySelectorAll(".invite-page button")].find(b => b.textContent === "Not Now").click(); true`);
    await dV.p.waitFor(`location.hash === "#/today"`, 5000, "Today");
    const history = await dV.p.send("Page.getNavigationHistory");
    assert.ok(history.entries.every(e => !e.url.includes(declined.token)), "no history entry holds the token");
    const row = await rest("GET", `/rest/v1/child_invitations?id=eq.${declined.id}&select=accepted_at,revoked_at`);
    assert.deepEqual(row, [{ accepted_at: null, revoked_at: null }], "still pending: declining sends nothing");
    await rest("PATCH", `/rest/v1/child_invitations?id=eq.${declined.id}`, { revoked_at: new Date().toISOString() });
  });

  let restrictedInvite;
  await step("Email-restricted invitation, wrong account: a note that doesn't name the child or the restricted email, and a way to switch accounts", async () => {
    page = dL.p;
    await openChild(dL.p, "c-mia");
    restrictedInvite = await createInvite(dL, { role: "viewer", email: Priya.email });
    dQ = await signedIn("inv-quinn", 9395, Quinn);
    page = dQ.p;
    await dQ.p.eval(`location.hash = "#/invite/${restrictedInvite.token}"`);
    await waitInvite(dQ.p, 10000);
    const seen = await text(dQ.p);
    assert.ok(seen.includes("This invitation is for a different email address."));
    assert.ok(!seen.includes("Mia") && !seen.includes(Priya.email), "no child or restricted email leaked to the wrong account");
    const refused = await dQ.p.eval(`import("/src/lib/cloud/client.ts").then(async C => { const client = await C.getCloudClient(); const { data } = await client.rpc("accept_invitation", { p_token: ${JSON.stringify(restrictedInvite.token)} }); return data[0].status; })`);
    assert.equal(refused, "wrong_email", "the server itself refuses, not just the screen");
    await dQ.p.eval(`[...document.querySelectorAll(".invite-page button")].find(b => b.textContent === "Sign In With a Different Account").click(); true`);
    await dQ.p.waitFor(`document.querySelector("input[name=email]") || document.body.innerText.includes("Welcome to RootMap")`, 15000, "signed out, back at sign-in");
    assert.ok((await dQ.p.eval(`location.hash`)).includes(`/invite/${restrictedInvite.token}`), "the same invitation is still the one being opened");
    assert.ok(!(await text(dQ.p)).includes("Mia"), "still nothing about the child while signed out");
  });

  await step("Email-restricted invitation, matching account: preview and acceptance both succeed", async () => {
    const p = await newDevice("inv-priya", 9396);
    dP = { p, u: ui(p) };
    page = dP.p;
    await dP.p.nav(`${BASE}/#/invite/${restrictedInvite.token}`);
    await dP.p.waitFor(`document.querySelector("input[name=email]") || document.body.innerText.includes("Welcome to RootMap")`, 15000, "sign-in gate");
    await dP.u.signInWithPassword(Priya.email);
    await waitInvite(dP.p, 15000);
    assert.ok((await text(dP.p)).includes("Can view the child’s shared growth records but cannot make changes."));
    await dP.p.eval(`[...document.querySelectorAll(".invite-page button")].find(b => b.textContent === "Accept").click(); true`);
    await dP.p.waitFor(`document.querySelector(".child-profile .profile-hero")`, 20000, "Mia's profile opened");
    assert.equal((await membership(FL, "c-mia", Priya)).role, "viewer");
    dP.familyId = FL;
  });

  await step("Manage: changing a member's role, and removing a member, through the Circle UI", async () => {
    page = dL.p;
    // Lin's page has stayed on Mia since before Priya joined on her own device. The circle catches up when the page
    // comes back to the front (release readiness: no navigating away and back).
    assert.equal(await dL.p.eval(`location.hash`), "#/child/c-mia");
    for (let i = 0; i < 20 && !(await dL.p.eval(`document.querySelector(".child-circle")?.innerText ?? ""`)).includes("Priya"); i++) {
      await dL.p.eval(`window.dispatchEvent(new Event("focus"))`);
      await sleep(1000);
    }
    assert.ok((await dL.p.eval(`document.querySelector(".child-circle").innerText`)).includes("Priya"), "Priya shown without navigating");
    await dL.p.waitFor(`[...document.querySelectorAll(".child-circle button")].some(b => b.textContent === "Manage")`, 10000, "Manage button");
    await dL.p.eval(`[...document.querySelectorAll(".child-circle button")].find(b => b.textContent === "Manage")?.click(); true`);
    await dL.p.waitFor(`document.querySelector(".circle-manage")`, 5000, "Manage sheet");
    await dL.p.waitFor(`[...document.querySelectorAll(".circle-manage li")].some(l => l.innerText.includes("Nina"))`, 5000, "Nina listed");
    await dL.p.eval(`(() => { const li = [...document.querySelectorAll(".circle-manage li")].find(l => l.innerText.includes("Nina")); const s = li.querySelector("select"); const set = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set; set.call(s, "viewer"); s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
    await sleep(600);
    assert.equal((await membership(FL, "c-mia", Nina)).role, "viewer", "role changed to View Only");
    await dL.p.eval(`(() => { const li = [...document.querySelectorAll(".circle-manage li")].find(l => l.innerText.includes("Priya")); [...li.querySelectorAll("button")].find(b => b.textContent === "Remove from Circle").click(); return true; })()`);
    await dL.p.waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent === "Remove")`, 5000, "confirm removal");
    await dL.p.eval(`[...document.querySelectorAll("button")].filter(b => b.textContent === "Remove").at(-1).click(); true`);
    await sleep(600);
    assert.equal(await membership(FL, "c-mia", Priya), null, "Priya's membership is gone");
    page = dP.p;
    // Priya's page is still on Mia: once the server refuses the circle, nobody's name stays on her screen.
    for (let i = 0; i < 20 && (await dP.p.eval(`document.querySelector(".child-circle")?.innerText ?? ""`)).includes("Lin"); i++) {
      await dP.p.eval(`window.dispatchEvent(new Event("focus"))`);
      await sleep(1000);
    }
    assert.ok(!(await dP.p.eval(`document.querySelector(".child-circle")?.innerText ?? ""`)).includes("Lin"), "names taken off a removed member's screen");
    await until(dP.p, `!all("children").some(c => c.id === ${JSON.stringify(sid(FL, "c-mia"))})`, "Mia removed from Priya's device (revocation cleanup)");
  }, /status of 403 \(Forbidden\) \S+\/rest\/v1\/rpc\/child_circle/);

  await step("Circle refresh: a relationship Lin sets for Nina, and Nina's new access, show on Nina's open circle", async () => {
    page = dN.p;
    await openChild(dN.p, sid(FL, "c-mia"));
    await dN.p.waitFor(`document.querySelector(".child-circle")?.innerText.includes("View Only")`, 30000, "Nina's line follows her new access");
    const ok = await dL.p.eval(`import("/src/lib/cloud/client.ts").then(async C => { const c = await C.getCloudClient(); const { error } = await c.rpc("set_circle_relationship", { p_family_id: ${JSON.stringify(FL)}, p_child_id: "c-mia", p_user_id: ${JSON.stringify(Nina.id)}, p_relationship: "teacher" }); return !error; })`);
    assert.ok(ok, "Lin set the relationship");
    // The list's own label, not the relationship picker's options (which always include "Teacher").
    const shown = () => dN.p.eval(`[...document.querySelectorAll(".child-circle .circle-people small")].some(s => s.textContent === "Teacher")`);
    for (let i = 0; i < 20 && !(await shown()); i++) {
      await dN.p.eval(`document.dispatchEvent(new Event("visibilitychange"))`);
      await sleep(1000);
    }
    assert.ok(await shown(), "shown without navigating");
  });

  await step("Leaving the Circle: an editor-turned-viewer leaves on her own; server access and the local copy are both gone", async () => {
    page = dN.p;
    await openChild(dN.p, sid(FL, "c-mia"));
    await dN.p.waitFor(`[...document.querySelectorAll(".child-circle button")].some(b => b.textContent === "Leave the Circle")`, 10000, "Leave the Circle button (the circle has loaded)");
    await dN.p.eval(`[...document.querySelectorAll(".child-circle button")].find(b => b.textContent === "Leave the Circle").click(); true`);
    await dN.p.waitFor(`[...document.querySelectorAll("button")].some(b => b.textContent === "Leave")`, 5000, "confirm leaving");
    await dN.p.eval(`[...document.querySelectorAll("button")].filter(b => b.textContent === "Leave").at(-1).click(); true`);
    await sleep(600);
    assert.equal(await membership(FL, "c-mia", Nina), null, "Nina's membership is gone");
    await until(dN.p, `!all("children").some(c => c.id === ${JSON.stringify(sid(FL, "c-mia"))})`, "Mia removed from Nina's device after leaving");
    await kids(dN.p);
    assert.ok(!(await text(dN.p)).includes("Mia"), "Mia no longer in My Children");
    assert.equal((await rest("GET", `/rest/v1/children?family_id=eq.${FL}&id=eq.c-mia&select=id,deleted_at`))[0].deleted_at ?? null, null, "Mia's own data is untouched");
  });
} catch (e) {
  console.log(`FAIL  (set-up) ${e.message}`);
  process.exitCode = 1;
} finally {
  for (const d of [dL, dN, dP, dQ, dV]) await d?.p.close().catch(() => {});
  server.stop();
}
process.exit(finish() || process.exitCode || 0);
