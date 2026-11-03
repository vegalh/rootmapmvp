// Shared Child Profiles stays switched off outside a development server (docs/shared-child-profiles-release-readiness.md
// section 11). Run with `npm run test:e2e:cloud` (the dev-server part uses the local Supabase stack).
//
// 1. Real production and staging builds (`vite build`), served by `vite preview`, built with every switch on —
//    VITE_ROOTMAP_CLOUD=on and VITE_ROOTMAP_SHARED_SYNC=on — against a made-up HTTPS project (production builds refuse
//    plain http): an invitation link opens nothing, its token leaves the address bar and is never sent anywhere.
// 2. A development server with cloud features on but VITE_ROOTMAP_SHARED_SYNC unset: a signed-in parent's child page
//    has no circle, an invitation link opens nothing, and no circle or invitation call is ever made.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API, PASSWORD, ROOT, SERVICE, newDevice, sleep, startServer, stepper, ui } from "./cloudkit.mjs";

let page;
const { step, finish } = stepper(() => page);
const TOKEN = "f".repeat(48);
const FAKE = "https://rootmap-flags-test.invalid";

async function built(mode) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), `rootmap-flags-${mode}-`));
  execFileSync(path.join(ROOT, "node_modules/.bin/vite"), ["build", "--mode", mode, "--outDir", out, "--emptyOutDir", "--logLevel", "error"], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VITE_ROOTMAP_CLOUD: "on", VITE_ROOTMAP_SHARED_SYNC: "on", VITE_SUPABASE_URL: FAKE, VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_flagstest", VITE_ROOTMAP_ANALYTICS: "", VITE_TURNSTILE_SITE_KEY: "" },
  });
  const port = 6100 + Math.floor(Math.random() * 800);
  const proc = spawn(path.join(ROOT, "node_modules/.bin/vite"), ["preview", "--outDir", out, "--port", String(port), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch { /* starting */ } await sleep(200); }
  return { base, out, stop: () => { proc.kill(); fs.rmSync(out, { recursive: true, force: true }); } };
}
function watch(p) {
  p.seen = [];
  p.handlers.add(m => { if (m.method === "Network.requestWillBeSent") p.seen.push({ url: m.params.request.url, body: m.params.request.postData ?? "" }); });
}

for (const mode of ["production", "staging"]) {
  const p = await newDevice(`flags-${mode}`, 9411);
  page = p;
  watch(p);
  await step(`A ${mode} build with VITE_ROOTMAP_SHARED_SYNC=on: an invitation link opens nothing and the token goes nowhere`, async () => {
    const site = await built(mode);
    try {
      const js = fs.readdirSync(path.join(site.out, "assets")).filter(f => f.endsWith(".js")).map(f => fs.readFileSync(path.join(site.out, "assets", f), "utf8")).join("\n");
      assert.ok(js.includes(FAKE), "the build really has cloud features on (made-up project)");
      // The test's own variables win over any .env.<mode>.local on this computer: no real project is in the build.
      assert.ok(!/https:\/\/[a-z0-9-]+\.supabase\.co/.test(js), "no real Supabase project address in the build");
      await p.nav(`${site.base}/#/invite/${TOKEN}`);
      await p.waitFor(`document.querySelector(".opening, .app-shell")`, 15000, "the app started");
      await sleep(1500);
      assert.ok(!(await p.eval(`!!document.querySelector(".invite-page")`)), "no invitation page");
      assert.ok(!(await p.eval(`location.hash`)).includes(TOKEN), `token left the address bar (${(await p.eval("location.hash")).replace(TOKEN, "<token>")})`);
      assert.ok(!p.seen.some(s => s.url.includes(TOKEN) || s.body.includes(TOKEN)), "token never sent");
      for (const s of p.seen.filter(s => /^https?:/.test(s.url))) assert.ok(["localhost", new URL(FAKE).hostname].includes(new URL(s.url).hostname), `request to ${new URL(s.url).hostname}`);
      assert.ok(!p.seen.some(s => s.url.startsWith(FAKE) && /rpc\/(get_invitation_preview|accept_invitation|child_circle)/.test(s.url)), "no sharing call");
    } finally {
      site.stop();
    }
  });
  await p.close().catch(() => {});
}

const server = await startServer({ VITE_ROOTMAP_SHARED_SYNC: "" });
const dev = await newDevice("flags-dev", 9412);
page = dev;
watch(dev);
try {
  await step("Development server, cloud on, sharing not switched on: no circle on a child's page, invitation links open nothing, no sharing calls", async () => {
    const email = `flags-${randomUUID()}@example.com`;
    const r = await fetch(`${API}/auth/v1/admin/users`, { method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { rootmap_password: true } }) });
    assert.ok(r.ok);
    const p = dev;
    const u = ui(p);
    {
      await p.nav(`${server.base}/`);
      await u.welcomeShown();
      await u.signInWithPassword(email);
      await u.appReady();
      const now = new Date().toISOString();
      assert.equal(await p.eval(`import("/src/lib/data/store.ts").then(S => S.write({ collections: { children: [{ id: "c-flag", first: "Flo", last: "Test", dob: "2022-01-01", enrolled: "", lessons: 0, group: "Primary", photo: "", createdAt: "${now}", updatedAt: "${now}", deletedAt: null, origin: "user", position: 100 }] } }, { rollback: true }))`), null);
      assert.equal(await p.eval(`import("/src/lib/sync/scopes.ts").then(S => S.sharedSyncEnabled)`), false);
      await p.eval(`location.hash = "#/child/c-flag"`);
      await p.waitFor(`document.querySelector(".child-profile .profile-hero")`, 10000, "child page");
      await sleep(1000);
      assert.ok(!(await p.eval(`!!document.querySelector(".child-circle")`)), "no circle");
      await p.nav("about:blank"); // a fresh load of the link, as when it is opened from a message
      await p.nav(`${server.base}/#/invite/${TOKEN}`);
      await u.appReady();
      await sleep(1000);
      assert.ok(!(await p.eval(`!!document.querySelector(".invite-page")`)), "no invitation page");
      assert.ok(!p.seen.some(s => /rpc\/(get_invitation_preview|accept_invitation|child_circle|list_invitations)/.test(s.url)), "no sharing call");
      assert.ok(!p.seen.some(s => s.url.includes("child_memberships")), "the old single-family sync: memberships never read");
    }
  });
} finally {
  await dev.close().catch(() => {});
  server.stop();
}
process.exit(finish());
