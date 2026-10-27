import assert from "node:assert/strict";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { BASE, tempProfile } from "./env.mjs";

// The exact end-to-end story a new parent lives through, as one continuous journey instead of isolated steps:
// add a first child (from Today's welcome card) → find an activity in Discover → save it → add it to My Week →
// mark it as tried (completing the plan) → write a Moment about it → refresh the whole app once → everything from
// every step is still there together. fresh.mjs and memories.mjs already check each of these mechanisms on its own
// (and their edge cases); this suite's job is only the single combined journey and its one shared refresh.

const page = await launch(tempProfile("journey"), 9349);
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

const q = JSON.stringify;
const appReady = () => page.waitFor(`document.querySelector(".app-shell") && document.querySelector(".bottom-nav, main")`, 15000, "app rendered");
const nav = async index => {
  if (!(await page.eval(`!!document.querySelector(".bottom-nav")`))) { await page.home(); await appReady(); }
  await page.eval(`__t.clickSel(".bottom-nav button", ${index})`); await sleep(200);
};
const NAV = { today: 0, discover: 1, kids: 3, profile: 4 };
const noModal = () => page.waitFor(`!document.querySelector(".overlay")`, 3000, "sheet closed");
const live = async store => (await page.eval(`__t.all(${q(store)})`)).filter(r => !r.deletedAt);
const text = () => page.eval(`document.body.innerText`);

await page.nav(`${BASE}/`);
await appReady();

let childId, activityId, planId;

await step("1. A new parent adds their first child from Today's welcome card", async () => {
  await nav(NAV.today);
  await page.waitFor(`document.querySelector(".today-welcome .wide-primary")`, 5000, "welcome card");
  assert.equal((await live("children")).length, 0, "no children yet");
  await page.eval(`__t.clickSel(".today-welcome .wide-primary")`);
  await page.waitFor(`document.querySelector(".overlay .sheet-fields")`, 3000, "Add Child open");
  await page.eval(`__t.type(".overlay input", "Sora Kim")`);
  await page.eval(`__t.type(".overlay input[type=date]", "2022-06-15")`);
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await noModal();
  const children = await live("children");
  assert.equal(children.length, 1, "child saved");
  assert.equal(children[0].first, "Sora");
  childId = children[0].id;
});

await step("2. The parent finds an activity for Sora in Discover", async () => {
  await nav(NAV.discover);
  await page.waitFor(`document.querySelector(".discover-search input")`, 3000, "Discover");
  // "Water Pouring" matches through the activity's keywords; its displayed title is "Getting Water".
  await page.eval(`__t.type(".discover-search input", "Water Pouring")`);
  await sleep(200);
  await page.waitFor(`[...document.querySelectorAll(".activity-card")].some(c => c.innerText.includes("Getting Water"))`, 3000, "search result found");
  await page.eval(`[...document.querySelectorAll(".activity-card")].find(c => c.innerText.includes("Getting Water")).querySelector(".activity-image").click()`);
  await page.waitFor(`document.querySelector(".detail-page")`, 3000, "activity page");
  activityId = (await page.eval(`location.hash`)).replace("#/activity/", "");
  assert.equal(activityId, "water-pouring");
});

await step("3. The parent saves it (heart) for later", async () => {
  assert.equal(await page.eval(`document.querySelector(".detail-actions button[aria-pressed]").getAttribute("aria-pressed")`), "false");
  await page.eval(`__t.clickSel(".detail-actions button[aria-pressed]")`);
  await page.waitFor(`document.querySelector(".detail-actions button[aria-pressed]")?.getAttribute("aria-pressed") === "true"`, 3000, "saved");
  assert.ok((await live("saved")).some(s => s.id === activityId), "stored in saved");
});

await step("4. The parent adds it to My Week for Sora", async () => {
  await page.eval(`__t.click("Add to My Week", ".sticky-action button")`);
  await page.waitFor(`document.querySelector(".overlay .child-checks")`, 3000, "plan sheet");
  // One child only: already chosen.
  assert.ok(await page.eval(`document.querySelector(".overlay .child-checks button").classList.contains("active")`), "Sora pre-selected");
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await noModal();
  const plans = await live("plans");
  const plan = plans.find(p => p.activityId === activityId);
  assert.ok(plan, "plan created");
  assert.deepEqual(plan.childIds, [childId]);
  assert.ok(!plan.completed, "not completed yet");
  planId = plan.id;
});

await step("5. The parent marks it as tried from My Week, completing the plan", async () => {
  await nav(NAV.profile);
  await page.eval(`__t.click("My Week", ".menu-section button")`);
  await page.waitFor(`document.querySelector(".week-page")`, 3000, "My Week");
  await page.eval(`__t.click("Weekly Plan", ".segmented button")`);
  await sleep(200);
  const row = `[...document.querySelectorAll(".day-plan")].find(d => d.innerText.includes("Getting Water"))`;
  await page.eval(`(() => { const b = ${row}.querySelector(".plan-actions button"); b.click(); b.click(); })()`);
  await page.waitFor(`__t.all("plans").then(ps => ps.find(p => p.id === ${q(planId)})?.completed)`, 3000, "plan completed");
  await sleep(300);
  const records = (await live("records")).filter(r => r.planId === planId);
  assert.equal(records.length, 1, "one history record created, not duplicated");
  assert.equal(records[0].kind, "tried");
  assert.equal(records[0].childId, childId);
});

await step("6. The tried activity shows on Sora's Activities history", async () => {
  await page.eval(`location.hash = ${q(`#/child/${childId}/activities`)}`);
  await page.waitFor(`document.querySelector(".lesson-list")`, 3000, "history");
  assert.ok((await text()).includes("Getting Water"), "activity listed in history");
});

let momentText;
await step("7. The parent records a Moment about it", async () => {
  momentText = `Sora loved pouring water today ${Date.now()}`;
  await nav(NAV.today);
  await page.eval(`__t.clickSel(".nav-add")`);
  await page.waitFor(`document.querySelector(".overlay")`, 3000, "Quick Add open");
  await page.eval(`__t.click("Add Moment", ".overlay button")`);
  await page.waitFor(`document.querySelector(".journal-editor")`, 3000, "editor open");
  await page.eval(`__t.type(".journal-editor textarea", ${q(momentText)})`);
  // With only one child, the entry is already attributed to Sora; if not, choose her explicitly.
  if (await page.eval(`!!document.querySelector(".entry-child-pick select")`)) {
    await page.eval(`__t.type(".entry-child-pick select", ${q(childId)})`);
  }
  await page.waitFor(`!document.querySelector(".journal-save").disabled`, 3000, "save enabled");
  await page.eval(`__t.clickSel(".journal-save")`);
  await page.waitFor(`!document.querySelector(".journal-editor")`, 5000, "editor closed");
  const entries = await live("entries");
  assert.ok(entries.some(e => e.text === momentText && e.childId === childId), "moment stored for Sora");
});

await step("8. The Moment appears in Moments", async () => {
  await page.eval(`location.hash = "#/moments"`);
  await sleep(300);
  assert.ok((await text()).includes(momentText), "Moment visible in Moments");
});

await step("9. A single refresh: the child, the saved activity, the completed plan/record and the Moment are all still there", async () => {
  await page.reload();
  await appReady();
  await page.waitFor(`__t.dbExists()`, 10000, "data stored");

  const children = await live("children");
  assert.equal(children.length, 1);
  assert.equal(children[0].first, "Sora");

  assert.ok((await live("saved")).some(s => s.id === activityId), "saved activity persists");

  const plans = await live("plans");
  const plan = plans.find(p => p.id === planId);
  assert.ok(plan && plan.completed, "completed plan persists");

  const records = (await live("records")).filter(r => r.planId === planId);
  assert.equal(records.length, 1, "exactly one history record persists (no duplicate on refresh)");
  assert.equal(records[0].kind, "tried");

  const entries = await live("entries");
  assert.ok(entries.some(e => e.text === momentText && e.childId === childId), "Moment persists");

  // And it's all visible in the UI too, not just the database.
  await nav(NAV.kids);
  assert.ok((await text()).includes("Sora"), "Sora shown on Kids");
  await page.eval(`location.hash = ${q(`#/child/${childId}/activities`)}`);
  await page.waitFor(`document.querySelector(".lesson-list")`, 3000, "history after refresh");
  assert.ok((await text()).includes("Getting Water"), "activity history shown after refresh");
  await page.eval(`__t.click("Journal", ".child-profile .tabs button")`);
  await sleep(200);
  assert.ok((await text()).includes(momentText), "Moment shown on Sora's Journal tab after refresh");
});

await page.close();
const failed = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
