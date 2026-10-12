// The app with cloud features ON, against the local Supabase stack (Phase 2B-2 M1). Needs Docker and the stack
// (`npm run db:start`); run with `npm run test:e2e:cloud`. Not part of `npm run test:e2e`, which needs no stack.
//
// Checks, in a real browser: start-up with no session makes no request and looks exactly as before; email-code
// sign-in through the app's own module creates the family and profile; a reload restores the session; sign-out
// removes it. Local data (IndexedDB) is identical throughout: signing in uploads and changes nothing.
import { execFileSync, spawn } from "node:child_process";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { HELPERS, launch } from "./cdp.mjs";
import { tempProfile } from "./env.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const API = status.API_URL;
const MAIL = status.MAILPIT_URL ?? status.INBUCKET_URL;
const KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
const SERVICE = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
for (const u of [API, MAIL]) if (!["127.0.0.1", "localhost"].includes(new URL(u).hostname)) throw new Error(`refusing non-local stack ${u}`);

// A dev server with cloud features on (environment "local").
const port = 5100 + Math.floor(Math.random() * 800);
const server = spawn(path.join(ROOT, "node_modules/.bin/vite"), ["--port", String(port), "--strictPort"], {
  cwd: ROOT, stdio: "ignore",
  env: { ...process.env, VITE_ROOTMAP_CLOUD: "on", VITE_SUPABASE_URL: API, VITE_SUPABASE_PUBLISHABLE_KEY: KEY },
});
const BASE = `http://localhost:${port}`;
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* starting */ }
  await new Promise(r => setTimeout(r, 200));
}

const page = await launch(tempProfile("cloud"), 9345);
await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
const results = [];
async function step(name, fn) {
  const errorsBefore = page.errors.length;
  try {
    await fn();
    const newErrors = page.errors.slice(errorsBefore);
    if (newErrors.length) throw new Error(`console errors: ${newErrors.join(" | ")}`);
    results.push(["PASS", name]);
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
    console.log(`FAIL  ${name}\n      ${e.message.split("\n").join("\n      ")}`);
  }
}
const appReady = () => page.waitFor(`document.querySelector(".app-shell") && document.querySelector(".bottom-nav, .page-content, main")`, 15000, "app rendered");
const cloud = body => page.eval(`import("/src/lib/cloud/session.ts").then(async C => { ${body} })`);
const cloudRequests = () => page.eval(`performance.getEntriesByType("resource").filter(r => r.name.startsWith(${JSON.stringify(API)})).map(r => r.name.replace(${JSON.stringify(API)}, ""))`);
const dumpLocal = () => page.eval(`__t.dump().then(d => JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k === "settings" ? v.map(({ updatedAt, ...s }) => s) : v]))))`);
const appKeys = () => page.eval(`Object.keys(__t.ls()).filter(k => !k.startsWith("rootmap.session:")).sort()`);
const sessionKeys = () => page.eval(`Object.keys(__t.ls()).filter(k => k.startsWith("rootmap.session:"))`);

async function codeFor(email) {
  for (let i = 0; i < 100; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    if (list.messages?.length) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${list.messages[0].ID}`)).json();
      return String(msg.Text).match(/\b(\d{6})\b/)[1];
    }
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error("no code email");
}

const email = `browser-${randomUUID()}@example.com`;
let localBefore, keysBefore, familyId;

try {
  await page.nav(`${BASE}/`);
  await appReady();
  await page.waitFor(`import("/src/lib/cloud/session.ts").then(C => C.cloudState().status === "signed-out")`, 10000, "cloud started, signed out");

  await step("Cloud on, no session: the app looks as before and makes no request to the server", async () => {
    assert.ok(await page.eval(`document.body.innerText.includes("Maya")`));
    assert.deepEqual(await cloudRequests(), []);
    assert.deepEqual(await sessionKeys(), []);
    localBefore = await dumpLocal();
    keysBefore = await appKeys();
  });

  await step("Email-code sign-in from the app creates the family and profile; local data is unchanged", async () => {
    assert.deepEqual(await cloud(`return C.sendSignInCode(${JSON.stringify(email)});`), { ok: true });
    const code = await codeFor(email);
    const r = await cloud(`return C.confirmSignInCode(${JSON.stringify(email)}, ${JSON.stringify(code)});`);
    assert.equal(r.ok, true);
    familyId = r.value.account.familyId;
    assert.match(familyId, /^[0-9a-f-]{36}$/);
    const state = await cloud(`return C.cloudState();`);
    assert.equal(state.status, "signed-in");
    assert.equal(state.account.familyId, familyId);
    assert.deepEqual(await sessionKeys(), ["rootmap.session:auth"]);
    // Nothing local changed, and no app data was sent: only auth, the membership check, create_family and the profile.
    assert.equal(await dumpLocal(), localBefore);
    assert.deepEqual(await appKeys(), keysBefore);
    const paths = (await cloudRequests()).map(p => p.split("?")[0]);
    for (const p of paths) assert.match(p, /^\/(auth\/v1\/(otp|verify)|rest\/v1\/(family_members|rpc\/create_family|profiles))$/, `unexpected request ${p}`);
    const admin = await fetch(`${API}/rest/v1/children?family_id=eq.${familyId}&select=id`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
    assert.deepEqual(await admin.json(), [], "no children uploaded");
  });

  await step("A reload restores the session and confirms the same family; the screens are unchanged", async () => {
    await page.reload();
    await appReady();
    await page.waitFor(`import("/src/lib/cloud/session.ts").then(C => C.cloudState().status === "signed-in" && C.cloudState().account)`, 10000, "restored");
    const state = await cloud(`return C.cloudState();`);
    assert.equal(state.user.email, email);
    assert.equal(state.account.familyId, familyId);
    assert.equal(state.offline, false);
    assert.ok(await page.eval(`document.body.innerText.includes("Maya")`));
    assert.equal(await dumpLocal(), localBefore);
  });

  await step("Sign-out removes the session from the browser and keeps local data", async () => {
    assert.deepEqual(await cloud(`return C.signOutHere();`), { serverRevoked: true });
    assert.equal((await cloud(`return C.cloudState();`)).status, "signed-out");
    assert.deepEqual(await sessionKeys(), []);
    assert.equal(await dumpLocal(), localBefore);
    await page.reload();
    await appReady();
    await page.waitFor(`import("/src/lib/cloud/session.ts").then(C => C.cloudState().status === "signed-out")`, 10000, "still signed out after reload");
  });
} finally {
  await page.close();
  server.kill();
}
const failedSteps = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failedSteps.length}/${results.length} passed`);
process.exit(failedSteps.length ? 1 : 0);
