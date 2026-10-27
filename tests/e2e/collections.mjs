import assert from "node:assert/strict";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { BASE, tempProfile, openDemoEraDevice } from "./env.mjs";

// Discover › Collections (ready-made lists of activities), their own page at #/collection/<id>, saving one
// (My Week › Saved › My collections), and what happens with a collection id that no longer exists.
// This complements discover.mjs, which covers the Activities and Books tabs but never opens Collections.

const page = await launch(tempProfile("collections"), 9347);
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

const q = s => JSON.stringify(s);
const appReady = () => page.waitFor(`document.querySelector(".app-shell") && document.querySelector(".bottom-nav, main")`, 15000, "app rendered");
const nav = async index => {
  if (!(await page.eval(`!!document.querySelector(".bottom-nav")`))) { await page.home(); await appReady(); }
  await page.eval(`__t.clickSel(".bottom-nav button", ${index})`); await sleep(200);
};
const NAV = { today: 0, discover: 1, kids: 3, profile: 4 };
const tab = async label => { await page.eval(`__t.click(${q(label)}, ".discover-tabs button")`); await sleep(150); };
const live = async store => (await page.eval(`__t.all(${q(store)})`)).filter(r => !r.deletedAt);
const noOverflow = async label => {
  const w = await page.eval(`document.documentElement.scrollWidth`);
  assert.ok(w <= 390, `${label}: page is ${w}px wide at 390px`);
};

await openDemoEraDevice(page, `${BASE}/`);
await appReady();
await page.waitFor(`__t.dbExists()`, 10000, "data stored");

let collectionTitle, collectionActivityCount;
await step("Discover › Collections lists RootMap's collections as a vertical list, each with its activity count", async () => {
  await nav(NAV.discover);
  await tab("Collections");
  assert.ok((await page.eval(`document.querySelectorAll(".collection-card").length`)) > 0, "at least one collection");
  // Discover's Collections tab lists them one under another (not a row, unlike My Week's strip).
  assert.ok(await page.eval(`!!document.querySelector(".collection-list")`), "vertical list container");
  collectionTitle = await page.eval(`document.querySelector(".collection-card strong").textContent`);
  const countText = await page.eval(`document.querySelector(".collection-card em").textContent`);
  collectionActivityCount = parseInt(countText, 10);
  assert.ok(collectionActivityCount >= 3, "a shown collection has at least 3 activities");
  await noOverflow("Discover Collections");
});

await step("Opening a collection shows its title, activity count, unsaved Save button and its activities", async () => {
  await page.eval(`__t.clickSel(".collection-card")`);
  await page.waitFor(`document.querySelector(".collection-page")`, 3000, "collection page");
  assert.equal(await page.eval(`document.querySelector(".page-header h1, .page-header .title")?.textContent || document.querySelector(".collection-page h1")?.textContent`), collectionTitle);
  assert.equal(await page.eval(`document.querySelectorAll(".collection-page .activity-card").length`), collectionActivityCount);
  assert.equal(await page.eval(`document.querySelector(".collection-save").getAttribute("aria-pressed")`), "false");
  assert.ok((await page.eval(`document.querySelector(".collection-save").textContent`)).includes("Save collection"));
});

await step("One tap saves the collection (My Week › Saved › My collections shows it); another unsaves it", async () => {
  await page.eval(`__t.clickSel(".collection-save")`);
  await sleep(150);
  assert.equal(await page.eval(`document.querySelector(".collection-save").getAttribute("aria-pressed")`), "true");
  assert.ok((await page.eval(`document.querySelector(".collection-save").textContent`)).includes("Collection saved"));
  assert.ok((await live("savedCollections")).some(s => s.id), "stored");

  await nav(NAV.profile);
  await page.eval(`__t.click("My Week", ".menu-section button")`);
  await page.waitFor(`document.querySelector(".week-page")`, 3000, "My Week");
  await page.eval(`__t.click("Saved", ".segmented button")`);
  await sleep(150);
  assert.ok(await page.eval(`!!document.querySelector(".collection-strip")`), "My collections strip shown");
  assert.equal(await page.eval(`document.querySelector(".collection-strip .collection-card strong").textContent`), collectionTitle);

  // Opening it from My Week shows the same collection page, and its Back returns to My Week (not Discover).
  await page.eval(`__t.clickSel(".collection-strip .collection-card")`);
  await page.waitFor(`document.querySelector(".collection-page")`, 3000, "collection page from My Week");
  await page.eval(`__t.clickSel(".page-header .icon-button")`);
  await page.waitFor(`document.querySelector(".week-page")`, 3000, "back on My Week");

  // Unsave from the collection strip's card itself: open it again and toggle off.
  await page.eval(`__t.clickSel(".collection-strip .collection-card")`);
  await page.waitFor(`document.querySelector(".collection-page")`, 3000, "collection page");
  await page.eval(`__t.clickSel(".collection-save")`);
  await sleep(150);
  assert.equal(await page.eval(`document.querySelector(".collection-save").getAttribute("aria-pressed")`), "false");
  await page.eval(`__t.clickSel(".page-header .icon-button")`);
  await page.waitFor(`document.querySelector(".week-page")`, 3000, "back on My Week");
  assert.ok(!(await page.eval(`!!document.querySelector(".collection-strip")`)), "My collections strip hidden once empty");
  assert.equal((await live("savedCollections")).length, 0);
});

await step("Saving an activity from inside a collection also shows it in My Week › Saved (shared Saved state)", async () => {
  await nav(NAV.discover);
  await tab("Collections");
  await page.eval(`__t.clickSel(".collection-card")`);
  await page.waitFor(`document.querySelector(".collection-page")`, 3000, "collection page");
  const title = await page.eval(`document.querySelector(".collection-page .activity-card .activity-name").textContent`);
  await page.eval(`__t.clickSel(".collection-page .activity-card .heart")`);
  await sleep(150);
  assert.equal(await page.eval(`document.querySelector(".collection-page .activity-card .heart").getAttribute("aria-pressed")`), "true");
  await nav(NAV.profile);
  await page.eval(`__t.click("My Week", ".menu-section button")`);
  await page.waitFor(`document.querySelector(".week-page")`, 3000, "My Week");
  await page.eval(`__t.click("Saved", ".segmented button")`);
  await sleep(150);
  assert.ok((await page.eval(`document.body.innerText`)).includes(title), "the activity saved from the collection is in Saved Activities");
  // Undo, so later steps start from a clean Saved list.
  await nav(NAV.discover); await tab("Collections");
  await page.eval(`__t.clickSel(".collection-card")`);
  await page.waitFor(`document.querySelector(".collection-page")`, 3000, "collection page");
  await page.eval(`__t.clickSel(".collection-page .activity-card .heart")`);
});

await step("Saving a collection persists after a refresh", async () => {
  await page.eval(`__t.clickSel(".collection-save")`);
  await sleep(150);
  assert.equal(await page.eval(`document.querySelector(".collection-save").getAttribute("aria-pressed")`), "true");
  await page.reload();
  await appReady();
  await page.waitFor(`document.querySelector(".collection-page")`, 5000, "collection page after refresh");
  assert.equal(await page.eval(`document.querySelector(".collection-save").getAttribute("aria-pressed")`), "true", "still saved after refresh");
  // Clean up.
  await page.eval(`__t.clickSel(".collection-save")`);
  await sleep(150);
  assert.equal((await live("savedCollections")).length, 0);
});

await step("A collection id that no longer matches anything falls back to Discover › Collections, not a blank page", async () => {
  // A plain hash change on the current document never fires Page.loadEventFired; go through about:blank first,
  // as a freshly opened/shared link would.
  await page.nav("about:blank");
  await page.nav(`${BASE}/#/collection/not-a-real-collection-id`);
  await appReady();
  await page.waitFor(`document.querySelector(".discover-tabs")`, 5000, "falls back to Discover");
  assert.equal(await page.eval(`document.querySelector(".discover-tabs button.active")?.textContent.trim()`), "Collections");
  assert.deepEqual(page.errors, []);
});

await step("Chinese: Collections tab, a collection's page and Save collection are translated", async () => {
  await nav(NAV.profile);
  await page.eval(`__t.click("Language", ".menu-section button")`);
  await page.eval(`__t.click("简体中文")`);
  await page.waitFor(`document.documentElement.lang === "zh-CN"`, 3000, "Chinese");
  await page.eval(`__t.clickSel(".page-header .icon-button")`); await sleep(150);
  await nav(NAV.discover);
  await tab("合集");
  assert.ok((await page.eval(`document.querySelectorAll(".collection-card").length`)) > 0);
  await page.eval(`__t.clickSel(".collection-card")`);
  await page.waitFor(`document.querySelector(".collection-page")`, 3000, "collection page (zh)");
  assert.ok((await page.eval(`document.querySelector(".collection-save").textContent`)).includes("收藏这个合集"));
  await page.eval(`__t.clickSel(".collection-save")`);
  await sleep(150);
  assert.ok((await page.eval(`document.querySelector(".collection-save").textContent`)).includes("已收藏合集"));
  await page.eval(`__t.clickSel(".collection-save")`); // clean up
  await sleep(150);
  await page.eval(`__t.clickSel(".page-header .icon-button")`); await sleep(150);
  await nav(NAV.profile);
  await page.eval(`__t.click("语言", ".menu-section button")`);
  await page.eval(`__t.click("English")`);
  await page.waitFor(`document.documentElement.lang === "en"`, 3000, "English");
  await page.eval(`__t.clickSel(".page-header .icon-button")`); await sleep(150);
});

await step("Dark mode: Collections tab and a collection's page use the dark theme and fit 390px", async () => {
  await nav(NAV.profile);
  await page.eval(`__t.click("Appearance", ".menu-section button")`);
  await page.eval(`__t.click("Dark")`);
  await page.waitFor(`document.documentElement.dataset.theme === "dark"`, 3000, "dark");
  await page.eval(`__t.clickSel(".page-header .icon-button")`); await sleep(150);
  await nav(NAV.discover);
  await tab("Collections");
  await noOverflow("Discover Collections (dark)");
  await page.eval(`__t.clickSel(".collection-card")`);
  await page.waitFor(`document.querySelector(".collection-page")`, 3000, "collection page (dark)");
  const bg = await page.eval(`getComputedStyle(document.querySelector(".collection-page")).backgroundColor`);
  assert.notEqual(bg, "rgb(255, 255, 255)", "collection page is not using the light background in dark mode");
  await noOverflow("Collection page (dark)");
  await page.eval(`__t.clickSel(".page-header .icon-button")`); await sleep(150);
  await nav(NAV.profile);
  await page.eval(`__t.click("Appearance", ".menu-section button")`);
  await page.eval(`__t.click("Light")`);
  await page.waitFor(`document.documentElement.dataset.theme === "light"`, 3000, "light");
});

await page.close();
const failed = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
