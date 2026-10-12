// Sign-in through the app's screens, with cloud features ON, against the local Supabase stack (Phase 2B-2 M1–M3).
// Needs Docker and the stack (`npm run db:start`); run with `npm run test:e2e:cloud` (with spaces.mjs).
//
// Welcome on a new device (English and Chinese), email + 6-digit code (new and returning account, wrong, expired,
// offline), the account's own space after sign-in, session restore after a reload, sign-out from Profile back to
// the guest space, "Continue without an account", and a device with RootMap data opening straight into the app.
// The guest database is compared before and after every step: signing in or out uploads and changes nothing in it.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { admin, expireCodes, newDevice, sleep, startServer, stepper, ui } from "./cloudkit.mjs";

const server = await startServer();
const BASE = server.base;
let page, u;
const { step, finish } = stepper(() => page);

// The guest database, without the device's Welcome flag (which records the parent's choice on this device).
const guestDump = async () => {
  const d = await u.dump("rootmap");
  d.settings = d.settings.filter(s => s.key !== "rootmap-welcome").map(({ updatedAt, ...s }) => s);
  return JSON.stringify(d);
};
const welcomeSetting = async () => (await u.dump("rootmap"))?.settings.find(s => s.key === "rootmap-welcome")?.value ?? null;
// Sign-in, account set-up, and sync reading this (empty) account's family. No data is written to the server.
const AUTH_ONLY = /^((GET|POST|HEAD|OPTIONS) \/(auth\/v1\/(otp|verify|logout|token|user)|rest\/v1\/(family_members|rpc\/create_family|profiles))|(GET|OPTIONS) \/rest\/v1\/(children|entries|activity_records|plans|goals|saved_activities|photos|cloud_migrations))$/;

const email = `parent-${randomUUID()}@example.com`;
let guestBefore, userId, familyId;

try {
  // ---- Device 1: a new parent -------------------------------------------------------------------------------
  page = await newDevice("cloud-new", 9345);
  u = ui(page);
  await page.nav(`${BASE}/`);
  await u.welcomeShown();
  await u.waitCloud("signed-out", "cloud started, signed out");

  await step("New device: Welcome is shown, without password, phone, WeChat, Apple or Google; nothing is sent", async () => {
    const t = await u.text();
    for (const s of ["Create an account", "I already have an account", "Continue without an account"]) assert.ok(t.includes(s), s);
    for (const s of ["WeChat", "Apple", "Google", "Password", "Phone"]) assert.ok(!t.includes(s), `${s} is hidden`);
    assert.equal(await page.eval(`document.querySelectorAll("input[type=password]").length`), 0);
    assert.deepEqual(page.requests, []);
    assert.deepEqual(await u.sessionKeys(), []);
    assert.equal(await welcomeSetting(), "pending");
  });

  await step("A reload during Welcome shows Welcome again", async () => {
    await page.reload();
    await u.welcomeShown();
  });

  await step("Chinese: Welcome and the email step, including its error message, are translated", async () => {
    await page.eval(`__t.click("中文")`);
    await page.waitFor(`document.body.innerText.includes("欢迎来到 RootMap")`, 3000, "zh welcome");
    for (const s of ["创建账户", "我已有账户", "暂不登录，直接使用"]) assert.ok(await u.has(s), s);
    await u.click("创建账户");
    for (const s of ["创建你的账户", "邮箱", "发送验证码"]) assert.ok(await u.has(s), s);
    await u.type("input[name=email]", "not-an-email");
    await u.click("发送验证码");
    assert.equal(await u.errorShown(), "请输入有效的邮箱地址。");
    await u.click("返回");
    await page.eval(`__t.click("EN")`);
    await page.waitFor(`document.body.innerText.includes("Welcome to RootMap")`, 3000, "en welcome");
    // From here on, nothing in the guest database may change (the language switch above was the parent's own).
    await sleep(300);
    guestBefore = await guestDump();
  });

  await step("Create an account: an invalid email is explained and nothing is sent", async () => {
    await u.click("Create an account");
    await u.type("input[name=email]", "parent@");
    await u.click("Send code");
    assert.equal(await u.errorShown(), "Please enter a valid email address.");
    assert.deepEqual(page.requests, []);
    await u.click("Back");
  });

  await step("Offline: sending a code explains there is no connection; nothing is stored", async () => {
    await page.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      await u.click("Create an account");
      await u.type("input[name=email]", email);
      await u.click("Send code");
      await page.waitFor(`document.querySelector("[role=alert]")`, 10000, "offline message");
      assert.match(await u.errorShown(), /Can’t connect right now/);
      assert.ok(await page.eval(`!!document.querySelector("input[name=email]")`), "still on the email step");
    } finally {
      await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    assert.deepEqual(await u.sessionKeys(), []);
    await u.click("Back");
    page.requests.length = 0; // the attempt made while offline
  }, /ERR_INTERNET_DISCONNECTED|Failed to fetch/);

  let code;
  await step("Send code opens the code step for that address; a wrong code is explained and does not sign in", async () => {
    code = await u.requestCode("Create an account", email);
    assert.ok(await u.has(email));
    assert.ok(await u.has("New code in"), "resend waits");
    const wrong = code === "000000" ? "111111" : "000000";
    await u.type("input[name=code]", wrong);
    await page.waitFor(`document.querySelector("[role=alert]")`, 10000, "wrong-code message");
    assert.match(await u.errorShown(), /incorrect or has expired/);
    assert.equal((await u.cloudState()).status, "signed-out");
    assert.deepEqual(await u.sessionKeys(), []);
  }, /status of 403 .*\/auth\/v1\/verify/);

  await step("The right code signs in (new account) and opens the account's own, empty space; the guest database is unchanged and nothing is uploaded", async () => {
    await u.reloaded(() => u.type("input[name=code]", code));
    await page.waitFor(`import("/src/lib/cloud/session.ts").then(C => C.cloudState().account)`, 15000, "account ready");
    const state = await u.cloudState();
    assert.equal(state.status, "signed-in");
    assert.equal(state.user.email, email);
    userId = state.user.userId;
    familyId = state.account.familyId;
    assert.match(familyId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(await u.space(), { kind: "account", userId });
    assert.ok((await u.dbNames()).includes(`rootmap-account-${userId}`));
    assert.ok(await u.has(`Signed in as ${email}`), "confirmation shown after the switch");
    assert.ok(!(await u.has("Maya")), "guest children are not shown in the account's space");
    assert.equal(await welcomeSetting(), "done");
    assert.deepEqual(await u.sessionKeys(), ["rootmap.session:auth"]);
    assert.equal(await guestDump(), guestBefore);
    for (const r of page.requests) assert.match(r, AUTH_ONLY, `unexpected request ${r}`);
    for (const table of ["children", "entries", "photos"]) assert.deepEqual(await admin(`/rest/v1/${table}?family_id=eq.${familyId}&select=id`), [], `no ${table} uploaded`);
  });

  await step("A reload restores the session in the account's space: no Welcome, Profile shows the account", async () => {
    await page.reload();
    await u.appReady();
    await page.waitFor(`import("/src/lib/cloud/session.ts").then(C => C.cloudState().status === "signed-in" && C.cloudState().account)`, 15000, "restored");
    assert.equal(await page.eval(`!!document.querySelector(".opening")`), false);
    assert.deepEqual(await u.space(), { kind: "account", userId });
    assert.equal((await u.cloudState()).account.familyId, familyId);
    await u.openProfile();
    assert.ok(await u.has("RootMap Account"));
    assert.ok(await u.has(email));
    assert.equal(await guestDump(), guestBefore);
  });

  await step("Sign out from Profile (with confirmation) returns to the guest space: guest data is back, unchanged; Welcome does not return", async () => {
    await u.signOut();
    assert.deepEqual(await u.space(), { kind: "guest" });
    assert.ok(await u.has("You’re signed out."));
    assert.ok(await u.has("Sign in or create an account"), "back on Profile");
    assert.deepEqual(await u.sessionKeys(), []);
    assert.equal(await guestDump(), guestBefore);
    await page.reload();
    await u.appReady();
    await u.waitCloud("signed-out", "still signed out after reload");
    assert.equal(await page.eval(`!!document.querySelector(".opening")`), false);
  });

  await step("Returning parent: signing in from Profile with the same email opens the same account, family and space", async () => {
    await u.openProfile();
    await u.click("Sign in or create an account");
    await u.welcomeShown();
    await sleep(1100); // one code per address per second (local stack)
    await u.signIn(email);
    assert.ok(await page.eval(`document.querySelector(".profile-page") !== null`), "back on Profile");
    const state = await u.cloudState();
    assert.equal(state.user.userId, userId);
    assert.equal(state.account.familyId, familyId);
    assert.deepEqual(await u.space(), { kind: "account", userId });
    assert.equal((await admin(`/rest/v1/family_members?user_id=eq.${userId}&select=family_id`)).length, 1, "still one family");
    assert.equal(await guestDump(), guestBefore);
  });

  await step("An expired code (older than 1 hour) is explained and does not sign in", async () => {
    await u.signOut();
    await u.openProfile();
    await u.click("Sign in or create an account");
    await u.welcomeShown();
    await sleep(1100);
    const expired = await u.requestCode("I already have an account", email);
    await expireCodes(email);
    await u.type("input[name=code]", expired);
    await page.waitFor(`document.querySelector("[role=alert]")`, 10000, "expired-code message");
    assert.match(await u.errorShown(), /incorrect or has expired/);
    assert.equal((await u.cloudState()).status, "signed-out");
    assert.deepEqual(await u.sessionKeys(), []);
    await u.click("Use a different email");
    await u.click("Back");
    await u.click("Continue without an account");
    await page.waitFor(`document.querySelector(".profile-page")`, 5000, "back on Profile");
    assert.equal(await guestDump(), guestBefore);
  }, /status of 403 .*\/auth\/v1\/verify/);
  await page.close();
  page = undefined;

  // ---- Device 2: a parent who continues without an account ---------------------------------------------------
  page = await newDevice("cloud-guest", 9346);
  u = ui(page);
  await page.nav(`${BASE}/`);
  await u.welcomeShown();

  await step("Continue without an account: RootMap opens, nothing is sent, and Welcome is not shown again", async () => {
    await page.waitFor(`document.body.innerText.includes("Continue without an account")`, 5000, "guest button");
    const before = await guestDump();
    await u.click("Continue without an account");
    await u.appReady();
    assert.ok(await u.has("Maya"));
    assert.equal(await welcomeSetting(), "done");
    assert.deepEqual(page.requests, []);
    assert.deepEqual(await u.sessionKeys(), []);
    assert.equal(await guestDump(), before);
    await page.reload();
    await u.appReady();
    assert.equal(await page.eval(`!!document.querySelector(".opening")`), false);
    await u.openProfile();
    assert.ok(await u.has("Sign in or create an account"));
  });
  await page.close();
  page = undefined;

  // ---- Device 3: RootMap was already in use here (before accounts existed) -----------------------------------
  // The browser already holds RootMap data from an earlier version (legacy localStorage), as an existing parent's would.
  page = await newDevice("cloud-existing", 9347, `if (location.origin === ${JSON.stringify(BASE)} && !localStorage.getItem("rootmap-data-store")) localStorage.setItem("rootmap-seed-version", "2");`);
  u = ui(page);
  await page.nav(`${BASE}/`);

  await step("A device with RootMap data opens straight into the app, with no Welcome and nothing written for it", async () => {
    await u.appReady();
    await u.waitCloud("signed-out");
    await sleep(500);
    assert.equal(await page.eval(`!!document.querySelector(".opening")`), false);
    assert.equal(await welcomeSetting(), null);
    assert.deepEqual(page.requests, []);
  });
} finally {
  await page?.close().catch(() => undefined);
  server.stop();
}
process.exit(finish());
