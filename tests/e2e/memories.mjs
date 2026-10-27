import assert from "node:assert/strict";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { BASE, tempProfile } from "./env.mjs";

// Today's idea for each child, Looking Back (only memories at least a week old, opening the right record), Moments by
// child, and the weekly recap: one-child and several-children families, earlier weeks, Chinese, dark mode, a phone
// and a desktop. Also: each music activity has its own cover.

const page = await launch(tempProfile("memories"), 9372);
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
const go = async h => { await page.eval(`location.hash = ${q(h)}`); await sleep(300); };
const has = sel => page.eval(`!!document.querySelector(${q(sel)})`);
const textOf = sel => page.eval(`document.querySelector(${q(sel)})?.innerText ?? ""`);
const noModal = () => page.waitFor(`!document.querySelector(".overlay")`, 3000, "sheet closed");
// Vite can serve this module with a cache-busting `?t=...` query (added after an HMR update); importing the bare
// path would then create a second, disconnected module instance instead of reaching the one the app uses. Resource
// Timing already lists whatever URL the page actually fetched, so that is the one re-imported here.
const storeUrl = () => page.eval(`performance.getEntriesByType("resource").map(e => e.name).find(u => u.includes("/src/lib/data/store.ts")) || "/src/lib/data/store.ts"`);
const write = async collections => page.eval(`import(${q(await storeUrl())}).then(S => S.write({ collections: ${q(collections)} }))`);
const live = async store => (await page.eval(`__t.all(${q(store)})`)).filter(r => !r.deletedAt);

// Local calendar dates, as the app sees them.
const localIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return localIso(d); };
const mondayOf = iso => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localIso(d); };
const TODAY = daysAgo(0);
const LAST_MONDAY = mondayOf(daysAgo(7));
const moment = (id, childId, date, fields = {}) => ({ id, childId, date, photos: [], createdAt: `${date}T08:00:00.000Z`, updatedAt: `${date}T08:00:00.000Z`, deletedAt: null, origin: "user", ...fields });

const addChild = async (name, dob) => {
  await go("#/kids");
  await page.eval(`__t.clickSel(".header-add-child")`);
  await page.waitFor(`document.querySelector(".overlay .sheet-fields")`, 3000, "Add Child open");
  await page.eval(`__t.type(".overlay input", ${q(name)})`);
  await page.eval(`__t.type(".overlay input[type=date]", ${q(dob)})`);
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await noModal();
  return (await live("children")).find(c => c.first === name);
};

await page.nav(`${BASE}/`);
await appReady();
let ada, ben;

await step("One child: Today's idea is for that child, with nothing to choose; something from this week is never 'Looking Back'", async () => {
  ada = await addChild("Ada", `${new Date().getFullYear() - 3}-02-01`);
  await write({ entries: [
    moment("m-now", ada.id, TODAY, { title: "Written just now", createdAt: new Date().toISOString() }),
    moment("m-3", ada.id, daysAgo(3), { text: "Three days ago" }),
    // Backdated a month, but written today: still new, not a memory yet.
    moment("m-backdated", ada.id, daysAgo(30), { text: "Backdated today", createdAt: new Date().toISOString() }),
  ] });
  await go("#/today");
  await page.waitFor(`document.querySelector(".today-feature-child")`, 3000, "idea labelled");
  assert.match(await textOf(".today-feature-child"), /^For Ada · 3 years/);
  assert.equal(await has(".today-for"), false, "no chips with one child");
  assert.equal(await has("#today-looking-back"), false, "no Looking Back yet");
  await go("#/moments");
  await page.waitFor(`document.body.innerText.includes("Written just now")`, 3000, "Moments");
  assert.equal(await has(".child-chips"), false, "no child filter with one child");
});

await step("A Moment from at least a week ago comes back on Today, and tapping it opens that Moment", async () => {
  await write({ entries: [moment("m-old", ada.id, daysAgo(10), { title: "Garden walk", text: "We found a snail." })] });
  await go("#/today");
  await page.waitFor(`document.querySelector("#today-looking-back")`, 3000, "Looking Back");
  assert.ok((await textOf(".today-memory")).includes("Garden walk"));
  await page.eval(`__t.clickSel(".today-memory")`);
  await page.waitFor(`location.hash === "#/moment/m-old" && document.querySelector(".journal-entry")`, 3000, "that Moment");
  assert.ok((await textOf(".journal-entry")).includes("We found a snail."));
});

await step("A tried activity from weeks ago opens that record on its child's Activities", async () => {
  const old = (await live("entries")).find(e => e.id === "m-old");
  await write({ entries: [{ ...old, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }], records: [{ id: "t-old", childId: ada.id, kind: "tried", activityId: "water-pouring", lesson: "Water Pouring", date: daysAgo(20), createdAt: `${daysAgo(20)}T08:00:00.000Z`, updatedAt: `${daysAgo(20)}T08:00:00.000Z`, deletedAt: null, origin: "user" }] });
  await go("#/today");
  await page.waitFor(`document.querySelector(".today-memory.tried")`, 3000, "tried memory");
  await page.eval(`__t.clickSel(".today-memory.tried")`);
  await page.waitFor(`location.hash === ${q(`#/child/${ada.id}/activities`)} && document.querySelector(".overlay .record-detail")`, 3000, "the record, open");
  await page.eval(`document.querySelector(".overlay header button").click()`); await noModal();
  // Switching tabs doesn't open it again.
  await page.eval(`__t.click("Journal", ".child-profile .tabs button")`); await sleep(200);
  await page.eval(`__t.click("Activities", ".child-profile .tabs button")`); await sleep(300);
  assert.equal(await has(".overlay .record-detail"), false);
});

await step("Several children: each gets an idea for their own age, and the parent can switch", async () => {
  // ~2.5 years old (well clear of either age-bracket boundary, whatever day this runs): a different bracket from
  // Ada's ~3 years, and one the catalog actually has activities for (the 0-2 bracket has none yet).
  ben = await addChild("Ben", daysAgo(912));
  await go("#/today");
  await page.waitFor(`document.querySelectorAll(".today-for button").length === 2`, 3000, "a chip per child");
  await page.eval(`[...document.querySelectorAll(".today-for button")].find(b => b.innerText.includes("Ben")).click()`);
  await page.waitFor(`document.querySelector(".today-feature-child")?.innerText.startsWith("For Ben")`, 3000, "Ben's idea");
  assert.equal(await page.eval(`document.querySelector(".today-for button.active").innerText.trim()`), "Ben");
  await page.eval(`[...document.querySelectorAll(".today-for button")].find(b => b.innerText.includes("Ada")).click()`);
  await page.waitFor(`document.querySelector(".today-feature-child")?.innerText.startsWith("For Ada")`, 3000, "Ada's idea");
});

await step("Weekly recap from Today: last week's Moments, a few highlights, one child at a time, and back again", async () => {
  await write({ entries: [
    moment("m-w1", ada.id, LAST_MONDAY, { title: "Monday leaves", text: "Ada lined up the leaves." }),
    moment("m-w2", ben.id, LAST_MONDAY, { text: "Ben clapped along." }),
    moment("m-w3", ada.id, LAST_MONDAY, { text: "Ada sang to her bear." }),
    moment("m-w4", ben.id, LAST_MONDAY, { title: "First puddle" }),
  ] });
  await go("#/today");
  await page.waitFor(`document.querySelector(".today-week")`, 3000, "recap card");
  assert.ok((await textOf("#today-week")).length > 0);
  await page.eval(`__t.clickSel(".today-week")`);
  await page.waitFor(`location.hash.startsWith(${q(`#/moments-week/${LAST_MONDAY}`)}) && document.querySelector(".recap-page")`, 3000, "recap");
  assert.equal(await page.eval(`document.querySelectorAll(".recap-highlight").length`), 3, "three highlights");
  // Everything else from that week (the earlier steps' Moment from three days ago may fall in it too).
  const inWeek = (await live("entries")).filter(e => e.date >= LAST_MONDAY && e.date < mondayOf(TODAY) && (e.title || e.text || e.photos.length)).length;
  assert.equal(await page.eval(`document.querySelectorAll(".recap-row").length`), inWeek - 3, "the rest of the week");
  const all = await textOf(".recap-page");
  for (const word of ["streak", "score", "%", "completed"]) assert.ok(!all.toLowerCase().includes(word), `no ${word}`);
  // Ben only.
  await page.eval(`__t.clickSel(".recap-page .child-chips [data-child='${ben.id}']")`);
  await page.waitFor(`location.hash.includes(${q(`child=${ben.id}`)})`, 3000, "Ben's recap");
  const benOnly = await textOf(".recap-page");
  assert.ok(benOnly.includes("Ben clapped along.") && !benOnly.includes("Ada lined up the leaves."), benOnly);
  // Opening a Moment and coming back returns to the recap.
  await page.eval(`__t.clickSel(".recap-highlight")`);
  await page.waitFor(`document.querySelector(".journal-entry")`, 3000, "Moment");
  await page.eval(`document.querySelector(".journal-editor-bar button").click()`);
  await page.waitFor(`location.hash.startsWith("#/moments-week") && document.querySelector(".recap-page")`, 3000, "back to the recap");
  await page.eval(`__t.clickSel(".recap-page .child-chips [data-child='']")`); await sleep(200);
});

await step("Earlier weeks: the recap goes back week by week; an empty week is gentle and offers an earlier one", async () => {
  // In the week of the backdated Moment (30 days ago), on its Monday: that week is both the nearest earlier one
  // with Moments and the earliest, whatever weekday the suite runs on.
  await write({ entries: [moment("m-long-ago", ada.id, mondayOf(daysAgo(30)), { title: "Long ago" })] });
  await go(`#/moments-week/${LAST_MONDAY}`);
  await page.waitFor(`document.querySelector(".recap-highlight")`, 3000, "last week");
  assert.equal(await page.eval(`document.querySelector(".recap-weeks .recap-next").disabled`), false, "this week is ahead");
  await page.eval(`__t.clickSel(".recap-weeks .icon-button")`);
  await page.waitFor(`document.querySelector(".recap-empty")`, 3000, "an empty week");
  assert.ok((await textOf(".recap-empty")).includes("That's okay"));
  await page.eval(`__t.clickSel(".recap-empty button")`);
  await page.waitFor(`document.querySelector(".recap-page")?.innerText.includes("Long ago")`, 3000, "the earlier week");
  // The earliest week can't go further back; this week can't go forward.
  assert.equal(await page.eval(`document.querySelector(".recap-weeks .icon-button").disabled`), true);
  await go(`#/moments-week/${mondayOf(TODAY)}`);
  await page.waitFor(`document.querySelector(".recap-weeks .recap-next")?.disabled === true`, 3000, "no future weeks");
  // A week in the future shows this week instead.
  await go("#/moments-week/2099-01-05");
  await page.waitFor(`document.querySelector(".recap-weeks .recap-next")?.disabled === true`, 3000, "capped at this week");
});

await step("Moments: find a child's Moments with the chips; the weekly look back is a tap away", async () => {
  await go("#/moments");
  await page.waitFor(`document.querySelectorAll(".moments-controls .child-chips button").length === 3`, 3000, "All + two children");
  await page.eval(`__t.clickSel(".moments-controls .child-chips [data-child='${ben.id}']")`);
  await page.waitFor(`!document.querySelector(".moments-page").innerText.includes("Ada lined up")`, 3000, "Ben only");
  assert.ok((await textOf(".moments-page")).includes("Ben clapped along."));
  await page.eval(`__t.clickSel(".moments-week-link")`);
  await page.waitFor(`location.hash.startsWith("#/moments-week") && location.hash.includes(${q(ben.id)})`, 3000, "recap for Ben");
});

await step("Chinese and dark mode on a phone, and the desktop frame: the recap reads well and nothing scrolls sideways", async () => {
  await go("#/profile");
  await page.eval(`__t.click("Language", ".menu-section button")`);
  await page.eval(`__t.click("简体中文")`);
  await page.waitFor(`document.documentElement.lang === "zh-CN"`, 3000, "Chinese");
  await go("#/profile");
  await page.eval(`__t.click("外观", ".menu-section button")`);
  await page.eval(`__t.click("深色模式")`);
  await page.waitFor(`document.documentElement.dataset.theme === "dark"`, 3000, "dark");
  await go(`#/moments-week/${LAST_MONDAY}`);
  await page.waitFor(`document.querySelector(".recap-page h1")?.innerText === "一周回顾"`, 3000, "Chinese title");
  assert.match(await textOf(".recap-weeks h2"), /月/);
  assert.equal(await page.eval(`getComputedStyle(document.querySelector(".recap-highlight")).backgroundColor`), "rgb(30, 38, 32)", "dark card");
  assert.equal(await page.eval(`document.documentElement.scrollWidth > innerWidth`), false, "no sideways scroll on a phone");
  await go("#/today");
  await page.waitFor(`document.querySelector(".today-feature-child")?.innerText.startsWith("适合")`, 3000, "Chinese idea label");
  await desktop(); await sleep(300);
  await go(`#/moments-week/${LAST_MONDAY}`);
  const r = await page.eval(`JSON.parse(JSON.stringify(document.querySelector(".recap-page").getBoundingClientRect()))`);
  assert.ok(r.left >= 519 && r.right <= 921, `inside the phone frame: ${r.left}–${r.right}`);
  assert.equal(await page.eval(`document.documentElement.scrollWidth > innerWidth`), false);
  await phone();
});

await step("Music: each activity has its own cover", async () => {
  await go("#/discover/music");
  await page.waitFor(`document.querySelectorAll(".music-card").length === 5`, 3000, "music cards");
  const covers = await page.eval(`[...document.querySelectorAll(".music-card .activity-image img")].map(i => i.getAttribute("src"))`);
  assert.equal(new Set(covers).size, covers.length, covers.join(" "));
  assert.ok(await page.eval(`[...document.querySelectorAll(".music-card .activity-image img")].every(i => i.complete && i.naturalWidth > 0)`), "covers load");
});

await page.close();
const failedSteps = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failedSteps.length}/${results.length} passed`);
process.exit(failedSteps.length ? 1 : 0);
