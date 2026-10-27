import assert from "node:assert/strict";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { BASE, tempProfile, openDemoEraDevice } from "./env.mjs";

// Profile's menu (every row reaches its screen and Back returns to Profile), My Goals (add, edit, complete/reopen,
// delete with cancel and with confirm, the legacy notes link, empty states), and Settings' static subsections
// (Personal name/contact, Notifications/Privacy/Help info cards). Language, Appearance, Personal photo upload and
// the Wishlist row already have thorough coverage in app.mjs and discover.mjs and are not repeated here.
// Also regression-covers the "nothing saved yet" message added to Profile › Saved Activities and My Week › Saved
// (previously blank when there was nothing saved at all).

const page = await launch(tempProfile("profile"), 9348);
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
const openLink = async hashPath => { await page.nav("about:blank"); await page.nav(`${BASE}/${hashPath}`); await appReady(); };
const nav = async index => {
  if (!(await page.eval(`!!document.querySelector(".bottom-nav")`))) { await page.home(); await appReady(); }
  await page.eval(`__t.clickSel(".bottom-nav button", ${index})`); await sleep(200);
};
const NAV = { today: 0, discover: 1, kids: 3, profile: 4 };
const back = async () => { await page.eval(`__t.clickSel(".page-header .icon-button")`); await sleep(150); };
const menuRow = async label => { await page.eval(`__t.click(${q(label)}, ".menu-section button")`); await sleep(200); };
const noOverflow = async label => {
  const w = await page.eval(`document.documentElement.scrollWidth`);
  assert.ok(w <= 390, `${label}: page is ${w}px wide at 390px`);
};
const live = async store => (await page.eval(`__t.all(${q(store)})`)).filter(r => !r.deletedAt);

await openDemoEraDevice(page, `${BASE}/`);
await appReady();
await page.waitFor(`__t.dbExists()`, 10000, "data stored");

await step("Profile lists My Activities, Preferences and Account menu sections with every expected row", async () => {
  await nav(NAV.profile);
  const sections = await page.eval(`[...document.querySelectorAll(".menu-section")].map(s => ({ h: s.querySelector("h3").textContent, rows: [...s.querySelectorAll("button span")].map(x => x.textContent) }))`);
  assert.deepEqual(sections[0].rows, ["My Week", "Saved Activities", "Wishlist", "My Goals"]);
  assert.deepEqual(sections[1].rows, ["Language", "Appearance", "Notification Preferences"]);
  assert.ok(sections[2].rows.includes("Personal Information"));
  assert.ok(sections[2].rows.includes("Recently Deleted Children"));
  assert.ok(sections[2].rows.includes("Privacy & Data"));
  assert.ok(sections[2].rows.includes("Help & Support"));
  // No RootMap account row: this dev build runs with cloud features off.
  assert.ok(!sections[2].rows.includes("Account") && !(await page.eval(`document.body.innerText.includes("Sign In")`)));
});

await step("Every Profile row opens its own screen, and Back returns to Profile", async () => {
  const rows = [
    ["My Week", () => page.waitFor(`document.querySelector(".week-page, .page-content.week-page, h1")`, 3000)],
    ["Saved Activities", () => page.waitFor(`document.body.innerText.includes("Saved Activities")`, 3000)],
    ["My Goals", () => page.waitFor(`document.querySelector(".goals-page")`, 3000)],
    ["Language", () => page.waitFor(`document.querySelector(".choice-list")`, 3000)],
    ["Appearance", () => page.waitFor(`document.querySelector(".choice-list")`, 3000)],
    ["Notification Preferences", () => page.waitFor(`document.querySelector(".info-card")`, 3000)],
    ["Personal Information", () => page.waitFor(`document.querySelector(".form-fields")`, 3000)],
    ["Recently Deleted Children", () => page.waitFor(`document.querySelector(".page-header")`, 3000)],
    ["Privacy & Data", () => page.waitFor(`document.querySelector(".info-card")`, 3000)],
    ["Help & Support", () => page.waitFor(`document.querySelector(".info-card")`, 3000)],
  ];
  for (const [label, wait] of rows) {
    await nav(NAV.profile);
    await menuRow(label);
    await wait();
    assert.deepEqual(page.errors, [], `no console errors opening ${label}`);
    await back();
    await page.waitFor(`document.querySelector(".profile-page")`, 3000, `back to Profile from ${label}`);
  }
});

await step("Personal Information: editing name and contact, Save, and the change persists after a refresh", async () => {
  await nav(NAV.profile);
  await menuRow("Personal Information");
  await page.waitFor(`document.querySelector(".form-fields")`);
  const originalName = await page.eval(`document.querySelector(".form-fields input").value`);
  assert.ok(originalName, "name prefilled from profile");
  const inputs = await page.eval(`[...document.querySelectorAll(".form-fields input")].length`);
  assert.equal(inputs, 2, "name and contact fields");
  await page.eval(`
    const [name, contact] = document.querySelectorAll(".form-fields input");
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set(name, "Lin Wei Chen"); set(contact, "linwei@example.com");
  `);
  await page.eval(`document.querySelector(".simple-page > .wide-primary").click()`);
  await page.waitFor(`document.querySelector(".profile-page")`, 3000, "Save returns to Profile");
  assert.ok((await page.eval(`document.querySelector(".user-summary h2").textContent`)).includes("Lin Wei Chen"));
  await page.reload(); await appReady();
  const stored = (await page.eval(`__t.all("settings")`)).find(s => s.key === "rootmap-profile").value;
  assert.equal(stored.name, "Lin Wei Chen");
  assert.equal(stored.contact, "linwei@example.com");
  await nav(NAV.profile);
  await menuRow("Personal Information");
  await page.waitFor(`document.querySelector(".form-fields")`);
  const vals = await page.eval(`[...document.querySelectorAll(".form-fields input")].map(i => i.value)`);
  assert.deepEqual(vals, ["Lin Wei Chen", "linwei@example.com"], "fields reflect the saved values after refresh");
  await back();
});

await step("Privacy & Data and Help & Support show their static info text (no RootMap account mention: cloud is off)", async () => {
  await nav(NAV.profile);
  await menuRow("Privacy & Data");
  await page.waitFor(`document.querySelector(".info-card")`);
  const privacy = await page.eval(`document.querySelector(".info-card p").textContent`);
  assert.ok(privacy.includes("saved on this device"), privacy);
  assert.ok(!privacy.includes("backed up to your RootMap account"), "no account-sync text when cloud is off");
  await back();
  await menuRow("Help & Support");
  await page.waitFor(`document.querySelector(".info-card")`);
  assert.ok((await page.eval(`document.querySelector(".info-card p").textContent`)).includes("early testing"));
  await back();
});

await step("Notification Preferences (from Profile) and the direct #/notifications page both say reminders are coming, with different headings", async () => {
  await nav(NAV.profile);
  await menuRow("Notification Preferences");
  await page.waitFor(`document.querySelector(".info-card")`);
  assert.equal(await page.eval(`document.querySelector(".info-card h2").textContent`), "Reminders are coming");
  await back();
  await openLink("#/notifications");
  await page.waitFor(`document.querySelector(".notification-page .info-card")`, 3000, "orphan notifications page");
  assert.equal(await page.eval(`document.querySelector(".info-card h2").textContent`), "No notifications");
  assert.ok((await page.eval(`document.querySelector(".info-card p").textContent`)).includes("doesn't send reminders"));
});

await step("My Goals: empty state, then adding a goal shows it under Active", async () => {
  // Start this suite's own goals from zero by deleting the two demo goals directly (keeps this step independent
  // of exact demo fixture content, and exercises the true empty state, not just an empty filter).
  await page.eval(`__t.open().then(db => new Promise((res, rej) => { const tx = db.transaction("goals", "readwrite"); tx.objectStore("goals").clear(); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }))`);
  await nav(NAV.profile);
  await menuRow("My Goals");
  await page.waitFor(`document.querySelector(".goals-page")`);
  assert.equal(await page.eval(`document.querySelector(".journal-empty")?.textContent`), "No goals yet. Start with one small intention.");
  await page.eval(`__t.clickSel(".goals-add")`);
  await page.waitFor(`document.querySelector(".goal-form input")`);
  await page.eval(`__t.type(".goal-form input", "Read together every night")`);
  await page.eval(`__t.type(".goal-form textarea", "Even just one page")`);
  await page.eval(`document.querySelector(".goal-submit").click()`);
  await page.waitFor(`__t.all("goals").then(g => g.filter(x => !x.deletedAt).some(x => x.title === "Read together every night"))`);
  assert.ok(!(await page.eval(`!!document.querySelector(".journal-empty")`)), "empty message gone");
  assert.equal(await page.eval(`document.querySelector(".goal-row strong").textContent`), "Read together every night");
  assert.equal(await page.eval(`document.querySelector(".goal-row small").textContent`), "Even just one page");
});

let goalId;
await step("Editing a goal's title and description updates the row and the stored record", async () => {
  await page.eval(`__t.clickSel(".goal-body")`);
  await page.waitFor(`document.querySelector(".goal-form")`);
  await page.eval(`
    const [title, desc] = [document.querySelector(".goal-form input"), document.querySelector(".goal-form textarea")];
    const set = (el, v) => { const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set(title, "Read together three nights a week"); set(desc, "Weekends count double");
  `);
  await page.eval(`document.querySelector(".goal-submit").click()`);
  await page.waitFor(`document.body.innerText.includes("Read together three nights a week")`);
  const g = (await live("goals")).find(x => x.title === "Read together three nights a week");
  assert.ok(g, "updated title stored");
  assert.equal(g.description, "Weekends count double");
  goalId = g.id;
});

await step("Completing a goal moves it to Completed; reopening moves it back to Active", async () => {
  await page.eval(`__t.clickSel(".goal-check")`);
  await page.waitFor(`__t.all("goals").then(g => g.find(x => x.id === ${q(goalId)})?.completed)`);
  assert.ok(await page.eval(`!!document.querySelector(".goal-row.done")`), "row marked done");
  const sectionHeads = await page.eval(`[...document.querySelectorAll(".goal-section h3")].map(h => h.textContent)`);
  assert.ok(sectionHeads.some(h => h.startsWith("Completed")), sectionHeads.join(","));
  await page.eval(`__t.clickSel(".goal-row.done .goal-check")`);
  await page.waitFor(`__t.all("goals").then(g => !g.find(x => x.id === ${q(goalId)})?.completed)`);
  assert.ok(!(await page.eval(`!!document.querySelector(".goal-row.done")`)), "reopened");
});

await step("Deleting a goal: Cancel keeps it, confirming removes it (soft delete) and the empty state returns", async () => {
  await page.eval(`__t.clickSel(".goal-body")`);
  await page.waitFor(`document.querySelector(".goal-delete")`);
  await page.eval(`__t.clickSel(".goal-delete")`);
  const asked = await page.confirmDialog({ cancel: true });
  assert.ok(asked.includes("Delete this goal?"));
  assert.ok(await live("goals").then(g => g.some(x => x.id === goalId)), "kept after Cancel");
  assert.ok(await page.eval(`!!document.querySelector(".goal-form")`), "still editing after Cancel");
  await page.eval(`__t.clickSel(".goal-delete")`);
  await page.confirmDialog();
  await page.waitFor(`__t.all("goals").then(g => g.find(x => x.id === ${q(goalId)})?.deletedAt)`, 3000, "soft-deleted");
  assert.equal(await live("goals").then(g => g.length), 0);
  await page.waitFor(`document.querySelector(".journal-empty")?.textContent === "No goals yet. Start with one small intention."`, 3000, "empty state back");
});

await step("The legacy 'My earlier notes' link only shows when there are legacy notes, and opens/returns correctly", async () => {
  assert.ok(!(await page.eval(`!!document.querySelector(".goals-legacy")`)), "no legacy link without legacy notes");
  await page.eval(`__t.open().then(db => new Promise((res, rej) => { const tx = db.transaction("settings", "readwrite"); tx.objectStore("settings").put({ key: "rootmap-personal-notes", value: "Plan the garden bed together" }); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }))`);
  await page.reload(); await appReady();
  await nav(NAV.profile);
  await menuRow("My Goals");
  await page.waitFor(`document.querySelector(".goals-page")`);
  await page.waitFor(`document.querySelector(".goals-legacy")`, 3000, "legacy link shown");
  await page.eval(`__t.clickSel(".goals-legacy")`);
  await page.waitFor(`document.querySelector(".notes-pad")`, 3000, "notes page");
  assert.equal(await page.eval(`document.querySelector(".notes-pad").value`), "Plan the garden bed together");
  await back();
  await page.waitFor(`document.querySelector(".goals-page")`, 3000, "back on Goals");
});

await step("Regression: Profile › Saved Activities shows a message instead of a blank page when nothing is saved", async () => {
  await page.eval(`__t.open().then(db => new Promise((res, rej) => { const tx = db.transaction("saved", "readwrite"); tx.objectStore("saved").clear(); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }))`);
  await page.eval(`__t.open().then(db => new Promise((res, rej) => { const tx = db.transaction("savedCollections", "readwrite"); tx.objectStore("savedCollections").clear(); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }))`);
  await page.reload(); await appReady();
  await openLink("#/saved");
  await page.waitFor(`document.body.innerText.includes("Nothing saved yet")`, 3000, "empty message shown");
  assert.ok(!(await page.eval(`!!document.querySelector(".week-list")`)), "no empty list container shown instead");
});

await step("Regression: My Week › Saved tab shows the same message when there are no saved activities or collections", async () => {
  await openLink("#/my-week");
  await page.waitFor(`document.querySelector(".segmented")`);
  await page.eval(`__t.click("Saved", ".segmented button")`);
  await sleep(200);
  await page.waitFor(`document.body.innerText.includes("Nothing saved yet")`, 3000, "empty message shown in My Week");
});

await step("Chinese: Profile menu labels, Goals screen and Settings info cards are translated", async () => {
  await nav(NAV.profile);
  await menuRow("Language");
  await page.eval(`__t.click("简体中文")`);
  await page.waitFor(`document.documentElement.lang === "zh-CN"`, 3000, "Chinese");
  await back();
  const rows = await page.eval(`[...document.querySelectorAll(".menu-section")].flatMap(s => [...s.querySelectorAll("button span")].map(x => x.textContent))`);
  assert.ok(rows.includes("我的计划") && rows.includes("已收藏活动") && rows.includes("我的目标") && rows.includes("个人信息"), rows.join(","));
  await menuRow("我的目标");
  await page.waitFor(`document.querySelector(".goals-page")`);
  assert.equal(await page.eval(`document.querySelector(".journal-empty")?.textContent`), "还没有目标。从一个小小的心愿开始吧。");
  await back();
  await menuRow("隐私与数据");
  await page.waitFor(`document.querySelector(".info-card")`);
  assert.ok((await page.eval(`document.querySelector(".info-card p").textContent`)).includes("保存在这台设备"));
  await back();
  await nav(NAV.profile);
  await menuRow("语言");
  await page.eval(`__t.click("English")`);
  await page.waitFor(`document.documentElement.lang === "en"`, 3000, "English");
  await back();
});

await step("Dark mode: Profile, My Goals and Settings info cards use the dark theme and fit 390px", async () => {
  await nav(NAV.profile);
  await menuRow("Appearance");
  await page.eval(`__t.click("Dark")`);
  await page.waitFor(`document.documentElement.dataset.theme === "dark"`, 3000, "dark");
  await back();
  await noOverflow("Profile (dark)");
  await menuRow("My Goals");
  await page.waitFor(`document.querySelector(".goals-page")`);
  await noOverflow("Goals (dark)");
  const goalsBg = await page.eval(`getComputedStyle(document.querySelector(".goals-page")).backgroundColor`);
  await back();
  await menuRow("Help & Support");
  await page.waitFor(`document.querySelector(".info-card")`);
  await noOverflow("Help (dark)");
  assert.notEqual(goalsBg, "rgb(255, 255, 255)", "Goals page is not using the light background in dark mode");
  await back();
  await nav(NAV.profile);
  await menuRow("Appearance");
  await page.eval(`__t.click("Light")`);
  await page.waitFor(`document.documentElement.dataset.theme === "light"`, 3000, "light");
});

await page.close();
const failed = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
