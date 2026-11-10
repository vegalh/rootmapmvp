import assert from "node:assert/strict";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { BASE, tempProfile } from "./env.mjs";

// The daily loop, on a phone: a new family answers "When are you usually together?", taps "Do this today" on Today's
// idea, marks it as tried from Today's plan, keeps a few words in "Want to remember this?" (and that the child loved
// it), and finds the moment in the weekly recap, whose Share first says the picture leaves RootMap. Also: with no
// children, Today asks nothing and offers no plan button; Profile has Our routine and the reminder row.

const page = await launch(tempProfile("daily-loop"), 9376);
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
const go = async h => { await page.eval(`location.hash = ${q(h)}`); await sleep(300); };
const has = sel => page.eval(`!!document.querySelector(${q(sel)})`);
const textOf = sel => page.eval(`document.querySelector(${q(sel)})?.innerText ?? ""`);
const live = async store => (await page.eval(`__t.all(${q(store)})`)).filter(r => !r.deletedAt);
const localIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = localIso(new Date());

await page.nav(`${BASE}/`);
await page.waitFor(`document.querySelector(".app-shell") && document.querySelector(".today-page")`, 15000, "Today");

await step("No children: Today looks as before (no routine question, no plan button, More ideas in Discover)", async () => {
  assert.equal(await has(".today-routine"), false);
  assert.equal(await has(".today-do"), false);
  assert.equal(await has(".today-again"), false);
  assert.equal(await textOf(".today-eyebrow#today-inspiration"), "TODAY'S INSPIRATION");
  assert.match(await textOf(".today-more"), /More ideas in Discover/);
});

let child;
await step("A child: Today asks once when the family is together; the answer picks the heading", async () => {
  await go("#/kids");
  await page.eval(`__t.clickSel(".header-add-child")`);
  await page.waitFor(`document.querySelector(".overlay .sheet-fields")`, 3000, "Add Child");
  await page.eval(`__t.type(".overlay input", "Mira Chen")`);
  await page.eval(`__t.type(".overlay input[type=date]", ${q(`${new Date().getFullYear() - 4}-01-15`)})`);
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await page.waitFor(`!document.querySelector(".overlay")`, 3000, "added");
  child = (await live("children")).find(c => c.first === "Mira");
  await go("#/today");
  await page.waitFor(`document.querySelector(".today-routine")`, 3000, "routine question");
  assert.equal(await textOf(".today-routine h2"), "When are you usually together?");
  assert.ok(await page.eval(`document.querySelector(".routine-actions .primary").disabled`), "Save waits for a choice");
  await page.eval(`__t.clickSel('[data-routine="after-dinner"]')`);
  await page.eval(`__t.clickSel(".routine-actions .primary")`);
  await page.waitFor(`!document.querySelector(".today-routine")`, 3000, "answered");
  assert.equal(await textOf("#today-inspiration"), "AFTER DINNER TONIGHT");
  const setting = (await page.eval(`__t.all("settings")`)).find(s => s.key === "rootmap-routine")?.value;
  assert.deepEqual(setting.routines, ["after-dinner"]);
  await page.reload();
  await page.waitFor(`document.querySelector(".today-page")`, 10000, "reloaded");
  assert.equal(await has(".today-routine"), false, "not asked again");
});

await step("Show me another: three ideas, then Discover", async () => {
  const titles = [await textOf(".today-feature-caption strong")];
  for (let i = 0; i < 2; i++) {
    await page.eval(`__t.clickSel(".today-another")`);
    await sleep(150);
    titles.push(await textOf(".today-feature-caption strong"));
  }
  assert.equal(new Set(titles).size, 3, titles.join(" / "));
  assert.equal(await has(".today-another"), false);
  assert.match(await textOf(".today-more"), /More ideas in Discover/);
});

let title;
await step("Do this today → Mark as Tried → a few words and Loved it → the moment, linked to the record", async () => {
  title = await textOf(".today-feature-caption strong");
  await page.eval(`__t.clickSel(".today-do")`);
  await page.waitFor(`[...document.querySelectorAll(".today-plan strong")].some(s => s.innerText === ${q(title)})`, 3000, "in today's plan");
  assert.notEqual(await textOf(".today-feature-caption strong"), title, "the idea moved into the plan");
  const plan = (await live("plans")).find(p => p.date === TODAY);
  assert.deepEqual(plan.childIds, [child.id]);

  await page.eval(`__t.clickSel(".today-plan-tried")`);
  await page.waitFor(`document.querySelector(".overlay .remember-text")`, 3000, "Want to remember this?");
  assert.equal(await textOf(".overlay .bottom-sheet h2"), "Want to remember this?");
  assert.equal(await textOf(".enjoy-row legend"), "Did Mira enjoy it?");
  await page.eval(`__t.clickSel('[data-enjoyed="loved"]')`);
  await page.eval(`__t.type(".overlay .remember-text", "She stirred it all by herself")`);
  await page.eval(`[...document.querySelectorAll(".overlay .sheet-buttons button")].at(-1).click()`);
  await page.waitFor(`!document.querySelector(".overlay")`, 5000, "saved");

  const record = (await live("records")).find(r => r.kind === "tried" && r.planId === plan.id);
  assert.equal(record.enjoyed, "loved");
  const entry = (await live("entries")).find(e => e.text === "She stirred it all by herself");
  assert.ok(entry, "a Moment");
  assert.equal(entry.childId, child.id); assert.equal(entry.date, TODAY); assert.equal(entry.title, title); assert.equal(entry.recordId, record.id);
  assert.ok((await live("plans")).find(p => p.id === plan.id).completed);
});

await step("Not now changes nothing", async () => {
  const before = { entries: (await live("entries")).length, records: JSON.stringify(await live("records")) };
  await page.eval(`__t.clickSel(".today-do")`);
  await page.waitFor(`document.querySelector(".today-plan-tried")`, 3000, "planned");
  await page.eval(`__t.clickSel(".today-plan-tried")`);
  await page.waitFor(`document.querySelector(".overlay .remember-text")`, 3000, "sheet");
  const triedNow = (await live("records")).length;
  await page.eval(`__t.click("Not now", ".overlay button")`);
  await page.waitFor(`!document.querySelector(".overlay")`, 3000, "closed");
  assert.equal((await live("entries")).length, before.entries);
  assert.equal((await live("records")).length, triedNow, "only the tried record itself");
  assert.ok((await live("records")).every(r => !r.enjoyed || JSON.parse(before.records).some(b => b.id === r.id)));
});

await step("The moment is in the weekly recap; Share first says the picture leaves RootMap", async () => {
  await go("#/moments-week");
  await page.waitFor(`document.querySelector(".recap-page")`, 3000, "recap");
  await page.waitFor(`document.body.innerText.includes("She stirred it all by herself")`, 3000, "moment in the week");
  assert.ok(await has(".recap-share"));
  await page.eval(`__t.clickSel(".recap-share")`);
  const text = await page.confirmDialog({ cancel: true });
  assert.ok(text.includes("This picture leaves RootMap when you share it."), text);
});

await step("Kids: Enjoys, from what Mira loved; Profile: Our routine and the daily reminder (iOS app only)", async () => {
  await go("#/kids");
  await page.waitFor(`document.querySelector(".child-select-card")`, 3000, "Kids");
  assert.match(await textOf(".child-select-card"), /Enjoys:/);
  await go("#/profile");
  await page.waitFor(`document.querySelector(".profile-page")`, 3000, "Profile");
  const profile = await textOf(".profile-page");
  assert.ok(profile.includes("Our routine") && profile.includes("After dinner"), profile);
  assert.ok(profile.includes("Daily idea reminder") && profile.includes("Available in the iOS app"));
  assert.ok(!profile.includes("Coming soon"));
});

await page.close();
const failedSteps = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failedSteps.length}/${results.length} passed`);
process.exit(failedSteps.length ? 1 : 0);
