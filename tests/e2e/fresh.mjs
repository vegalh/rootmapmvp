import assert from "node:assert/strict";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { BASE, tempProfile } from "./env.mjs";

// A new family on a new device, and the fixes from product testing: no demo data, choosing the child a record is for
// (and never a removed one), Add Child validation and double taps, browser Back / refresh / shared links, completing
// a planned activity, Chinese, and the navigation staying in view on a phone and on a desktop.

const page = await launch(tempProfile("fresh"), 9371);
await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
const phone = () => page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const desktop = () => page.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await phone();

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
const live = async store => (await page.eval(`__t.all(${q(store)})`)).filter(r => !r.deletedAt);
const noModal = () => page.waitFor(`!document.querySelector(".overlay")`, 3000, "sheet closed");
const text = () => page.eval(`document.body.innerText`);
const hash = () => page.eval(`location.hash`);
// Opens an address as a new visit (a shared link pasted into the browser), not as a change within the open page.
const openLink = async hashPath => { await page.nav("about:blank"); await page.nav(`${BASE}/${hashPath}`); await appReady(); };
const openActivity = async id => { await page.eval(`location.hash = ${q(`#/activity/${id}`)}`); await page.waitFor(`document.querySelector(".detail-page")`, 3000, id); };
const addChild = async (name, dob) => {
  await nav(NAV.kids);
  await page.eval(`__t.clickSel(".header-add-child")`);
  await page.waitFor(`document.querySelector(".overlay .sheet-fields")`, 3000, "Add Child open");
  await page.eval(`__t.type(".overlay input", ${q(name)})`);
  await page.eval(`__t.type(".overlay input[type=date]", ${q(dob)})`);
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await noModal();
};

await page.nav(`${BASE}/`);
await appReady();

await step("A new family gets no demo children, records, Moments, favorites, notifications or parent profile", async () => {
  await sleep(300);
  for (const store of ["children", "records", "observations", "entries", "saved", "plans"]) assert.equal((await live(store)).length, 0, store);
  const t = await text();
  for (const demo of ["Maya", "Leo", "Alex Hao"]) assert.ok(!t.includes(demo), demo);
  // A warm first step on Today, and on Kids.
  assert.ok(await page.eval(`!!document.querySelector(".today-welcome .wide-primary")`), "welcome card");
  assert.ok(t.includes("Welcome to RootMap"));
  await nav(NAV.kids);
  // One Add Child button, in the header, also with no children.
  assert.ok((await text()).includes("No children yet"));
  assert.equal(await page.eval(`[...document.querySelectorAll("button")].filter(b => /Add Child|first child/i.test(b.textContent)).length`), 1);
  assert.ok(!(await page.eval(`!!document.querySelector(".add-child-card")`)), "no add card");
  assert.ok(!(await page.eval(`!!document.querySelector(".bell-button")`)), "no bell leading to sample notifications");
  await nav(NAV.profile);
  assert.ok((await text()).includes("Add your name"));
  // Stays without demo data after a refresh.
  await page.reload(); await appReady();
  assert.equal((await live("children")).length, 0);
  assert.equal((await page.eval(`__t.all("settings")`)).find(s => s.key === "rootmap-no-demo")?.value, true);
});

await step("Add Child: a name and a real, past birthday are required; a double tap adds the child once", async () => {
  await nav(NAV.kids);
  await page.eval(`__t.clickSel(".header-add-child")`);
  await page.waitFor(`document.querySelector(".overlay .sheet-fields")`, 3000, "Add Child open");
  assert.ok(!(await page.eval(`!!document.querySelector(".overlay select, .overlay textarea")`)), "no Group or Notes fields");
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await page.waitFor(`document.querySelector(".overlay [role=alert]")?.textContent.includes("name")`, 3000, "name required");
  await page.eval(`__t.type(".overlay input", "Mia Chen")`);
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await page.waitFor(`document.querySelector(".overlay [role=alert]")?.textContent.includes("date of birth")`, 3000, "birthday required");
  await page.eval(`__t.type(".overlay input[type=date]", "2099-05-01")`);
  await page.waitFor(`document.querySelector(".overlay [role=alert]")?.textContent.includes("future")`, 3000, "future refused");
  await page.eval(`__t.clickSel(".overlay .modal-primary")`); await sleep(200);
  assert.equal((await live("children")).length, 0, "nothing saved with a future birthday");
  await page.eval(`__t.type(".overlay input[type=date]", "2023-04-02")`);
  // Two taps before the sheet can close.
  await page.eval(`(() => { const b = document.querySelector(".overlay .modal-primary"); b.click(); b.click(); })()`);
  await noModal();
  await sleep(300);
  const kids = await live("children");
  assert.equal(kids.length, 1, "added once");
  assert.equal(await page.eval(`[...document.querySelectorAll("button")].filter(b => /Add Child/i.test(b.textContent)).length`), 1, "still one Add Child button");
  assert.equal(kids[0].first, "Mia"); assert.equal(kids[0].dob, "2023-04-02");
  assert.equal(kids[0].photo, "", "no stock photo of a real child");
  // Age comes from the birthday; the avatar shows initials.
  assert.ok(/\d year/.test(await text()));
  assert.ok(await page.eval(`document.querySelector(".child-select-photo img").src.startsWith("data:image/svg+xml")`), "initials avatar");
});

await step("With one child, every form chooses that child and shows it before saving", async () => {
  const mia = (await live("children"))[0];
  await openActivity("dotting");
  await page.eval(`__t.click("Mark as Tried", ".sticky-action button")`);
  await page.waitFor(`document.querySelector(".overlay select")`, 3000, "tried sheet");
  assert.equal(await page.eval(`document.querySelector(".overlay select").value`), mia.id);
  assert.ok(await page.eval(`!document.querySelector(".overlay .sheet-buttons button:last-child").disabled`));
  assert.ok((await text()).includes("Skills"), "skills shown read-only");
  await page.eval(`document.querySelector(".overlay header button").click()`); await noModal();
  await page.eval(`__t.click("Add to My Week", ".sticky-action button")`);
  await page.waitFor(`document.querySelector(".overlay .child-checks")`, 3000, "plan sheet");
  assert.ok(await page.eval(`document.querySelector(".overlay .child-checks button").classList.contains("active")`), "Mia chosen");
  await page.eval(`document.querySelector(".overlay header button").click()`); await noModal();
  await nav(NAV.today);
  await page.eval(`__t.clickSel(".nav-add")`);
  await page.eval(`__t.click("Add Activity", ".overlay button")`);
  await page.waitFor(`document.querySelector(".picker-page")`, 3000, "picker");
  await page.eval(`__t.clickSel(".picker-row")`);
  await page.waitFor(`document.querySelector(".form-bottom")`, 3000, "form");
  assert.ok(await page.eval(`document.querySelector(".form-child")?.innerText.includes("Mia")`), "selected child shown");
  assert.ok(await page.eval(`!document.querySelector(".form-bottom button").disabled`));
  await page.eval(`__t.click("Cancel", ".form-bottom button")`);
});

await step("With several children nothing is assumed: Save waits for a choice, and same-name children are told apart", async () => {
  await addChild("Mia Chen", "2021-01-15");
  await addChild("Leo Wong", "2024-03-03");
  assert.equal((await live("children")).length, 3);
  await nav(NAV.today);
  await page.eval(`__t.clickSel(".nav-add")`);
  await page.eval(`__t.click("Add Activity", ".overlay button")`);
  await page.waitFor(`document.querySelector(".picker-page")`, 3000, "picker");
  await page.eval(`__t.clickSel(".picker-row")`);
  await page.waitFor(`document.querySelector(".form-bottom")`, 3000, "form");
  assert.ok(await page.eval(`document.querySelector(".form-bottom button").disabled`), "Save disabled until a child is chosen");
  assert.equal(await page.eval(`document.querySelector(".form-fields select").value`), "");
  const options = await page.eval(`[...document.querySelectorAll(".form-fields select option")].filter(o => o.value).map(o => o.textContent)`);
  assert.equal(new Set(options).size, options.length, `distinct names: ${options}`);
  const leo = (await live("children")).find(c => c.first === "Leo");
  await page.eval(`__t.type(".form-fields select", ${q(leo.id)})`);
  await page.waitFor(`!document.querySelector(".form-bottom button").disabled`, 3000, "Save enabled");
  await page.eval(`__t.click("Save", ".form-bottom button")`);
  await page.waitFor(`document.querySelector(".child-profile")`, 3000, "Leo's activities");
  const r = (await live("records")).find(x => x.childId === leo.id);
  assert.ok(r, "saved for the chosen child");
  // New Moment from Quick Add: no child assumed either.
  await nav(NAV.today);
  await page.eval(`__t.clickSel(".nav-add")`);
  await page.eval(`__t.click("Add Moment", ".overlay button")`);
  await page.waitFor(`document.querySelector(".journal-editor")`, 3000, "editor");
  await page.eval(`__t.type(".journal-editor textarea", "First steps")`);
  assert.ok(await page.eval(`document.querySelector(".journal-save").disabled`), "no child chosen yet");
  await page.eval(`__t.clickSel(".journal-editor-bar button")`);
});

await step("A removed child can't receive anything: not preselected, not offered, and no record is saved for them", async () => {
  const leo = (await live("children")).find(c => c.first === "Leo");
  await page.eval(`location.hash = ${q(`#/child/${leo.id}`)}`);
  await page.waitFor(`document.querySelector(".child-profile")`, 3000, "Leo");
  await page.eval(`window.confirm = () => true`);
  await page.eval(`document.querySelector(".child-header-actions button:last-child").click()`);
  await page.waitFor(`!document.querySelector(".child-profile")`, 3000, "removed");
  const recordsBefore = (await page.eval(`__t.all("records")`)).filter(r => r.childId === leo.id).length;
  // The page of the removed child is gone (its address opens Kids), and no form offers him.
  await page.eval(`location.hash = ${q(`#/child/${leo.id}`)}`); await sleep(300);
  assert.ok(!(await page.eval(`!!document.querySelector(".child-profile")`)));
  await page.eval(`location.hash = ${q(`#/add-activity?child=${leo.id}`)}`);
  await page.waitFor(`document.querySelector(".picker-page")`, 3000, "picker");
  await page.eval(`__t.clickSel(".picker-row")`);
  await page.waitFor(`document.querySelector(".form-bottom")`, 3000, "form");
  assert.ok(!(await page.eval(`[...document.querySelectorAll(".form-fields select option")].some(o => o.value === ${q(leo.id)})`)), "not offered");
  assert.notEqual(await page.eval(`document.querySelector(".form-fields select").value`), leo.id);
  await page.eval(`__t.click("Cancel", ".form-bottom button")`);
  await openActivity("dotting");
  await page.eval(`__t.click("Add to My Week", ".sticky-action button")`);
  await page.waitFor(`document.querySelector(".overlay .child-checks")`, 3000, "plan sheet");
  assert.ok(!(await page.eval(`document.querySelector(".overlay .child-checks").innerText.includes("Leo")`)));
  await page.eval(`document.querySelector(".overlay header button").click()`); await noModal();
  assert.equal((await page.eval(`__t.all("records")`)).filter(r => r.childId === leo.id).length, recordsBefore, "no new record");
  // His earlier record is kept (restoring him brings it back).
  assert.ok((await page.eval(`__t.all("records")`)).some(r => r.childId === leo.id && !r.deletedAt));
});

await step("Browser Back, refresh and shared links: activity, book and child pages", async () => {
  await nav(NAV.discover);
  assert.equal(await hash(), "#/discover");
  await page.eval(`__t.clickSel(".activity-card .activity-image")`);
  await page.waitFor(`document.querySelector(".detail-page")`, 3000, "activity");
  const activityHash = await hash();
  assert.match(activityHash, /^#\/activity\//);
  const title = await page.eval(`document.querySelector(".detail-content h1").textContent`);
  // Refresh keeps the page.
  await page.reload(); await appReady();
  assert.equal(await hash(), activityHash);
  assert.equal(await page.eval(`document.querySelector(".detail-content h1")?.textContent`), title);
  // Browser Back returns to Discover.
  await page.eval(`history.back()`);
  await page.waitFor(`document.querySelector(".discover-page")`, 3000, "back to Discover");
  // Forward, then the in-app back button: same place, and the history doesn't grow.
  await page.eval(`history.forward()`);
  await page.waitFor(`document.querySelector(".detail-page")`, 3000, "forward");
  const len = await page.eval(`history.length`);
  await page.eval(`document.querySelector(".detail-actions button").click()`);
  await page.waitFor(`document.querySelector(".discover-page")`, 3000, "in-app back");
  assert.equal(await page.eval(`history.length`), len);
  // A shared book link opens the book directly, and Back leaves it.
  await openLink("#/discover/books");
  await page.eval(`__t.clickSel(".book-tile")`);
  await page.waitFor(`document.querySelector(".book-detail")`, 3000, "book");
  const bookHash = await hash();
  assert.match(bookHash, /^#\/book\//);
  await openLink(bookHash);
  await page.waitFor(`document.querySelector(".book-detail")`, 3000, "book from link");
  await openLink(activityHash);
  assert.equal(await page.eval(`document.querySelector(".detail-content h1")?.textContent`), title, "activity from link");
  // A child's page keeps its tab across a refresh.
  const mia = (await live("children"))[0];
  await openLink(`#/child/${mia.id}/activities`);
  await page.waitFor(`document.querySelector(".tabs .active")?.textContent === "Activities"`, 3000, "Activities tab");
  // Unknown activity in a link: Discover instead of a wrong activity.
  await openLink("#/activity/no-such-activity");
  await page.waitFor(`document.querySelector(".discover-page")`, 3000, "unknown activity → Discover");
});

await step("Completing a planned activity adds it to the child's history once, and the record can be corrected", async () => {
  const mia = (await live("children")).find(c => c.first === "Mia" && c.dob === "2023-04-02");
  await openActivity("watering-plant");
  await page.eval(`__t.click("Add to My Week", ".sticky-action button")`);
  await page.waitFor(`document.querySelector(".overlay .child-checks")`, 3000, "plan sheet");
  await page.eval(`document.querySelectorAll(".overlay .child-checks button")[0].click()`);
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await page.waitFor(`document.querySelector(".week-page")`, 3000, "My Week");
  const plan = (await live("plans")).find(p => p.activityId === "watering-plant");
  assert.ok(plan.childIds.length === 1);
  const childId = plan.childIds[0];
  assert.ok([mia.id, ...(await live("children")).map(c => c.id)].includes(childId));
  const row = `[...document.querySelectorAll(".day-plan")].find(d => d.innerText.includes("Watering"))`;
  await page.eval(`(() => { const b = ${row}.querySelector(".plan-actions button"); b.click(); b.click(); })()`);
  await page.waitFor(`__t.all("plans").then(ps => ps.find(p => p.id === ${q(plan.id)}).completed)`, 3000, "completed");
  await sleep(300);
  const made = (await live("records")).filter(r => r.planId === plan.id);
  assert.equal(made.length, 1, "one history record");
  assert.equal(made[0].childId, childId);
  await page.eval(`location.hash = ${q(`#/child/${childId}/activities`)}`);
  await page.waitFor(`document.querySelector(".lesson-list")`, 3000, "history");
  assert.ok((await text()).includes("Watering"), "shown in the child's activities");
  // Corrections: date and notes, same record id.
  await page.eval(`[...document.querySelectorAll(".lesson-list > button")].find(b => b.innerText.includes("Watering")).click()`);
  await page.waitFor(`document.querySelector(".overlay .record-detail")`, 3000, "detail");
  await page.eval(`__t.click("Edit", ".overlay .sheet-buttons button")`);
  await page.waitFor(`document.querySelector(".overlay input[type=date]")`, 3000, "edit sheet");
  await page.eval(`__t.type(".overlay input[type=date]", "2026-10-01")`);
  await page.eval(`__t.type(".overlay textarea", "Watered the basil")`);
  await page.eval(`__t.click("Save", ".overlay .sheet-buttons button")`);
  await noModal();
  const edited = (await live("records")).find(r => r.id === made[0].id);
  assert.equal(edited.date, "2026-10-01"); assert.equal(edited.notes, "Watered the basil"); assert.equal(edited.activityId, "watering-plant");
});

await step("Chinese: navigation, Today, forms, validation, dates, weekdays and accessible names", async () => {
  await nav(NAV.profile);
  await page.eval(`__t.click("Language", ".menu-section button")`);
  await page.eval(`__t.click("简体中文")`);
  await page.waitFor(`document.documentElement.lang === "zh-CN"`, 3000, "Chinese");
  await page.home(); await appReady();
  assert.ok((await page.eval(`document.querySelector(".bottom-nav").innerText`)).includes("孩子"));
  assert.equal(await page.eval(`document.querySelector(".nav-add").getAttribute("aria-label")`), "快速添加");
  await nav(NAV.profile);
  assert.ok((await text()).includes("家长"), "家长, not 父亲");
  assert.ok(!(await text()).includes("父亲"));
  await page.eval(`__t.click("我的计划", ".menu-section button")`);
  await page.waitFor(`document.querySelector(".week-page")`, 3000, "My Week");
  assert.equal(await page.eval(`document.querySelector(".page-header .icon-button").getAttribute("aria-label")`), "返回");
  await page.eval(`__t.click("已完成", ".segmented button")`); await sleep(150);
  assert.ok(/\d{4}年\d{1,2}月\d{1,2}日/.test(await page.eval(`document.querySelector(".week-list").innerText`)), "Chinese date");
  await nav(NAV.kids);
  await page.eval(`__t.clickSel(".header-add-child")`);
  await page.waitFor(`document.querySelector(".overlay .sheet-fields")`, 3000, "Add Child");
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await page.waitFor(`document.querySelector(".overlay [role=alert]")?.textContent.includes("名字")`, 3000, "Chinese validation");
  await page.eval(`document.querySelector(".overlay header button").click()`); await noModal();
  await openActivity("olive-fingers");
  assert.ok((await text()).includes("安全提示"), "safety note in Chinese");
  assert.ok((await text()).includes("切成适合年龄的小块"), "cut olives into small pieces");
  await nav(NAV.profile);
  await page.eval(`__t.click("语言", ".menu-section button")`);
  await page.eval(`__t.click("English")`);
  await page.waitFor(`document.documentElement.lang === "en"`, 3000, "English");
});

const navInView = () => page.eval(`(() => { const n = document.querySelector(".bottom-nav").getBoundingClientRect(); return n.top >= 0 && n.bottom <= innerHeight + 1 && n.height > 40; })()`);
const insideFrame = sel => page.eval(`(() => { const s = document.querySelector(".app-shell").getBoundingClientRect(); const n = document.querySelector(${q(sel)}).getBoundingClientRect(); return n.left >= s.left - 1 && n.right <= s.right + 1; })()`);

await step("The bottom navigation stays in view at the end of a long page: phone 390×844 and desktop 1440×900", async () => {
  for (const [label, size] of [["phone", phone], ["desktop", desktop]]) {
    await size();
    await nav(NAV.discover);
    await page.eval(`window.scrollTo(0, document.body.scrollHeight)`); await sleep(300);
    assert.ok(await page.eval(`scrollY > 300`), `${label}: the page is long`);
    assert.ok(await navInView(), `${label}: navigation visible after scrolling`);
    assert.ok(await insideFrame(".bottom-nav"), `${label}: navigation inside the app frame`);
    // Sheets open in view too.
    await page.eval(`__t.clickSel(".nav-add")`);
    await page.waitFor(`document.querySelector(".bottom-sheet")`, 3000, "sheet");
    await sleep(350); // the sheet slides up
    assert.ok(await page.eval(`(() => { const r = document.querySelector(".bottom-sheet").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1; })()`), `${label}: sheet in view`);
    await page.eval(`document.querySelector(".overlay header button").click()`); await noModal();
    // The Mark as Tried / Add to My Week bar on a long activity page.
    await openActivity("cooking-eggs");
    await page.eval(`window.scrollTo(0, document.body.scrollHeight)`); await sleep(200);
    assert.ok(await page.eval(`(() => { const r = document.querySelector(".sticky-action").getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top > 0; })()`), `${label}: action bar in view`);
    assert.ok(await page.eval(`document.documentElement.scrollWidth <= innerWidth`), `${label}: no sideways scrolling`);
  }
  await phone();
});

await step("Dark mode: filter chips, suggestions and the safety note use the dark theme", async () => {
  await nav(NAV.profile);
  await page.eval(`__t.click("Appearance", ".menu-section button")`);
  await page.eval(`__t.click("Dark")`);
  await page.waitFor(`document.documentElement.dataset.theme === "dark"`, 3000, "dark");
  // "rgb(…)" or "color(srgb 0–1 …)": light when the average channel is above 200 of 255.
  const light = c => { const n = c.match(/[\d.]+/g).map(Number); const rgb = c.startsWith("color(") ? n.slice(0, 3).map(x => x * 255) : n.slice(0, 3); return rgb.reduce((a, b) => a + b, 0) / 3 > 200; };
  await nav(NAV.discover);
  for (const sel of [".filter-pill", ".age-suggestions button", ".activity-card", ".search"]) {
    const bg = await page.eval(`getComputedStyle(document.querySelector(${q(sel)})).backgroundColor`);
    assert.ok(!light(bg), `${sel}: ${bg}`);
  }
  await openActivity("cooking-eggs");
  const bg = await page.eval(`getComputedStyle(document.querySelector(".safety-note")).backgroundColor`);
  assert.ok(!light(bg), `safety note: ${bg}`);
  await nav(NAV.profile);
  await page.eval(`__t.click("Appearance", ".menu-section button")`);
  await page.eval(`__t.click("Light")`);
});

await page.close();
const failed = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
