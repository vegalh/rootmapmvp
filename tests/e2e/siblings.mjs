import assert from "node:assert/strict";
import path from "node:path";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { BASE, IMG, tempProfile } from "./env.mjs";

// Siblings, on a phone set to Chinese: the app opens in Chinese (until the parent picks a language); Mark as Tried
// for several children at once; Add a Memory keeps the note and the children; a Moment for several children is one
// card in Moments (All), Kids › Recent moments, and each child's own copy in their Journal; editing one copy splits
// it off; completing a plan after Mark as Tried adds no second record that day.

const page = await launch(tempProfile("siblings"), 9374);
await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
// A browser whose preferred language is Chinese.
await page.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `Object.defineProperty(Navigator.prototype, "languages", { get: () => ["zh-CN", "zh"] });
           Object.defineProperty(Navigator.prototype, "language", { get: () => "zh-CN" });`,
});
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
const go = async h => { await page.eval(`location.hash = ${q(h)}`); await sleep(300); };
const has = sel => page.eval(`!!document.querySelector(${q(sel)})`);
const textOf = sel => page.eval(`document.querySelector(${q(sel)})?.innerText ?? ""`);
const noModal = () => page.waitFor(`!document.querySelector(".overlay")`, 3000, "sheet closed");
const live = async store => (await page.eval(`__t.all(${q(store)})`)).filter(r => !r.deletedAt);
const pressed = scope => page.eval(`[...document.querySelectorAll(${q(`${scope} .child-checks button[aria-pressed=true]`)})].map(b => b.dataset.child)`);
// Timeline cards (Moments, a Journal) whose text includes `text`, with the names in their header.
const cards = text => page.eval(`[...document.querySelectorAll(".journal-card")].filter(c => c.innerText.includes(${q(text)})).map(c => ({ names: c.querySelector(".entry-child strong")?.innerText ?? "", together: !!c.querySelector(".entry-child.together"), avatars: c.querySelectorAll(".entry-child img").length }))`);

const localIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = localIso(new Date());

const pickLanguage = async (menu, option) => {
  await go("#/profile");
  await page.eval(`__t.click(${q(menu)}, ".menu-section button")`);
  await page.eval(`__t.click(${q(option)})`);
};
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
const openTried = async (activityId, label = "Mark as Tried") => {
  await go(`#/activity/${activityId}`);
  await page.waitFor(`document.querySelector(".detail-page .sticky-action")`, 3000, "activity page");
  await page.eval(`__t.click(${q(label)}, ".sticky-action button")`);
  await page.waitFor(`document.querySelector(".overlay .child-checks button[data-child]")`, 3000, "Mark as Tried sheet");
};
const saveSheet = () => page.eval(`[...document.querySelectorAll(".overlay .sheet-buttons button")].at(-1).click()`);

await page.nav(`${BASE}/`);
await appReady();
let anan, lele, doudou;

await step("A Chinese phone opens the app in Chinese; English, once picked, survives a reload", async () => {
  await page.waitFor(`document.documentElement.lang === "zh-CN"`, 3000, "Chinese");
  assert.ok((await page.eval(`document.body.innerText`)).includes("今日"), "Chinese copy");
  await pickLanguage("语言", "English");
  await page.waitFor(`document.documentElement.lang === "en"`, 3000, "English");
  await page.reload();
  await appReady();
  await sleep(300);
  assert.equal(await page.eval(`document.documentElement.lang`), "en", "the parent's choice wins over the phone's language");
});

await step("Three children: Mark as Tried for two at once stores one record each, with the same note", async () => {
  const year = new Date().getFullYear();
  anan = await addChild("Anan", `${year - 5}-03-01`);
  lele = await addChild("Lele", `${year - 4}-03-01`);
  doudou = await addChild("Doudou", `${year - 3}-03-01`);
  assert.ok(anan && lele && doudou, "children added");
  const before = await live("records");

  await openTried("dotting");
  assert.equal(await textOf(".overlay fieldset legend"), "Who tried it?");
  assert.deepEqual(await pressed(".overlay"), [], "nobody preselected with several children");
  assert.ok(await page.eval(`document.querySelector(".overlay .sheet-buttons button:last-child").disabled`), "Save disabled until a child is chosen");
  assert.ok((await textOf(".overlay")).includes("Choose at least one child."));
  await page.eval(`__t.chooseChildren(".overlay", [${q(lele.id)}, ${q(anan.id)}])`);
  await page.waitFor(`!document.querySelector(".overlay .sheet-buttons button:last-child").disabled`, 3000, "Save enabled");
  await page.eval(`__t.type(".overlay textarea", "Both loved the bright dots")`);
  await saveSheet();
  await page.waitFor(`document.querySelector(".tried-done")`, 3000, "saved");
  // Family order, whatever order they were tapped in.
  assert.match(await textOf(".tried-done"), /^Marked as tried for Anan, Lele · /);

  const added = (await live("records")).filter(r => !before.some(b => b.id === r.id));
  assert.equal(added.length, 2, "one record per child");
  assert.deepEqual(added.map(r => r.childId).sort(), [anan.id, lele.id].sort());
  for (const r of added) {
    assert.equal(r.kind, "tried"); assert.equal(r.activityId, "dotting");
    assert.equal(r.date, TODAY); assert.equal(r.notes, "Both loved the bright dots");
  }
  assert.notEqual(added[0].id, added[1].id);
});

let shared;
await step("Add a Memory keeps the note and both children; with a photo it saves one entry per child, same photos and createdAt", async () => {
  await page.eval(`__t.click("Add a Memory", ".overlay .sheet-buttons button")`);
  await page.waitFor(`document.querySelector(".journal-editor .entry-children")`, 3000, "editor with child chips");
  assert.equal(await textOf(".journal-editor .entry-children legend"), "Who is this moment about?");
  assert.equal(await page.eval(`document.querySelector(".journal-text-input").value`), "Both loved the bright dots");
  assert.ok((await page.eval(`document.querySelector(".journal-title-input").value`)).length > 0, "activity title prefilled");
  assert.deepEqual(await pressed(".journal-editor"), [anan.id, lele.id]);
  await page.setFiles(".journal-add-photo input[type=file]", [path.join(IMG, "landscape.png")]);
  await page.waitFor(`document.querySelectorAll(".journal-photos figure").length === 1`, 10000, "photo added");
  await page.waitFor(`!document.querySelector(".journal-save").disabled`, 3000, "Save enabled");
  const before = await live("entries");
  await page.eval(`__t.clickSel(".journal-save")`);
  await page.waitFor(`!document.querySelector(".journal-editor")`, 5000, "editor closed");

  shared = (await live("entries")).filter(e => !before.some(b => b.id === e.id));
  assert.equal(shared.length, 2, "one entry per child");
  assert.deepEqual(shared.map(e => e.childId).sort(), [anan.id, lele.id].sort());
  assert.notEqual(shared[0].id, shared[1].id);
  assert.equal(shared[0].photos.length, 1);
  assert.deepEqual(shared[0].photos, shared[1].photos, "same photos");
  assert.equal(shared[0].createdAt, shared[1].createdAt, "same createdAt");
  for (const e of shared) { assert.equal(e.text, "Both loved the bright dots"); assert.equal(e.date, TODAY); }
});

await step("Moments (All) shows the shared moment once, naming both; a child's filter and each Journal show their own copy", async () => {
  await go("#/moments");
  await page.waitFor(`document.querySelector(".journal-card")`, 3000, "Moments");
  await page.eval(`__t.clickSel('.child-chips [data-child="All"]')`); await sleep(200);
  assert.deepEqual(await cards("Both loved the bright dots"), [{ names: "Anan, Lele", together: true, avatars: 2 }]);
  await page.eval(`__t.clickSel(${q(`.child-chips [data-child="${lele.id}"]`)})`); await sleep(200);
  assert.deepEqual(await cards("Both loved the bright dots"), [{ names: "Lele", together: false, avatars: 1 }]);
  await page.eval(`__t.clickSel('.child-chips [data-child="All"]')`); await sleep(200);
  for (const c of [anan, lele]) {
    await go(`#/child/${c.id}`);
    await page.waitFor(`document.querySelector(".child-profile .journal-card")`, 3000, `${c.first}'s Journal`);
    assert.equal((await cards("Both loved the bright dots")).length, 1, `${c.first}'s own copy`);
  }
  await go(`#/child/${doudou.id}`);
  await page.waitFor(`document.querySelector(".child-profile")`, 3000, "Doudou's Journal");
  assert.equal((await cards("Both loved the bright dots")).length, 0, "not in Doudou's Journal");
});

await step("Editing one child's copy splits it off into its own card", async () => {
  const leleCopy = shared.find(e => e.childId === lele.id);
  await go(`#/moment/${leleCopy.id}/edit`);
  await page.waitFor(`document.querySelector(".journal-editor .journal-text-input")`, 3000, "editor");
  assert.equal(await has(".journal-editor .entry-children"), false, "an edit is about its one child");
  await page.eval(`__t.type(".journal-text-input", "Both loved the bright dots, Lele did twelve")`);
  await page.eval(`__t.clickSel(".journal-save")`);
  await page.waitFor(`!document.querySelector(".journal-editor")`, 5000, "saved");
  await go("#/moments");
  await page.waitFor(`document.querySelector(".journal-card")`, 3000, "Moments");
  const split = await cards("Both loved the bright dots");
  assert.deepEqual(split.map(c => c.names).sort(), ["Anan", "Lele"]);
  assert.ok(split.every(c => !c.together));
  const anans = (await live("entries")).find(e => e.id === shared.find(x => x.childId === anan.id).id);
  assert.equal(anans.text, "Both loved the bright dots", "Anan's copy untouched");
});

await step("Completing a plan for all three after Mark as Tried leaves exactly one record per child that day", async () => {
  await go("#/activity/dotting");
  await page.waitFor(`document.querySelector(".detail-page .sticky-action")`, 3000, "activity page");
  await page.eval(`__t.click("Add to My Week", ".sticky-action button")`);
  await page.waitFor(`document.querySelector(".overlay .child-checks button[data-child]")`, 3000, "plan sheet");
  // Quick taps in a row (one synchronous burst, before React re-renders) all count. The child viewed last may
  // already be chosen, so only the others are tapped.
  assert.ok(await page.eval(`document.querySelectorAll(".overlay .child-checks button[aria-pressed=false]").length >= 2`), "at least two taps in the burst");
  await page.eval(`document.querySelectorAll(".overlay .child-checks button[aria-pressed=false]").forEach(b => b.click())`);
  await page.waitFor(`document.querySelectorAll(".overlay .child-checks button[aria-pressed=true]").length === 3`, 3000, "all three chosen");
  await page.waitFor(`!document.querySelector(".overlay .modal-primary").disabled`, 3000, "children chosen");
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await page.waitFor(`document.querySelector(".week-page .day-plan")`, 3000, "My Week");
  const plan = (await live("plans")).find(p => p.activityId === "dotting" && !p.completed);
  assert.deepEqual([...plan.childIds].sort(), [anan.id, lele.id, doudou.id].sort());
  await page.eval(`[...document.querySelectorAll(".day-plan")].find(d => d.innerText.includes("Dotting")).querySelector(".plan-actions button").click()`);
  await page.waitFor(`__t.all("plans").then(ps => ps.find(p => p.id === ${q(plan.id)})?.completed)`, 3000, "completed");
  const today = (await live("records")).filter(r => r.activityId === "dotting" && r.date === TODAY);
  for (const c of [anan, lele, doudou]) assert.equal(today.filter(r => r.childId === c.id).length, 1, `one record for ${c.first}`);
  assert.equal(today.find(r => r.childId === doudou.id).planId, plan.id, "Doudou's comes from the plan");
});

await step("Quick Add Moment for all three: Save waits for a child, then it's shown once in Kids › Recent moments", async () => {
  const before = await live("entries");
  await go("#/today");
  await page.eval(`__t.clickSel(".nav-add")`);
  await page.eval(`__t.click("Add Moment", ".overlay button")`);
  await page.waitFor(`document.querySelector(".journal-editor .entry-children")`, 3000, "editor with child chips");
  await page.eval(`__t.type(".journal-text-input", "Picnic with everyone")`);
  assert.deepEqual(await pressed(".journal-editor"), []);
  assert.ok(await page.eval(`document.querySelector(".journal-save").disabled`), "Save disabled until a child is chosen");
  // Three quick taps in a row (one synchronous burst, before React re-renders) all count.
  await page.eval(`document.querySelectorAll(".journal-editor .child-checks button[data-child]").forEach(b => b.click())`);
  await page.waitFor(`document.querySelectorAll(".journal-editor .child-checks button[aria-pressed=true]").length === 3`, 3000, "all three chosen");
  await page.waitFor(`!document.querySelector(".journal-save").disabled`, 3000, "Save enabled");
  await page.eval(`__t.clickSel(".journal-save")`);
  await page.waitFor(`!document.querySelector(".journal-editor")`, 5000, "saved");
  const added = (await live("entries")).filter(e => !before.some(b => b.id === e.id));
  assert.equal(added.length, 3);
  assert.equal(new Set(added.map(e => e.createdAt)).size, 1, "same createdAt");
  // The draft written before a child was chosen moved with the first child and was cleared on save.
  const drafts = (await page.eval(`__t.all("drafts")`)).map(d => d.key);
  assert.deepEqual(drafts.filter(k => [":new", `${anan.id}:new`, `${lele.id}:new`, `${doudou.id}:new`].includes(k)), [], drafts.join(" "));
  await go("#/kids");
  await page.waitFor(`document.querySelector(".recent-activity button")`, 3000, "Recent moments");
  const rows = await page.eval(`[...document.querySelectorAll(".recent-activity button")].filter(b => b.innerText.includes("Picnic with everyone")).map(b => b.querySelector("strong").innerText)`);
  assert.deepEqual(rows, ["Anan, Lele, Doudou"]);
});

await step("Chinese: the done text names both children, joined with 、", async () => {
  await pickLanguage("Language", "简体中文");
  await page.waitFor(`document.documentElement.lang === "zh-CN"`, 3000, "Chinese");
  await openTried("water-pouring", "标记已尝试");
  assert.equal(await textOf(".overlay fieldset legend"), "谁一起做了？");
  await page.eval(`__t.chooseChildren(".overlay", [${q(lele.id)}, ${q(doudou.id)}])`);
  await page.waitFor(`!document.querySelector(".overlay .sheet-buttons button:last-child").disabled`, 3000, "Save enabled");
  await saveSheet();
  await page.waitFor(`document.querySelector(".tried-done")`, 3000, "saved");
  assert.ok((await textOf(".tried-done")).includes("已为Lele、Doudou标记尝试"), await textOf(".tried-done"));
});

await page.close();
const failedSteps = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failedSteps.length}/${results.length} passed`);
process.exit(failedSteps.length ? 1 : 0);
