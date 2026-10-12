// The app with cloud features ON, against the local Supabase stack (Phase 2B-2 M1 and M2). Needs Docker and the
// stack (`npm run db:start`); run with `npm run test:e2e:cloud`. Not part of `npm run test:e2e`, which needs no stack.
//
// Drives the real screens: Welcome on a new device (English and Chinese), email + 6-digit code sign-in (new and
// returning account, wrong, expired, offline), session restore after a reload, sign-out from Profile, "Continue
// without an account", and a device with RootMap data opening straight into the app. Local data (IndexedDB) is
// compared before and after every step: signing in or out uploads, moves and changes nothing.
import { execFileSync, spawn } from "node:child_process";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { tempProfile } from "./env.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const API = status.API_URL;
const MAIL = status.MAILPIT_URL ?? status.INBUCKET_URL;
const DB_URL = status.DB_URL;
const KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
const SERVICE = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
for (const u of [API, MAIL, DB_URL]) if (!["127.0.0.1", "localhost"].includes(new URL(u).hostname)) throw new Error(`refusing non-local stack ${u}`);

// A dev server with cloud features on (environment "local").
const port = 5100 + Math.floor(Math.random() * 800);
const server = spawn(path.join(ROOT, "node_modules/.bin/vite"), ["--port", String(port), "--strictPort"], {
  cwd: ROOT, stdio: "ignore",
  env: { ...process.env, VITE_ROOTMAP_CLOUD: "on", VITE_SUPABASE_URL: API, VITE_SUPABASE_PUBLISHABLE_KEY: KEY },
});
const BASE = `http://localhost:${port}`;
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* starting */ }
  await sleep(200);
}

const results = [];
let page;
// `expected`: console errors this step causes on purpose (a rejected code, a request made while offline).
async function step(name, fn, expected) {
  const errorsBefore = page.errors.length;
  try {
    await fn();
    const newErrors = page.errors.slice(errorsBefore).filter(e => !(expected && expected.test(e)));
    if (newErrors.length) throw new Error(`console errors: ${newErrors.join(" | ")}`);
    results.push(["PASS", name]);
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
    console.log(`FAIL  ${name}\n      ${e.message.split("\n").join("\n      ")}`);
  }
}

// One browser profile per simulated device.
async function newDevice(name, devtoolsPort, setup) {
  const p = await launch(tempProfile(name), devtoolsPort);
  await p.send("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
  if (setup) await p.send("Page.addScriptToEvaluateOnNewDocument", { source: setup });
  return p;
}

const text = () => page.eval(`document.body.innerText`);
const has = s => page.eval(`document.body.innerText.includes(${JSON.stringify(s)})`);
const click = (label, selector = "button") => page.eval(`__t.click(${JSON.stringify(label)}, ${JSON.stringify(selector)})`);
const type = (selector, value) => page.eval(`__t.type(${JSON.stringify(selector)}, ${JSON.stringify(value)})`);
const cloudState = () => page.eval(`import("/src/lib/cloud/session.ts").then(C => C.cloudState())`);
const waitCloud = (status, label = status) => page.waitFor(`import("/src/lib/cloud/session.ts").then(C => C.cloudState().status === ${JSON.stringify(status)})`, 10000, label);
const appReady = () => page.waitFor(`document.querySelector(".app-shell") && document.querySelector(".bottom-nav, .page-content, main")`, 15000, "app rendered");
const welcomeShown = () => page.waitFor(`document.querySelector(".opening") && document.body.innerText.includes(${JSON.stringify("Welcome to RootMap")})`, 15000, "Welcome shown");
const openProfile = async () => { await page.eval(`[...document.querySelectorAll(".bottom-nav button")].at(-1).click()`); await page.waitFor(`document.querySelector(".profile-page")`, 5000, "Profile"); };
const cloudRequests = () => page.eval(`performance.getEntriesByType("resource").filter(r => r.name.startsWith(${JSON.stringify(API)})).map(r => r.name.replace(${JSON.stringify(API)}, "").split("?")[0])`);
// Everything stored locally except the device's Welcome flag (which records the parent's choice on this device).
const dumpLocal = () => page.eval(`__t.dump().then(d => JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k === "settings" ? v.filter(s => s.key !== "rootmap-welcome").map(({ updatedAt, ...s }) => s) : v]))))`);
const welcomeSetting = () => page.eval(`__t.all("settings").then(s => s.find(x => x.key === "rootmap-welcome")?.value ?? null)`);
const appKeys = () => page.eval(`Object.keys(__t.ls()).filter(k => !k.startsWith("rootmap.session:")).sort()`);
const sessionKeys = () => page.eval(`Object.keys(__t.ls()).filter(k => k.startsWith("rootmap.session:"))`);
const AUTH_ONLY = /^\/(auth\/v1\/(otp|verify|logout|token)|rest\/v1\/(family_members|rpc\/create_family|profiles))$/;

async function latestCode(email, after = 0) {
  for (let i = 0; i < 150; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    if ((list.messages?.length ?? 0) > after) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${list.messages[0].ID}`)).json();
      return String(msg.Text).match(/\b(\d{6})\b/)[1];
    }
    await sleep(50);
  }
  throw new Error("no code email");
}
const mailCount = async email => ((await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()).messages?.length ?? 0);

// Requests a code through the screens (Welcome → Create / I already have an account → email → Send code).
async function requestCode(entry, email) {
  await click(entry);
  await page.waitFor(`document.querySelector("input[name=email]")`, 5000, "email step");
  const before = await mailCount(email);
  await type("input[name=email]", email);
  await click("Send code");
  await page.waitFor(`document.querySelector("input[name=code]")`, 10000, "code step");
  return latestCode(email, before);
}
const errorShown = () => page.eval(`document.querySelector("[role=alert]")?.innerText ?? ""`);

const email = `parent-${randomUUID()}@example.com`;
let localBefore, keysBefore, userId, familyId;

try {
  // ---- Device 1: a new parent -------------------------------------------------------------------------------
  page = await newDevice("cloud-new", 9345);
  await page.nav(`${BASE}/`);
  await welcomeShown();
  await waitCloud("signed-out", "cloud started, signed out");

  await step("New device: Welcome is shown, without password, phone, WeChat, Apple or Google; nothing is sent", async () => {
    const t = await text();
    for (const s of ["Create an account", "I already have an account", "Continue without an account"]) assert.ok(t.includes(s), s);
    for (const s of ["WeChat", "Apple", "Google", "Password", "Phone"]) assert.ok(!t.includes(s), `${s} is hidden`);
    assert.equal(await page.eval(`document.querySelectorAll("input[type=password]").length`), 0);
    assert.deepEqual(await cloudRequests(), []);
    assert.deepEqual(await sessionKeys(), []);
    assert.equal(await welcomeSetting(), "pending");
  });

  await step("A reload during Welcome shows Welcome again", async () => {
    await page.reload();
    await welcomeShown();
  });

  await step("Chinese: Welcome and the email step, including its error message, are translated", async () => {
    await page.eval(`__t.click("中文")`);
    await page.waitFor(`document.body.innerText.includes("欢迎来到 RootMap")`, 3000, "zh welcome");
    for (const s of ["创建账户", "我已有账户", "暂不登录，直接使用"]) assert.ok(await has(s), s);
    await click("创建账户");
    for (const s of ["创建你的账户", "邮箱", "发送验证码"]) assert.ok(await has(s), s);
    await type("input[name=email]", "not-an-email");
    await click("发送验证码");
    assert.equal(await errorShown(), "请输入有效的邮箱地址。");
    await click("返回");
    await page.eval(`__t.click("EN")`);
    await page.waitFor(`document.body.innerText.includes("Welcome to RootMap")`, 3000, "en welcome");
    // From here on, nothing stored locally may change (the language switch above was the parent's own change).
    await sleep(300);
    localBefore = await dumpLocal();
    keysBefore = await appKeys();
  });

  await step("Create an account: an invalid email is explained and nothing is sent", async () => {
    await click("Create an account");
    await type("input[name=email]", "parent@");
    await click("Send code");
    assert.equal(await errorShown(), "Please enter a valid email address.");
    assert.deepEqual(await cloudRequests(), []);
    await click("Back");
  });

  await step("Offline: sending a code explains there is no connection; nothing is stored", async () => {
    await page.send("Network.enable");
    await page.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      await click("Create an account");
      await type("input[name=email]", email);
      await click("Send code");
      await page.waitFor(`document.querySelector("[role=alert]")`, 10000, "offline message");
      assert.match(await errorShown(), /Can’t connect right now/);
      assert.ok(await page.eval(`!!document.querySelector("input[name=email]")`), "still on the email step");
    } finally {
      await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    assert.deepEqual(await sessionKeys(), []);
    await click("Back");
  }, /ERR_INTERNET_DISCONNECTED|Failed to fetch/);

  let code;
  await step("Send code opens the code step for that address; a wrong code is explained and does not sign in", async () => {
    code = await requestCode("Create an account", email);
    assert.ok(await has(email));
    assert.ok(await has("New code in"), "resend waits");
    const wrong = code === "000000" ? "111111" : "000000";
    await type("input[name=code]", wrong);
    await page.waitFor(`document.querySelector("[role=alert]")`, 10000, "wrong-code message");
    assert.match(await errorShown(), /incorrect or has expired/);
    assert.equal((await cloudState()).status, "signed-out");
    assert.deepEqual(await sessionKeys(), []);
  }, /status of 403 .*\/auth\/v1\/verify/);

  await step("The right code signs in (new account): family and profile are created; nothing local is uploaded or changed", async () => {
    await type("input[name=code]", code);
    await appReady();
    await page.waitFor(`import("/src/lib/cloud/session.ts").then(C => C.cloudState().account)`, 10000, "account ready");
    const state = await cloudState();
    assert.equal(state.status, "signed-in");
    assert.equal(state.user.email, email);
    userId = state.user.userId;
    familyId = state.account.familyId;
    assert.match(familyId, /^[0-9a-f-]{36}$/);
    assert.ok(await has(`Signed in as ${email}`), "confirmation shown");
    assert.ok(await has("Maya"), "the same children as before");
    assert.equal(await welcomeSetting(), "done");
    assert.deepEqual(await sessionKeys(), ["rootmap.session:auth"]);
    assert.equal(await dumpLocal(), localBefore);
    assert.deepEqual(await appKeys(), keysBefore);
    for (const p of await cloudRequests()) assert.match(p, AUTH_ONLY, `unexpected request ${p}`);
    for (const table of ["children", "entries", "photos"]) {
      const admin = await fetch(`${API}/rest/v1/${table}?family_id=eq.${familyId}&select=id`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
      assert.deepEqual(await admin.json(), [], `no ${table} uploaded`);
    }
    const objects = await fetch(`${API}/storage/v1/object/list/family-photos`, { method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" }, body: JSON.stringify({ prefix: familyId }) });
    assert.deepEqual(await objects.json(), [], "no photos uploaded");
  });

  await step("A reload restores the session: no Welcome, Profile shows the account", async () => {
    await page.reload();
    await appReady();
    await page.waitFor(`import("/src/lib/cloud/session.ts").then(C => C.cloudState().status === "signed-in" && C.cloudState().account)`, 10000, "restored");
    assert.equal(await page.eval(`!!document.querySelector(".opening")`), false);
    assert.equal((await cloudState()).account.familyId, familyId);
    await openProfile();
    assert.ok(await has("RootMap Account"));
    assert.ok(await has(email));
    assert.equal(await dumpLocal(), localBefore);
  });

  await step("Sign out from Profile (with confirmation): the session is removed, local data stays, Welcome does not return", async () => {
    await click("RootMap Account");
    await page.waitFor(`document.body.innerText.includes("Sign out")`, 3000, "account page");
    await click("Sign out");
    assert.ok(await has("Sign out of RootMap?"));
    await page.eval(`[...document.querySelectorAll(".sheet-buttons button")].at(-1).click()`);
    await waitCloud("signed-out");
    await page.waitFor(`document.body.innerText.includes("Sign in or create an account")`, 5000, "Profile shows sign-in");
    assert.deepEqual(await sessionKeys(), []);
    assert.equal(await dumpLocal(), localBefore);
    assert.deepEqual(await appKeys(), keysBefore);
    await page.reload();
    await appReady();
    await waitCloud("signed-out", "still signed out after reload");
    assert.equal(await page.eval(`!!document.querySelector(".opening")`), false);
  });

  await step("Returning parent: signing in from Profile with the same email opens the same account and family", async () => {
    await openProfile();
    await click("Sign in or create an account");
    await welcomeShown();
    await sleep(1100); // one code per address per second (local stack)
    const again = await requestCode("I already have an account", email);
    await type("input[name=code]", again);
    await page.waitFor(`document.querySelector(".profile-page") && document.body.innerText.includes("RootMap Account")`, 10000, "back on Profile");
    await page.waitFor(`import("/src/lib/cloud/session.ts").then(C => C.cloudState().account)`, 10000, "account ready");
    const state = await cloudState();
    assert.equal(state.user.userId, userId);
    assert.equal(state.account.familyId, familyId);
    const families = await (await fetch(`${API}/rest/v1/family_members?user_id=eq.${userId}&select=family_id`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } })).json();
    assert.equal(families.length, 1, "still one family");
    assert.equal(await dumpLocal(), localBefore);
  });

  await step("An expired code (older than 1 hour) is explained and does not sign in", async () => {
    await click("RootMap Account");
    await click("Sign out");
    await page.eval(`[...document.querySelectorAll(".sheet-buttons button")].at(-1).click()`);
    await waitCloud("signed-out");
    await page.waitFor(`document.body.innerText.includes("Sign in or create an account")`, 5000, "Profile shows sign-in");
    await click("Sign in or create an account");
    await welcomeShown();
    await sleep(1100);
    const expired = await requestCode("I already have an account", email);
    const db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
    try {
      await db.query("update auth.users set confirmation_sent_at = confirmation_sent_at - interval '61 minutes', recovery_sent_at = recovery_sent_at - interval '61 minutes' where email = $1", [email]);
    } finally {
      await db.end();
    }
    await type("input[name=code]", expired);
    await page.waitFor(`document.querySelector("[role=alert]")`, 10000, "expired-code message");
    assert.match(await errorShown(), /incorrect or has expired/);
    assert.equal((await cloudState()).status, "signed-out");
    assert.deepEqual(await sessionKeys(), []);
    await click("Use a different email");
    await click("Back");
    await click("Continue without an account");
    await page.waitFor(`document.querySelector(".profile-page")`, 5000, "back on Profile");
    assert.equal(await dumpLocal(), localBefore);
  }, /status of 403 .*\/auth\/v1\/verify/);
  await page.close();
  page = undefined;

  // ---- Device 2: a parent who continues without an account ---------------------------------------------------
  page = await newDevice("cloud-guest", 9346);
  await page.nav(`${BASE}/`);
  await welcomeShown();

  await step("Continue without an account: RootMap opens, nothing is sent, and Welcome is not shown again", async () => {
    await page.waitFor(`document.body.innerText.includes("Continue without an account")`, 5000, "guest button");
    const before = await dumpLocal();
    await click("Continue without an account");
    await appReady();
    assert.ok(await has("Maya"));
    assert.equal(await welcomeSetting(), "done");
    assert.deepEqual(await cloudRequests(), []);
    assert.deepEqual(await sessionKeys(), []);
    assert.equal(await dumpLocal(), before);
    await page.reload();
    await appReady();
    assert.equal(await page.eval(`!!document.querySelector(".opening")`), false);
    await openProfile();
    assert.ok(await has("Sign in or create an account"));
  });
  await page.close();
  page = undefined;

  // ---- Device 3: RootMap was already in use here (before accounts existed) -----------------------------------
  // The browser already holds RootMap data from an earlier version (legacy localStorage), as an existing parent's would.
  page = await newDevice("cloud-existing", 9347, `if (location.origin === ${JSON.stringify(BASE)} && !localStorage.getItem("rootmap-data-store")) localStorage.setItem("rootmap-seed-version", "2");`);
  await page.nav(`${BASE}/`);

  await step("A device with RootMap data opens straight into the app, with no Welcome and nothing written for it", async () => {
    await appReady();
    await waitCloud("signed-out");
    await sleep(500);
    assert.equal(await page.eval(`!!document.querySelector(".opening")`), false);
    assert.equal(await welcomeSetting(), null);
    assert.deepEqual(await cloudRequests(), []);
  });
} finally {
  await page?.close().catch(() => undefined);
  server.kill();
}
const failedSteps = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failedSteps.length}/${results.length} passed`);
process.exit(failedSteps.length ? 1 : 0);
