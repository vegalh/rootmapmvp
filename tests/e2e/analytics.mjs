// Usage analytics in the real app, against the local Supabase stack (`npm run test:e2e:cloud`).
//
// A guest-only build with analytics on (cloud off): sharing is off by default and nothing is counted or sent; the
// Privacy & Data switch turns it on; one impression per page visit (a language switch doesn't add one); the request
// holds only whitelisted fields and a random guest id; the server stores the day's totals and a hash of that id;
// turning sharing off deletes the queue and the guest id and stops sending.
// A cloud build: a signed-in parent's batch carries no guest id; the admin page is hidden from and refused to a
// parent (even at its address) and shows totals to an admin.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { DB_URL, newDevice, startServer, stepper, ui } from "./cloudkit.mjs";

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
const today = (await db.query("select current_date::text d")).rows[0].d;
let page, u;
const { step, finish } = stepper(() => page);
const servers = [];

// Bodies of record_usage requests, across reloads.
const watchUsage = p => {
  p.usage = [];
  p.handlers.add(m => {
    if (m.method === "Network.requestWillBeSent" && m.params.request.url.includes("/rest/v1/rpc/record_usage") && m.params.request.method === "POST") {
      p.usage.push(JSON.parse(m.params.request.postData ?? "null"));
    }
  });
};
const tracker = `import("/src/lib/analytics/tracker.ts")`;
const pending = () => page.eval(`JSON.parse(localStorage.getItem("rootmap.usage-pending") ?? "null")`);
const usageKeys = () => page.eval(`Object.keys(localStorage).filter(k => k.startsWith("rootmap.usage")).sort()`);
// Opens a page by its address, as browser Back/Forward or a shared link would (lib/routes.ts).
const go = async hash => { await page.eval(`location.hash = ${JSON.stringify(hash)}; true`); await page.waitFor(`location.hash === ${JSON.stringify(hash)}`, 5000, hash); };
const tab = i => go(["#/today", "#/kids", "#/discover", "#/moments", "#/profile"][i]);
const openPrivacy = async () => {
  await go("#/privacy");
  await page.waitFor(`document.querySelector(".usage-switch")`, 5000, "the usage switch");
};
const switchOn = () => page.eval(`document.querySelector(".usage-switch [role=switch]").getAttribute("aria-checked")`);
const flush = async () => {
  const before = page.usage.length;
  await page.eval(`${tracker}.then(T => T.flushUsageNow())`);
  return page.usage.slice(before);
};
const serverCount = async (feature, kind) => Number((await db.query("select coalesce(sum(count), 0) n from private.usage_counts where day = $1 and audience = 'guest' and feature = $2 and kind = $3", [today, feature, kind])).rows[0].n);

try {
  // ---- A guest-only build ----------------------------------------------------------------------------------------
  const guestServer = await startServer({ VITE_ROOTMAP_CLOUD: "off", VITE_ROOTMAP_ANALYTICS: "on" });
  servers.push(guestServer);
  page = await newDevice("analytics-guest", 9445);
  watchUsage(page);
  u = ui(page);
  await page.nav(`${guestServer.base}/`);
  await u.appReady();

  await step("Off by default: using the app counts, stores and sends nothing", async () => {
    await tab(2);
    await page.waitFor(`document.querySelector(".activity-card")`, 5000, "Discover");
    await page.eval(`document.querySelector(".activity-card .activity-name").click(); true`);
    await page.waitFor(`location.hash.startsWith("#/activity/") || location.hash.startsWith("#/music/")`, 5000, "an activity");
    await page.eval(`${tracker}.then(T => T.flushUsageNow())`);
    assert.deepEqual(await usageKeys(), []);
    assert.deepEqual(page.usage, []);
  });

  await step("Privacy & Data has the switch, off; turning it on stores only the choice", async () => {
    await openPrivacy();
    assert.ok(await u.has("Share anonymous usage statistics"));
    assert.equal(await switchOn(), "false");
    await page.eval(`document.querySelector(".usage-switch [role=switch]").click(); true`);
    assert.equal(await switchOn(), "true");
    assert.deepEqual(await usageKeys(), ["rootmap.usage-sharing"]);
  });

  let guestId;
  await step("One impression per page visit; re-rendering in another language doesn't add one; clicks count", async () => {
    await tab(2);
    await page.waitFor(`document.querySelector(".activity-card")`, 5000, "Discover");
    await page.eval(`import("/src/lib/data/hooks.ts").then(H => H.saveSetting("rootmap-language", "zh"))`);
    await page.waitFor(`document.body.innerText.includes("发现")`, 5000, "Chinese");
    await page.eval(`import("/src/lib/data/hooks.ts").then(H => H.saveSetting("rootmap-language", "en"))`);
    await page.waitFor(`document.body.innerText.includes("Discover")`, 5000, "English");
    await page.eval(`document.querySelector(".activity-card .activity-name").click(); true`);
    await page.waitFor(`location.hash.startsWith("#/activity/") || location.hash.startsWith("#/music/")`, 5000, "an activity");
    const counts = Object.values((await pending()).open)[0].counts;
    assert.equal(counts["discover.activities|impression"], 1);
    assert.equal(counts["discover.activities|click"], 1);
    assert.equal(counts["activity.detail|impression"], 1);
    assert.equal(counts["activity.save|impression"], 1);
  });

  await step("The request holds only whitelisted fields and a random guest id; the server keeps totals and a hash", async () => {
    const before = await serverCount("discover.activities", "impression");
    const sent = await flush();
    assert.equal(sent.length, 1);
    const { batch } = sent[0];
    assert.deepEqual(Object.keys(sent[0]), ["batch"]);
    assert.deepEqual(Object.keys(batch).sort(), ["batch_id", "day", "events", "guest_id", "seconds", "v"]);
    for (const e of batch.events) assert.deepEqual(Object.keys(e).sort(), ["count", "feature", "kind"]);
    assert.match(batch.day, /^\d{4}-\d{2}-\d{2}$/);
    guestId = batch.guest_id;
    assert.equal(guestId, await page.eval(`localStorage.getItem("rootmap.usage-guest-id")`));
    assert.equal(await serverCount("discover.activities", "impression") - before, 1);
    const hash = createHash("sha256").update(`rootmap-guest:${guestId}`).digest();
    assert.equal((await db.query("select count(*)::int n from private.guest_days where guest_hash = $1", [hash])).rows[0].n, 1);
    assert.equal((await pending()).sealed.length, 0, "accepted batches are removed");
  });

  await step("Turning sharing off deletes the queue and the guest id, and nothing more is sent", async () => {
    await tab(0);
    await page.waitFor(`location.hash === "#/today"`, 5000, "Today");
    await openPrivacy();
    await page.eval(`document.querySelector(".usage-switch [role=switch]").click(); true`);
    assert.equal(await switchOn(), "false");
    assert.deepEqual(await usageKeys(), []);
    await tab(2);
    await page.waitFor(`document.querySelector(".activity-card")`, 5000, "Discover");
    assert.deepEqual(await flush(), []);
    assert.deepEqual(await usageKeys(), []);
  });

  await step("A guest-only build has no admin page entry and can't load the summary", async () => {
    await go("#/profile");
    await page.waitFor(`document.querySelector(".profile-page")`, 5000, "Profile");
    assert.ok(!(await u.has("Admin Dashboard")));
    await go("#/admin");
    await page.waitFor(`document.body.innerText.includes("Only RootMap admins can see this page.")`, 10000, "refused");
  });
  await page.close();

  // ---- A cloud build: a parent and an admin ----------------------------------------------------------------------
  const cloudServer = await startServer({ VITE_ROOTMAP_ANALYTICS: "on" });
  servers.push(cloudServer);
  page = await newDevice("analytics-cloud", 9465);
  watchUsage(page);
  u = ui(page);
  await page.nav(`${cloudServer.base}/`);
  await u.welcomeShown();
  const email = `analytics-${randomUUID()}@example.com`;
  await u.signIn(email);

  await step("Signed in, a batch is sent with the session and no guest id", async () => {
    await openPrivacy();
    await page.eval(`document.querySelector(".usage-switch [role=switch]").click(); true`);
    await tab(2);
    await page.waitFor(`document.querySelector(".activity-card")`, 5000, "Discover");
    const sent = await flush();
    assert.equal(sent.length, 1);
    assert.ok(!("guest_id" in sent[0].batch));
    assert.deepEqual(await usageKeys(), ["rootmap.usage-pending", "rootmap.usage-sharing"]);
    const userId = (await db.query("select id from auth.users where email = $1", [email])).rows[0].id;
    assert.equal((await db.query("select count(*)::int n from private.account_days where user_id = $1", [userId])).rows[0].n, 1);
  });

  await step("A parent sees no admin entry, and the admin address shows only the refusal", async () => {
    await go("#/profile");
    await page.waitFor(`document.querySelector(".profile-page")`, 5000, "Profile");
    assert.ok(!(await u.has("Admin Dashboard")));
    await go("#/admin");
    await page.waitFor(`document.body.innerText.includes("Only RootMap admins can see this page.")`, 10000, "refused");
    assert.ok(!(await u.has("Registered accounts")));
  }, /403 \(Forbidden\) .*\/rest\/v1\/rpc\/admin_usage_summary/); // the server's refusal is the point

  await step("Granted by the owner (SQL), the entry appears on the next visit to Profile without signing out", async () => {
    await db.query("select private.grant_admin($1)", [email]);
    await go("#/today");
    await go("#/profile");
    await page.waitFor(`document.body.innerText.includes("Admin Dashboard")`, 10000, "admin entry");
  });

  await step("The admin sees the four sections, with no email; the range filter reloads", async () => {
    await u.click("Admin Dashboard");
    await page.waitFor(`document.body.innerText.includes("Registered accounts")`, 10000, "summary");
    for (const s of ["Accounts and visitors", "Children by age", "Time in the app", "Feature click rate", "Discover › Activities"]) assert.ok(await u.has(s), s);
    // (The sign-in toast may still name the account; the dashboard itself never does.)
    assert.ok(!(await page.eval(`document.querySelector(".admin-page").innerText.includes(${JSON.stringify(email)})`)));
    await u.click("Last 7 days");
    await page.waitFor(`document.querySelector(".segmented button[aria-pressed=true]")?.textContent === "Last 7 days"`, 5000, "7 days");
    await page.waitFor(`document.body.innerText.includes("Registered accounts")`, 10000, "summary for 7 days");
  });

  await step("Revoked: the open dashboard loses its data on the next load, and the Profile entry disappears", async () => {
    await db.query("select private.revoke_admin($1)", [email]);
    await u.click("Last 90 days"); // the open page asks the server again
    await page.waitFor(`document.body.innerText.includes("Only RootMap admins can see this page.")`, 10000, "refused");
    assert.ok(!(await u.has("Registered accounts")));
    await go("#/profile");
    await page.waitFor(`document.querySelector(".profile-page") && !document.body.innerText.includes("Admin Dashboard")`, 10000, "entry gone");
  }, /403 \(Forbidden\) .*\/rest\/v1\/rpc\/admin_usage_summary/);
  await page.close();
} finally {
  for (const s of servers) s.stop();
  await db.end();
}
process.exit(finish());
