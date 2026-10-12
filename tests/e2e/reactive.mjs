import assert from "node:assert/strict";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { BASE, tempProfile } from "./env.mjs";

// Screens follow the data store: a change written outside any screen (as a restore or a future cloud sync does)
// appears without a reload. Also checks the collision-resistant ids for goals and repeated plans.
//
// The test writes through the app's own store module: the Vite dev server serves it at one URL, so importing it
// here gives the same instance the running app uses. No test hook exists in the app itself.

const page = await launch(tempProfile("reactive"), 9341);
await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

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
const nav = async label => {
  if (!(await page.eval(`!!document.querySelector(".bottom-nav")`))) { await page.reload(); await appReady(); }
  await page.eval(`__t.click(${JSON.stringify(label)}, ".bottom-nav button")`);
  await sleep(150);
};
// Runs `body` in the page with `S` bound to the app's store module.
const withStore = body => page.eval(`import("/src/lib/data/store.ts").then(async S => { ${body} })`);
const loads = () => page.eval(`performance.getEntriesByType("navigation").length + ":" + performance.timeOrigin`);
const now = new Date().toISOString();
const child = { id: "c-external-1", first: "Ext", last: "Child", dob: "2022-05-01", enrolled: "Sep 2025", lessons: 0, group: "Primary", photo: "", createdAt: now, updatedAt: now, deletedAt: null, origin: "user" };
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

await page.nav(`${BASE}/`);
await appReady();
const firstLoad = await loads();

await step("A child added outside any screen appears on My Children without a reload, and is stored", async () => {
  await page.waitFor(`document.body.innerText.includes("Maya")`);
  assert.ok(!(await page.eval(`document.body.innerText.includes("Ext")`)));
  assert.equal(await withStore(`return S.write({ collections: { children: [${JSON.stringify(child)}] } });`), null);
  await page.waitFor(`[...document.querySelectorAll(".child-select-name, .child-select-card")].some(e => e.textContent.includes("Ext"))`, 5000, "new child shown");
  const stored = (await page.eval(`__t.all("children")`)).find(c => c.id === child.id);
  assert.equal(stored.first, "Ext");
  assert.equal(await loads(), firstLoad, "no reload happened");
});

await step("An outside edit and an outside soft delete update the screen too", async () => {
  await withStore(`return S.write({ collections: { children: [${JSON.stringify({ ...child, first: "Renamed" })}] } });`);
  await page.waitFor(`document.body.innerText.includes("Renamed")`, 5000, "rename shown");
  await withStore(`return S.write({ collections: { children: [${JSON.stringify({ ...child, first: "Renamed", deletedAt: now })}] } });`);
  await page.waitFor(`!document.body.innerText.includes("Renamed")`, 5000, "deleted child hidden");
  assert.ok((await page.eval(`__t.all("children")`)).find(c => c.id === child.id).deletedAt, "kept as a soft delete");
  assert.equal(await loads(), firstLoad);
});

await step("An outside setting change (language) updates every screen", async () => {
  await withStore(`return S.write({ settings: [["rootmap-language", "zh"]] });`);
  await page.waitFor(`document.querySelector(".bottom-nav").innerText.includes("个人中心")`, 5000, "Chinese navigation");
  await withStore(`return S.write({ settings: [["rootmap-language", "en"]] });`);
  await page.waitFor(`document.querySelector(".bottom-nav").innerText.includes("Profile")`, 5000, "English again");
  assert.equal(await loads(), firstLoad);
});

await step("A save that must be confirmed (commit) is shown only once IndexedDB has stored it", async () => {
  const r = await withStore(`
    const g = { id: "g-commit-timing", title: "Timing", completed: false, createdAt: "${now}", updatedAt: "${now}", deletedAt: null };
    const p = S.write({ collections: { goals: [g] } }, { rollback: true });
    const before = S.publishedCollection("goals").some(x => x.id === g.id);
    const failure = await p;
    return { before, failure, after: S.publishedCollection("goals").some(x => x.id === g.id) };
  `);
  assert.deepEqual(r, { before: false, failure: null, after: true });
});

await step("A new goal gets a collision-resistant id (g-<uuid>), not a timestamp", async () => {
  await nav("Profile");
  await page.eval(`__t.click("My Goals")`);
  await page.waitFor(`document.querySelector(".goals-add")`);
  // The goal added outside the screen in the previous step is already listed.
  assert.ok(await page.eval(`document.body.innerText.includes("Timing")`));
  await page.eval(`document.querySelector(".goals-add").click()`);
  await page.waitFor(`document.querySelector(".goal-form input")`);
  await page.eval(`__t.type(".goal-form input", "Walk to school together")`);
  await page.eval(`document.querySelector(".goal-submit").click()`);
  await page.waitFor(`__t.all("goals").then(g => g.some(x => x.title === "Walk to school together"))`);
  const g = (await page.eval(`__t.all("goals")`)).find(x => x.title === "Walk to school together");
  assert.match(g.id, new RegExp(`^g-${UUID}$`));
  assert.equal(g.origin, "user");
});

await step("Repeat in My Week makes a new plan with a p-<uuid> id; an outside plan shows up there live", async () => {
  await page.eval(`__t.click("Back", "button")`).catch(() => {});
  await nav("Profile");
  await page.eval(`__t.click("My Week")`);
  await page.waitFor(`document.querySelector(".week-page")`);
  await page.eval(`__t.click("Completed", ".segmented button")`);
  // (Getting here may have reloaded: the test's nav() reloads from screens without the bottom bar.)
  const weekLoad = await loads();
  const plan = { id: "p-external-done", activityId: "water-pouring", date: "2026-10-05", childIds: ["emma"], completed: true, completedDate: "2026-10-05", createdAt: now, updatedAt: now, deletedAt: null, origin: "user" };
  await withStore(`return S.write({ collections: { plans: [${JSON.stringify(plan)}] } });`);
  await page.waitFor(`[...document.querySelectorAll(".week-list button")].some(b => b.textContent.trim() === "Repeat")`, 5000, "completed plan shown");
  const before = (await page.eval(`__t.all("plans")`)).length;
  await page.eval(`__t.click("Repeat", ".week-list button")`);
  await page.waitFor(`__t.all("plans").then(p => p.length === ${before + 1})`);
  const added = (await page.eval(`__t.all("plans")`)).find(p => p.id !== plan.id && p.activityId === "water-pouring" && !p.completed);
  assert.match(added.id, new RegExp(`^p-${UUID}$`));
  assert.deepEqual(added.childIds, ["emma"]);
  assert.equal(await loads(), weekLoad, "no reload happened");
});

await page.close();
const failedSteps = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failedSteps.length}/${results.length} passed`);
process.exit(failedSteps.length ? 1 : 0);
