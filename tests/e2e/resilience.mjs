import assert from "node:assert/strict";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { FIXTURE } from "./fixture.mjs";
import { BASE as DEV, tempProfile } from "./env.mjs";

// Storage problems: no IndexedDB, IndexedDB that won't open, and restoring a backup.
const results = [];
let page;
async function step(name, fn) {
  const before = page.errors.length;
  try {
    await fn();
    const errs = page.errors.slice(before);
    if (errs.length) throw new Error(`console errors: ${errs.join(" | ")}`);
    results.push(["PASS", name]); console.log(`PASS  ${name}`);
  } catch (e) {
    results.push(["FAIL", name]); console.log(`FAIL  ${name}\n      ${e.message.split("\n").join("\n      ")}`);
  }
}
async function start(profile, port) {
  page = await launch(tempProfile(profile), port);
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
}
const appReady = () => page.waitFor(`document.querySelector(".app-shell")`, 15000, "app rendered");
const nav = async label => {
  if (!(await page.eval(`!!document.querySelector(".bottom-nav")`))) { await page.home(); await appReady(); }
  if (label === "Moments") {
    // Moments is no longer a tab; Kids → All Moments opens the timeline.
    await page.eval(`__t.click("Kids", ".bottom-nav button")`);
    await page.waitFor(`document.querySelector(".recent-title .text-action")`);
    await page.eval(`document.querySelector(".recent-title .text-action").click()`);
    await page.waitFor(`document.querySelector(".moments-page")`);
  } else await page.eval(`__t.click(${JSON.stringify(label)}, ".bottom-nav button")`);
  await sleep(150);
};
const seedAt = async (url, fixture = FIXTURE) => {
  await page.nav(url);
  await page.eval("__t.deleteDb()");
  return page.eval(fixture);
};

// ---------------------------------------------------------------------------------------------------------
await start("profile-fallback", 9334);

await step("No IndexedDB at all: app runs on localStorage exactly as before, writes in the original format", async () => {
  await seedAt(`${DEV}/package.json`);
  const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });` });
  await page.nav(`${DEV}/`);
  await appReady();
  await nav("Kids");
  const text = await page.eval("__t.text()");
  assert.ok(text.includes("小明") && text.includes("Maya"));
  await page.waitFor(`__t.imagesLoaded(".child-select-photo img").every(i => i.ok)`);
  // Add a goal through the UI
  await nav("Profile");
  await page.eval(`__t.click("My Goals")`);
  await page.eval(`__t.click("Add Goal")`);
  await page.eval(`__t.type(".goal-form input", "Fallback goal 备用")`);
  await page.eval(`document.querySelector(".goal-submit").click()`);
  await page.waitFor(`JSON.parse(localStorage.getItem("rootmap-goals")).some(g => g.title === "Fallback goal 备用")`);
  const goals = JSON.parse(await page.eval(`localStorage.getItem("rootmap-goals")`));
  assert.equal(goals.length, 3, "original goals kept, new one added");
  assert.equal(await page.eval(`localStorage.getItem("rootmap-data-store")`), null);
  // IndexedDB comes back: the migration picks up what was written meanwhile
  await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  await page.reload();
  await appReady();
  await page.waitFor(`__t.all("meta").then(m => m && m.some(x => x.key === "migration"))`);
  const idbGoals = await page.eval(`__t.all("goals")`);
  assert.ok(idbGoals.some(g => g.title === "Fallback goal 备用"), "goal written in fallback mode was migrated");
  assert.equal(idbGoals.length, 3);
});

await step("Data exists in IndexedDB but the browser won't open it: short bilingual message, no stale fallback", async () => {
  const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `IDBFactory.prototype.open = function () { throw new DOMException("Simulated", "UnknownError"); };` });
  page.warnings.length = 0;
  await page.reload();
  await page.waitFor(`document.body.innerText.includes("couldn't open your saved memories")`, 8000);
  assert.ok(await page.eval(`!!document.querySelector("[role=alert]") && document.body.innerText.includes("Try Again")`));
  assert.ok(!(await page.eval("__t.text()")).includes("小明"), "does not show the older localStorage copy");
  await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  await page.eval(`__t.click("Try Again")`).catch(() => {});
  await sleep(300);
  await appReady();
  await nav("Kids");
  assert.ok((await page.eval("__t.text()")).includes("小明"));
});

await step("Restore from a backup file replaces data in one transaction and soft-deletes what's missing", async () => {
  const url = await page.eval(`performance.getEntriesByType("resource").map(e => e.name).find(n => n.includes("/src/lib/data/store.ts"))`);
  const ok = await page.eval(`import(${JSON.stringify(url)}).then(async m => {
    const data = await m.backupData();
    data["rootmap-journal"] = data["rootmap-journal"].filter(e => e.id !== "m-1760000000001-d4e5f6");
    data["rootmap-goals"].push({ id: "g-restored", title: "From backup", completed: false, createdAt: "2026-10-01T00:00:00.000Z" });
    return m.restoreData(data);
  })`);
  assert.equal(ok, true);
  await page.reload(); await appReady();
  const entries = await page.eval(`__t.all("entries")`);
  assert.ok(entries.find(e => e.id === "m-1760000000001-d4e5f6").deletedAt, "missing entry soft-deleted, not erased");
  assert.ok(entries.filter(e => !e.deletedAt).every(e => e.photos.every(p => /^photo-/.test(p))), "photos stored by id again");
  assert.ok((await page.eval(`__t.all("goals")`)).some(g => g.id === "g-restored"));
  await nav("Moments");
  await page.waitFor(`__t.imagesLoaded(".journal-card-photo img").length > 0 && __t.imagesLoaded(".journal-card-photo img").every(i => i.ok)`);
  assert.ok(!(await page.eval("__t.text()")).includes("Quiet morning with the pink tower"));
});
await page.close();

const failed = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
