import assert from "node:assert/strict";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { BASE, tempProfile } from "./env.mjs";

// Regression coverage for the progressive-reveal (windowing) behavior added to EntryTimeline (Moments and each
// child's Journal) and ChildProfilePage's LessonList (Activities): a family with years of data only renders a
// first batch of cards/rows up front, growing as a sentinel scrolls into view. This suite seeds years' worth of
// Moments and activity records for one child directly into the database (far more than any UI flow would create
// in a test run) and checks: every entry/record stays reachable by scrolling, switching children/searching resets
// the revealed count instead of carrying over a stale one, creating/editing/deleting a Moment keeps the list
// correct, scrolling never produces a duplicate or missing row, the same holds in Chinese and at a narrow phone
// width, and a normal small family sees no sentinel and no change at all.

const page = await launch(tempProfile("windowing"), 9373);
await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
const phone = () => page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const narrowPhone = () => page.send("Emulation.setDeviceMetricsOverride", { width: 360, height: 740, deviceScaleFactor: 3, mobile: true });
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
const openLink = async hashPath => { await page.nav("about:blank"); await page.nav(`${BASE}/${hashPath}`); await appReady(); };
const live = async store => (await page.eval(`__t.all(${q(store)})`)).filter(r => !r.deletedAt);
// Vite can serve this module with a cache-busting query (see memories.mjs for why); re-import whatever URL the
// page actually fetched instead of the bare path.
const storeUrl = () => page.eval(`performance.getEntriesByType("resource").map(e => e.name).find(u => u.includes("/src/lib/data/store.ts")) || "/src/lib/data/store.ts"`);
const write = async collections => page.eval(`import(${q(await storeUrl())}).then(S => S.write({ collections: ${q(collections)} }))`);

const localIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return localIso(d); };
const pad = n => String(n).padStart(3, "0");

const addChild = async (name, dob) => {
  await page.eval(`location.hash = "#/kids"`); await sleep(250);
  await page.eval(`__t.clickSel(".header-add-child")`);
  await page.waitFor(`document.querySelector(".overlay .sheet-fields")`, 3000, "Add Child open");
  await page.eval(`__t.type(".overlay input", ${q(name)})`);
  await page.eval(`__t.type(".overlay input[type=date]", ${q(dob)})`);
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await page.waitFor(`!document.querySelector(".overlay")`, 3000, "sheet closed");
  return (await live("children")).find(c => c.first === name);
};

// Scrolls to the bottom repeatedly (the real gesture that grows the revealed count via IntersectionObserver)
// until `selector` stops growing or reaches `total`. Returns the final count.
const revealAll = async (selector, total, maxSteps = 20) => {
  let count = await page.eval(`document.querySelectorAll(${q(selector)}).length`);
  for (let i = 0; i < maxSteps && count < total; i++) {
    await page.eval(`window.scrollTo(0, document.body.scrollHeight)`);
    await sleep(220);
    count = await page.eval(`document.querySelectorAll(${q(selector)}).length`);
  }
  return count;
};
const textsOf = selector => page.eval(`[...document.querySelectorAll(${q(selector)})].map(e => e.textContent)`);
const cardCount = () => page.eval(`document.querySelectorAll(".journal-card").length`);
const hasSentinel = () => page.eval(`!!document.querySelector(".journal-timeline-sentinel")`);

await page.nav(`${BASE}/`);
await appReady();

const ADA_ENTRIES = 130; // > INITIAL_REVEAL (60) + REVEAL_STEP (60): needs two scroll steps to fully reveal
const THEO_ENTRIES = 8; // well under the threshold: should behave exactly as before windowing
const ADA_RECORDS = 170; // > LESSON_INITIAL_REVEAL (80) + LESSON_REVEAL_STEP (80): needs two scroll steps
const NEEDLE_DAYS = [5, 50, 100]; // which Ada entries carry the search needle (expect exactly 3 matches)

let ada, theo;
await step("setup: two children, one with years of Moments and activity records, one with just a few", async () => {
  ada = await addChild("Ada", "2019-04-02");
  theo = await addChild("Theo", "2021-08-15");
  assert.ok(ada && theo, "both children created");

  const entries = [
    ...Array.from({ length: ADA_ENTRIES }, (_, i) => {
      const n = i + 1;
      const date = daysAgo(n);
      return {
        id: `e-a-${pad(n)}`, childId: ada.id, date, title: `E-A-${pad(n)}`,
        text: NEEDLE_DAYS.includes(n) ? "zzqneedle" : undefined,
        photos: [], createdAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T09:00:00.000Z`, deletedAt: null, origin: "user",
      };
    }),
    ...Array.from({ length: THEO_ENTRIES }, (_, i) => {
      const n = i + 1;
      const date = daysAgo(n);
      return { id: `e-b-${pad(n)}`, childId: theo.id, date, title: `E-B-${pad(n)}`, photos: [], createdAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T09:00:00.000Z`, deletedAt: null, origin: "user" };
    }),
  ];
  const records = Array.from({ length: ADA_RECORDS }, (_, i) => {
    const n = i + 1;
    const date = daysAgo(n);
    return { id: `r-a-${pad(n)}`, childId: ada.id, lesson: `L-A-${pad(n)}`, date, createdAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T09:00:00.000Z`, deletedAt: null, origin: "user" };
  });
  await write({ entries, records });
  assert.equal((await live("entries")).length, ADA_ENTRIES + THEO_ENTRIES);
  assert.equal((await live("records")).length, ADA_RECORDS);
});

await step("Moments (All): only the first 60 of 138 render up front; scrolling reveals every one, no duplicates", async () => {
  await openLink("#/moments");
  await page.waitFor(`document.querySelectorAll(".journal-card").length > 0`, 5000, "cards render");
  assert.equal(await cardCount(), 60, "renders only the initial batch, not all 138 up front");
  assert.ok(await hasSentinel(), "sentinel present while more remain");

  const final = await revealAll(".journal-card", ADA_ENTRIES + THEO_ENTRIES);
  assert.equal(final, ADA_ENTRIES + THEO_ENTRIES, "every Moment becomes reachable by scrolling");
  assert.ok(!(await hasSentinel()), "sentinel gone once everything is shown");

  const list = await textsOf(".journal-card > strong");
  const expected = [
    ...Array.from({ length: ADA_ENTRIES }, (_, i) => `E-A-${pad(i + 1)}`),
    ...Array.from({ length: THEO_ENTRIES }, (_, i) => `E-B-${pad(i + 1)}`),
  ];
  assert.equal(list.length, expected.length, "no missing or extra rows while scrolling");
  assert.equal(new Set(list).size, expected.length, "no title repeats (no duplicate rows)");
  assert.deepEqual([...list].sort(), expected.sort(), "exactly the seeded Moments, nothing more or less");
});

await step("Moments: switching to one child resets the revealed count to that child's own first batch", async () => {
  await page.eval(`__t.clickSel('.child-chips button[data-child="${ada.id}"]')`);
  await sleep(250);
  assert.equal(await cardCount(), 60, "resets to Ada's own initial batch, not the larger All-reveal carried over");
  const final = await revealAll(".journal-card", ADA_ENTRIES);
  assert.equal(final, ADA_ENTRIES, "scrolling still reaches every one of Ada's Moments after the switch");
  const list = await textsOf(".journal-card > strong");
  assert.equal(new Set(list).size, ADA_ENTRIES, "no duplicates after switching children");
  assert.deepEqual([...list].sort(), Array.from({ length: ADA_ENTRIES }, (_, i) => `E-A-${pad(i + 1)}`).sort());
});

await step("Moments: switching to a child with few Moments shows them all at once, no sentinel (unchanged from before windowing)", async () => {
  await page.eval(`__t.clickSel('.child-chips button[data-child="${theo.id}"]')`);
  await sleep(250);
  assert.equal(await cardCount(), THEO_ENTRIES, "all of Theo's Moments show immediately");
  assert.ok(!(await hasSentinel()), "no sentinel below the reveal threshold");
});

await step("Moments: searching resets the revealed count too, and only matching Moments show", async () => {
  await page.eval(`__t.clickSel('.child-chips button[data-child="All"]')`);
  await sleep(200);
  await page.eval(`__t.clickSel(".moments-controls .icon-button")`);
  await page.waitFor(`document.querySelector(".journal-search input")`, 2000, "search field open");
  await page.eval(`__t.type(".journal-search input", "zzqneedle")`);
  await sleep(250);
  assert.equal(await cardCount(), NEEDLE_DAYS.length, "only the matching Moments show, all at once");
  assert.ok(!(await hasSentinel()), "no sentinel for a short filtered result");
  await page.eval(`__t.clickSel(".moments-controls .icon-button")`); // close search, clears the query
  await sleep(200);
});

await step("Journal (Ada): the same progressive reveal, scoped to one child's own timeline", async () => {
  await openLink(`#/child/${ada.id}`);
  await page.waitFor(`document.querySelector(".journal")`, 5000, "journal tab");
  assert.equal(await cardCount(), 60, "initial batch on a fresh visit to the Journal tab");
  const final = await revealAll(".journal-card", ADA_ENTRIES);
  assert.equal(final, ADA_ENTRIES);
  const list = await textsOf(".journal-card > strong");
  assert.equal(new Set(list).size, ADA_ENTRIES, "no duplicates in the Journal tab either");
  assert.deepEqual([...list].sort(), Array.from({ length: ADA_ENTRIES }, (_, i) => `E-A-${pad(i + 1)}`).sort());
});

await step("Activities (Ada): 170 records only render 80 up front; scrolling reveals the rest, no duplicates", async () => {
  await openLink(`#/child/${ada.id}/activities`);
  await page.waitFor(`document.querySelector(".lesson-list")`, 5000, "activities tab");
  assert.equal(await page.eval(`document.querySelectorAll(".lesson-list > button").length`), 80, "renders only the initial batch of records");
  assert.ok(await hasSentinel(), "sentinel present while more records remain");

  const final = await revealAll(".lesson-list > button", ADA_RECORDS);
  assert.equal(final, ADA_RECORDS, "every record becomes reachable by scrolling");
  assert.ok(!(await hasSentinel()));

  const list = await textsOf(".lesson-list > button strong");
  assert.equal(list.length, ADA_RECORDS, "no missing or extra rows while scrolling");
  assert.equal(new Set(list).size, ADA_RECORDS, "no title repeats");
  assert.deepEqual([...list].sort(), Array.from({ length: ADA_RECORDS }, (_, i) => `L-A-${pad(i + 1)}`).sort());
});

await step("Journal (Ada): adding, editing and deleting a Moment keep the windowed list correct", async () => {
  await openLink(`#/child/${ada.id}`);
  await page.waitFor(`document.querySelector(".journal")`, 5000);
  assert.equal(await cardCount(), 60, "back to the initial batch on a fresh visit");

  // Add: a new, undated-today Moment sorts to the very top (newest first).
  await page.eval(`__t.clickSel(".journal-write")`);
  await page.waitFor(`document.querySelector(".journal-editor")`, 3000, "editor open");
  await page.eval(`__t.type(".journal-title-input", "NEW-TODAY-ENTRY")`);
  await page.eval(`__t.clickSel(".journal-save")`);
  await page.waitFor(`!document.querySelector(".journal-editor")`, 4000, "editor closed after adding");
  await page.waitFor(`document.querySelector(".journal-card > strong")?.textContent === "NEW-TODAY-ENTRY"`, 3000, "new entry shows at the top");
  assert.equal((await live("entries")).filter(e => e.childId === ada.id).length, ADA_ENTRIES + 1, "stored");

  // Edit: open it, change the title, save; it still shows (now with the new title) in the windowed list.
  await page.eval(`__t.click("NEW-TODAY-ENTRY", ".journal-card")`);
  await page.waitFor(`document.querySelector(".journal-entry")`, 3000, "detail open");
  await page.eval(`__t.click(${q("Edit")}, ".journal-editor-bar button")`);
  await page.waitFor(`document.querySelector(".journal-title-input")`, 3000, "editor open for editing");
  await page.eval(`__t.type(".journal-title-input", "EDITED-TODAY-ENTRY")`);
  await page.eval(`__t.clickSel(".journal-save")`);
  await page.waitFor(`!document.querySelector(".journal-editor")`, 4000, "editor closed after editing");
  await page.waitFor(`document.querySelector(".journal-card > strong")?.textContent === "EDITED-TODAY-ENTRY"`, 3000, "edited title shows");
  assert.ok(!(await page.eval(`document.body.innerText.includes("NEW-TODAY-ENTRY")`)), "old title is gone, not duplicated alongside the new one");

  // Delete: open it, confirm the delete; it disappears, and the rest of the list is still intact.
  await page.eval(`__t.click("EDITED-TODAY-ENTRY", ".journal-card")`);
  await page.waitFor(`document.querySelector(".journal-entry")`, 3000, "detail open");
  await page.eval(`__t.clickSel('.journal-editor-bar button[aria-label="Delete"]')`);
  await page.confirmDialog();
  await page.waitFor(`document.querySelector(".journal")`, 3000, "back to the Journal list after delete");
  assert.ok(!(await page.eval(`document.body.innerText.includes("EDITED-TODAY-ENTRY")`)), "deleted entry no longer shows");
  assert.equal((await live("entries")).filter(e => e.childId === ada.id).length, ADA_ENTRIES, "removed from storage");

  // Scroll through everything once more: still exactly the original 130, no leftover from the add/edit/delete.
  const final = await revealAll(".journal-card", ADA_ENTRIES);
  assert.equal(final, ADA_ENTRIES);
  const list = await textsOf(".journal-card > strong");
  assert.equal(new Set(list).size, ADA_ENTRIES, "no duplicates after the add/edit/delete round trip");
  assert.deepEqual([...list].sort(), Array.from({ length: ADA_ENTRIES }, (_, i) => `E-A-${pad(i + 1)}`).sort());
});

await step("Chinese: Moments and Journal windowing still work, and month headers translate", async () => {
  await page.eval(`location.hash = "#/profile"`);
  await page.waitFor(`document.querySelector(".menu-section")`, 5000, "profile menu");
  await page.eval(`__t.click("Language", ".menu-section button")`);
  await sleep(200);
  await page.waitFor(`document.body.innerText.includes("简体中文")`, 3000, "language screen");
  await page.eval(`__t.click("简体中文")`);
  await page.waitFor(`document.documentElement.lang === "zh-CN"`, 3000, "switched to Chinese");

  await openLink(`#/child/${ada.id}`);
  await page.waitFor(`document.querySelector(".journal")`, 5000);
  assert.equal(await cardCount(), 60, "initial batch unchanged in Chinese");
  const final = await revealAll(".journal-card", ADA_ENTRIES);
  assert.equal(final, ADA_ENTRIES, "scrolling reveals everything in Chinese too");
  const list = await textsOf(".journal-card > strong");
  assert.equal(new Set(list).size, ADA_ENTRIES, "no duplicates in Chinese");
  const monthHeader = (await page.eval(`document.querySelector(".journal-month h3")?.textContent`)) || "";
  assert.ok(monthHeader.includes("年") || monthHeader.includes("月"), `month header looks translated: ${monthHeader}`);

  // Switch back to English so the suite ends in a known state.
  await page.eval(`location.hash = "#/profile"`);
  await page.waitFor(`document.querySelector(".menu-section")`, 5000);
  await page.eval(`__t.click("语言", ".menu-section button")`);
  await sleep(200);
  await page.eval(`__t.click("English")`);
  await page.waitFor(`document.documentElement.lang === "en"`, 3000, "back to English");
});

await step("Mobile: a narrower phone shows the fully revealed list without horizontal scrolling", async () => {
  await narrowPhone();
  await openLink("#/moments");
  await page.waitFor(`document.querySelectorAll(".journal-card").length > 0`, 5000);
  await revealAll(".journal-card", ADA_ENTRIES + THEO_ENTRIES);
  const w = await page.eval(`document.documentElement.scrollWidth`);
  assert.ok(w <= 360, `page is ${w}px wide at a 360px viewport`);
  await phone();
});

await step("Regression: markup used by other suites (journal-card, journal-month, lesson-list rows) is unchanged", async () => {
  await openLink(`#/child/${theo.id}/activities`);
  await page.waitFor(`document.querySelector(".child-body")`, 5000, "activities tab (Theo has no records)");
  assert.ok(!(await page.eval(`!!document.querySelector(".lesson-list > button")`)), "no rows for a child with none");
  assert.ok(!(await hasSentinel()), "no sentinel with nothing to reveal");
  assert.ok(await page.eval(`!!document.querySelector(".wide-primary")`), "Add Activity button still present");

  await openLink(`#/child/${theo.id}`);
  await page.waitFor(`document.querySelector(".journal")`, 5000);
  assert.equal(await cardCount(), THEO_ENTRIES, "a small family's Journal renders exactly as before windowing");
  assert.ok(!(await hasSentinel()));
});

await page.close();
const failedSteps = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failedSteps.length}/${results.length} passed`);
process.exit(failedSteps.length ? 1 : 0);
