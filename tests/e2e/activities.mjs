import assert from "node:assert/strict";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { BASE, tempProfile } from "./env.mjs";

// One activity catalog, two ways to record: Kids › child › Activities › Add Activity (search-first picker, then the
// form) and Discover › activity › Mark as Tried (the activity is already known). Both store records the same way;
// older records, custom activities and Mark as Tried records all show in the child's history.

const page = await launch(tempProfile("activities"), 9344);
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
const appReady = () => page.waitFor(`document.querySelector(".bottom-nav")`, 15000, "app rendered");
// Child and form pages have no bottom bar: go back to My Children first.
const nav = async index => {
  if (await page.eval(`!document.querySelector(".bottom-nav") && !!document.querySelector(".child-header > button")`)) { await page.eval(`__t.clickSel(".child-header > button")`); await sleep(200); }
  if (!(await page.eval(`!!document.querySelector(".bottom-nav")`))) { await page.reload(); await appReady(); }
  await page.eval(`__t.clickSel(".bottom-nav button", ${index})`); await sleep(200);
};
const NAV = { today: 0, discover: 1, kids: 3, profile: 4 };
const live = async store => (await page.eval(`__t.all(${q(store)})`)).filter(r => !r.deletedAt);
const rows = () => page.eval(`[...document.querySelectorAll(".picker-row")].map(r => ({ title: r.querySelector("strong").textContent, meta: r.querySelector("small").textContent }))`);
const search = async text => { await page.eval(`__t.type(".picker-page .search input", ${q(text)})`); await sleep(150); };
const chip = async label => { await page.eval(`__t.click(${q(label)}, ".category-chips button")`); await sleep(150); };
const history = () => page.eval(`[...document.querySelectorAll(".lesson-list > button")].map(b => b.innerText.replace(/\\s+/g, " ").trim())`);
const noOverflow = async label => {
  const w = await page.eval(`document.documentElement.scrollWidth`);
  assert.ok(w <= 390, `${label}: page is ${w}px wide at 390px`);
};
const openChild = async () => {
  await nav(NAV.kids);
  await page.eval(`__t.clickSel(".child-select-card:not(.add-child-card)")`);
  await page.waitFor(`document.querySelector(".child-profile")`, 3000, "child open");
  await page.eval(`__t.click(${q(lang === "zh" ? "活动记录" : "Activities")}, ".tabs button")`);
  await sleep(150);
};
const openPicker = async () => {
  await openChild();
  await page.eval(`__t.clickSel(".child-profile .wide-primary")`);
  await page.waitFor(`document.querySelector(".picker-page")`, 3000, "activity picker open");
};
const save = async () => { await page.eval(`__t.clickSel(".form-bottom button")`); await sleep(300); };
let lang = "en";

await page.nav(`${BASE}/`);
await appReady();
await page.waitFor(`__t.dbExists()`, 10000, "data stored");
const today = await page.eval(`(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })()`);
const recordsBefore = await live("records");
const entriesBefore = await live("entries");
let childId;

await step("Kids › child › Activities › Add Activity opens the search-first picker", async () => {
  await openPicker();
  assert.ok(await page.eval(`document.querySelector(".page-header h1").textContent === "Add Activity"`));
  assert.ok(await page.eval(`document.querySelector(".page-header p").textContent.startsWith("Recording for")`), "child is known");
  assert.ok(await page.eval(`document.querySelector(".picker-page .search input").placeholder.includes("Search activities")`));
  const chips = await page.eval(`[...document.querySelectorAll(".category-chips button")].map(b => b.textContent)`);
  assert.equal(chips[0], "All");
  for (const c of ["Practical Life", "Art", "Movement", "Music"]) assert.ok(chips.includes(c), c);
  assert.ok(!(await page.eval(`document.body.innerText.includes("Recently Used")`)), "no recent activities yet: section hidden");
  assert.ok((await rows()).length > 0);
  assert.ok(await page.eval(`!!document.querySelector(".picker-custom")`), "custom option offered");
  assert.ok(!(await page.eval(`!!document.querySelector(".picker-page select")`)), "no dropdown of activities");
  await noOverflow("picker");
});

await step("Search: English title, Chinese title, keywords, partial and no results", async () => {
  await search("POUR");
  const pour = await rows();
  assert.ok(pour.length > 0 && pour.some(r => /pour/i.test(r.title)), "English partial, any case");
  await search("倒水");
  assert.ok((await rows()).length > 0, "Chinese title in the English interface");
  await search("gross motor");
  assert.ok((await rows()).some(r => r.title === "Duck Walk"), "keywords");
  await search("zzz-no-such-thing");
  assert.equal((await rows()).length, 0);
  assert.ok(await page.eval(`document.querySelector(".empty")?.textContent.includes("No results found.")`));
  assert.ok(await page.eval(`!!document.querySelector(".picker-custom")`), "custom option still offered");
  await search("");
});

await step("Category and search filter together; Music is a category", async () => {
  await chip("Practical Life");
  await search("water");
  const found = await rows();
  assert.ok(found.length > 0);
  assert.ok(found.every(r => r.meta.startsWith("Practical Life")), JSON.stringify(found));
  await search("");
  await chip("Music");
  const music = await rows();
  assert.ok(music.length > 0 && music.every(r => r.meta.startsWith("Music")));
  await noOverflow("picker filtered");
});

let musicTitle;
await step("Choosing an activity opens the form prefilled; notes start empty; saving stores a catalog record", async () => {
  musicTitle = (await rows())[0].title;
  await page.eval(`__t.clickSel(".picker-row")`);
  await page.waitFor(`document.querySelector(".form-bottom")`, 3000, "form open");
  assert.equal(await page.eval(`document.querySelector(".picked-activity strong").textContent`), musicTitle);
  assert.ok(await page.eval(`document.querySelector(".picked-activity small").textContent.startsWith("Music")`), "category prefilled");
  assert.ok(await page.eval(`!!document.querySelector(".form-child")`), "child shown, not asked again");
  assert.ok(!(await page.eval(`!!document.querySelector(".form-fields select")`)), "no child or activity dropdown");
  assert.equal(await page.eval(`document.querySelector(".form-fields input[type=date]").value`), today, "today's local date");
  assert.ok(!(await page.eval(`!!document.querySelector(".stage-choices")`)), "no learning stage");
  assert.ok(!(await page.eval(`!!document.querySelector(".form-fields .chips")`)), "no skill selector");
  assert.ok(!(await page.eval(`document.body.innerText.includes("Learning Stage") || document.body.innerText.includes("Skills Observed")`)));
  const musicSkills = await page.eval(`[...document.querySelectorAll(".activity-skills span")].map(s => s.textContent)`);
  assert.ok(musicSkills.length > 0, "music shows What Children Explore");
  assert.ok(!(await page.eval(`!!document.querySelector(".activity-skills button")`)), "skills are read-only tags");
  assert.ok(await page.eval(`document.body.innerText.includes("Skills") && !document.body.innerText.includes("Skills (optional)")`));
  assert.equal(await page.eval(`document.querySelector(".form-fields textarea").value`), "", "no prefilled notes");
  assert.equal(await page.eval(`document.querySelector(".form-fields textarea").placeholder`), "What did you notice?");
  assert.ok(await page.eval(`document.body.innerText.includes("Notes (optional)")`));
  await noOverflow("form");
  await save();
  await page.waitFor(`document.querySelector(".child-profile") && document.querySelector(".tabs button.active")?.textContent === "Activities"`, 3000, "back on the child's Activities");
  const added = (await live("records")).filter(r => !recordsBefore.some(x => x.id === r.id));
  assert.equal(added.length, 1);
  const [r] = added;
  childId = r.childId;
  assert.ok(r.activityId?.startsWith("music-"), "stable catalog id");
  assert.equal(r.lesson, musicTitle, "title snapshot");
  assert.equal(r.area, "Music");
  assert.equal(r.date, today);
  assert.equal(r.kind, undefined);
  for (const f of ["stage", "notes", "skills"]) assert.equal(r[f], undefined, `${f} left out`);
  assert.ok((await history())[0].startsWith(musicTitle), "first in the history");
});

await step("Recently Used shows it once; the activity's skills are shown, not saved; notes are kept", async () => {
  await openPicker();
  assert.ok(await page.eval(`document.body.innerText.includes("Recently Used")`));
  const recentTitles = await page.eval(`[...document.querySelectorAll(".picker-list")][0].innerText`);
  assert.ok(recentTitles.includes(musicTitle));
  await search("mopping");
  assert.ok(!(await page.eval(`document.body.innerText.includes("Recently Used")`)), "hidden while searching");
  await page.eval(`__t.clickSel(".picker-row")`);
  await page.waitFor(`document.querySelector(".form-bottom")`, 3000, "form open");
  assert.deepEqual(await page.eval(`[...document.querySelectorAll(".activity-skills span")].map(s => s.textContent)`),
    ["Care of Environment", "Gross Motor Coordination", "Concentration", "Independence"], "catalog skills");
  await page.eval(`__t.type(".form-fields textarea", "Careful strokes")`);
  await save();
  await page.waitFor(`document.querySelector(".child-profile")`, 3000, "saved");
  const r = (await live("records")).find(x => x.activityId === "mopping" && !recordsBefore.some(y => y.id === x.id));
  assert.ok(r);
  assert.equal(r.stage, undefined, "no stage");
  assert.equal(r.skills, undefined, "skills are not recorded as observed");
  assert.equal(r.notes, "Careful strokes");
  assert.equal(r.area, "Practical Life");
  await openPicker();
  const recent = await page.eval(`[...document.querySelectorAll(".picker-list")][0].innerText.split("\\n").filter(Boolean)`);
  assert.equal(recent.filter(x => x === "Mopping").length, 1, "no duplicates");
  assert.ok(recent.indexOf("Mopping") < recent.indexOf(musicTitle), "newest first");
  await page.eval(`__t.clickSel(".page-header .icon-button")`);
  await sleep(200);
});

await step("Custom activity: name and learning area, stored as typed and never added to Discover", async () => {
  await openPicker();
  await page.eval(`__t.clickSel(".picker-custom")`);
  await page.waitFor(`document.querySelector(".form-bottom")`, 3000, "form open");
  assert.ok(!(await page.eval(`!!document.querySelector(".activity-skills")`)), "no skills for a custom activity");
  const before = (await live("records")).length;
  await page.eval(`__t.type(".form-fields input:not([type=date])", "Climbing at the playground")`);
  await save();
  assert.ok(await page.eval(`document.querySelector(".journal-status.error")?.textContent === "Choose a learning area."`));
  assert.equal((await live("records")).length, before, "nothing saved without an area");
  const areas = await page.eval(`[...document.querySelectorAll(".form-fields select option")].map(o => o.value).filter(Boolean)`);
  assert.ok(areas.includes("Movement") && areas.includes("Music"), "Discover categories offered");
  await page.eval(`__t.type(".form-fields select", "Movement")`);
  await save();
  await page.waitFor(`document.querySelector(".child-profile")`, 3000, "saved");
  const r = (await live("records")).find(x => x.lesson === "Climbing at the playground");
  assert.ok(r);
  assert.equal(r.area, "Movement");
  assert.equal(r.activityId, undefined);
  assert.ok((await history()).some(h => h.startsWith("Climbing at the playground Movement")));
  await nav(NAV.discover);
  await page.eval(`__t.type(".discover-search input", "Climbing")`); await sleep(150);
  assert.equal(await page.eval(`document.querySelectorAll(".activity-card").length`), 0, "not in Discover");
  await page.eval(`__t.type(".discover-search input", "")`);
});

await step("History shows older records, new records and Mark as Tried; never blank", async () => {
  // Mark as Tried from Discover: the activity and its category are already filled in.
  await nav(NAV.discover);
  await page.eval(`__t.clickSel(".activity-card .activity-image")`);
  await page.waitFor(`document.querySelector(".detail-page")`, 3000, "activity");
  const title = await page.eval(`document.querySelector(".detail-content h1").textContent`);
  await page.eval(`__t.click("Mark as Tried", ".sticky-action button")`);
  await page.waitFor(`document.querySelector(".overlay select")`, 3000, "tried sheet");
  assert.equal(await page.eval(`document.querySelector(".overlay .plan-activity strong").textContent`), title);
  assert.ok(await page.eval(`document.querySelector(".overlay .plan-activity small").textContent.length > 0`), "category shown");
  assert.ok(!(await page.eval(`!!document.querySelector(".overlay .picker-row")`)), "no picker");
  await page.eval(`__t.type(".overlay select", ${q(childId)})`);
  await page.eval(`__t.click("Save", ".overlay .sheet-buttons button")`);
  await page.waitFor(`document.querySelector(".tried-done")`, 3000, "tried saved");
  const tried = (await live("records")).find(r => r.kind === "tried" && r.lesson === title && !recordsBefore.some(x => x.id === r.id));
  assert.ok(tried && tried.childId === childId && tried.area === undefined && tried.stage === undefined, "tried record keeps its shape");
  await page.eval(`__t.click("Done", ".overlay button")`);
  await openChild();
  const h = await history();
  assert.ok(h.every(x => x && !x.includes("undefined")), JSON.stringify(h));
  assert.ok(h.some(x => x.startsWith(title) && x.includes("Tried")), "tried record");
  const legacy = recordsBefore.filter(r => r.childId === childId && !r.activityId);
  for (const r of legacy) {
    const row = h.find(x => x.startsWith(r.lesson));
    assert.ok(row, `older record ${r.lesson}`);
    if (r.stage) assert.ok(row.includes(r.stage), `${r.lesson} keeps its stage`);
  }
  assert.ok(h.some(x => x.startsWith(musicTitle) && !/Introduced|Practicing|Independent/.test(x)), "no stage on a record without one");
});

await step("Records persist after a refresh; deleting one leaves Moments and other records", async () => {
  const before = await history();
  await page.reload();
  await appReady();
  await openChild();
  assert.deepEqual(await history(), before);
  const all = (await live("records")).length;
  await page.eval(`[...document.querySelectorAll(".lesson-list > button")].find(b => b.innerText.startsWith("Climbing at the playground")).click()`);
  await page.waitFor(`document.querySelector(".overlay .record-detail")`, 3000, "detail");
  await page.eval(`window.confirm = () => true`);
  await page.eval(`__t.clickSel(".overlay .danger")`);
  await page.waitFor(`!document.querySelector(".overlay")`, 3000, "deleted");
  assert.equal((await live("records")).length, all - 1);
  assert.equal((await live("entries")).length, entriesBefore.length, "Moments untouched");
});

await step("Chinese: picker, search and history", async () => {
  await nav(NAV.profile);
  await page.eval(`__t.click("Language", ".menu-section button")`);
  await page.eval(`__t.click("简体中文")`);
  await page.waitFor(`document.documentElement.lang === "zh-CN"`, 3000, "Chinese");
  lang = "zh";
  await openPicker();
  assert.equal(await page.eval(`document.querySelector(".page-header h1").textContent`), "添加活动");
  assert.ok(await page.eval(`document.body.innerText.includes("最近记录") && document.body.innerText.includes("其他 / 自定义活动")`));
  await search("pour");
  assert.ok((await rows()).length > 0, "English search in the Chinese interface");
  await search("倒水");
  assert.ok((await rows()).every(r => /[一-鿿]/.test(r.title)), "Chinese titles");
  await page.eval(`__t.clickSel(".picker-row")`);
  await page.waitFor(`document.querySelector(".form-bottom")`, 3000, "form open");
  assert.equal(await page.eval(`document.querySelector(".form-fields textarea").placeholder`), "你观察到了什么？");
  assert.ok(await page.eval(`document.body.innerText.includes("随手记（可选）") && document.body.innerText.includes("探索技能")`));
  assert.ok(!(await page.eval(`document.body.innerText.includes("学习阶段") || document.body.innerText.includes("观察到的技能")`)));
  assert.ok(await page.eval(`[...document.querySelectorAll(".activity-skills span")].every(s => /[一-鿿]/.test(s.textContent))`), "skills in Chinese");
  await page.eval(`__t.click("取消", ".form-bottom button")`);
  await openChild();
  const h = await history();
  assert.ok(h.some(x => x.startsWith("拖地")), "catalog record in Chinese");
  assert.ok(h.some(x => x.includes("倒水练习")) || !recordsBefore.some(r => r.childId === childId && r.lesson === "Pouring Water"), "older record translated");
  await noOverflow("history (zh)");
});

await step("Dark mode: picker and form use the dark theme and fit 390px", async () => {
  await nav(NAV.profile);
  await page.eval(`__t.click("外观", ".menu-section button")`);
  await page.eval(`__t.click("深色模式")`);
  await page.waitFor(`document.documentElement.dataset.theme === "dark"`, 3000, "dark");
  await openPicker();
  const bg = sel => page.eval(`getComputedStyle(document.querySelector(${q(sel)})).backgroundColor`);
  assert.equal(await bg(".picker-row"), "rgb(30, 38, 32)", "rows use the dark card colour");
  assert.equal(await bg(".picker-page"), "rgb(20, 26, 22)", "page uses the dark background");
  await noOverflow("picker (dark)");
  await page.eval(`__t.clickSel(".picker-custom")`);
  await page.waitFor(`document.querySelector(".form-bottom")`, 3000, "form open");
  await noOverflow("form (dark)");
  await page.eval(`__t.clickSel(".form-bottom button:last-child")`);
});

await page.close();
const failed = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
