import assert from "node:assert/strict";
import path from "node:path";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { BASE, IMG, tempProfile, openDemoEraDevice } from "./env.mjs";

// Cancel, ×, Back and Save on the add forms. Closing a sheet with × used to hand the click event to the app as a
// "destination", which fell through to Help & Support. Cancelling must return to where the form was opened and
// store nothing; saving must still store and navigate as before.

const page = await launch(tempProfile("navigation"), 9342);
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

// Ready on whatever page the URL names (a refresh stays on the current page).
const appReady = () => page.waitFor(`document.querySelector(".app-shell") && document.querySelector(".bottom-nav, main")`, 15000, "app rendered");
const nav = async label => {
  if (!(await page.eval(`!!document.querySelector(".bottom-nav")`))) { await page.home(); await appReady(); }
  await page.eval(`__t.click(${JSON.stringify(label)}, ".bottom-nav button")`); await sleep(150);
};
const activeTab = () => page.eval(`document.querySelector(".bottom-nav button.active")?.textContent.trim() || null`);
const noModal = () => page.waitFor(`!document.querySelector(".overlay")`, 3000, "sheet closed");
const notHelp = async () => assert.ok(!(await page.eval(`document.body.innerText.includes("Help & Support")`)), "Help & Support is not shown");
const openQuick = async () => { await page.eval(`__t.clickSel(".nav-add")`); await page.waitFor(`document.querySelector(".overlay")`, 3000, "Quick Add open"); };
const closeX = async () => { await page.eval(`__t.clickSel(".overlay header button")`); await noModal(); };
const count = async store => (await page.eval(`__t.all(${JSON.stringify(store)})`)).filter(r => !r.deletedAt).length;

await openDemoEraDevice(page, `${BASE}/`);
await appReady();
await page.waitFor(`__t.dbExists()`, 10000, "data stored");

await step("× on Quick Add stays on the tab it was opened from", async () => {
  for (const tab of ["Today", "Kids", "Discover"]) {
    await nav(tab);
    await openQuick();
    await closeX();
    assert.equal(await activeTab(), tab);
    await notHelp();
  }
});

await step("× on Add Child (typed in) closes the sheet, stays on Kids and adds no child", async () => {
  await nav("Kids");
  const before = await count("children");
  await page.eval(`__t.clickSel(".header-add-child")`);
  await page.waitFor(`document.querySelector(".overlay")`, 3000, "Add Child open");
  await page.eval(`__t.type(".overlay input", "Cancelled Child")`);
  await closeX();
  assert.equal(await activeTab(), "Kids");
  await notHelp();
  await sleep(300);
  assert.equal(await count("children"), before);
  assert.ok(!(await page.eval(`document.body.innerText.includes("Cancelled")`)));
});

await step("Add Child opened from Quick Add on Today: × returns to Today", async () => {
  await nav("Today");
  await openQuick();
  await page.eval(`__t.click("Add Child", ".overlay button")`);
  await page.waitFor(`document.querySelector(".overlay input")`, 3000, "Add Child open");
  await closeX();
  assert.equal(await activeTab(), "Today");
  await notHelp();
});

await step("× on Add to My Week stays on the activity", async () => {
  await nav("Discover");
  await page.eval(`__t.clickSel(".activity-name")`);
  await page.waitFor(`document.body.innerText.includes("Add to My Week")`, 3000, "activity open");
  await page.eval(`__t.click("Add to My Week")`);
  await page.waitFor(`document.querySelector(".overlay")`, 3000, "plan sheet open");
  await closeX();
  assert.ok(await page.eval(`document.body.innerText.includes("Mark as Tried")`), "still on the activity");
  await notHelp();
});

await step("Cancel on an activity record opened from Quick Add returns to that tab and saves nothing", async () => {
  const before = await count("records");
  await nav("Today");
  await openQuick();
  await page.eval(`__t.click("Add Activity", ".overlay button")`);
  await page.waitFor(`document.querySelector(".picker-page")`, 3000, "activity picker open");
  // Back from the picker leaves without saving.
  await page.eval(`__t.clickSel(".page-header .icon-button")`);
  await appReady();
  assert.equal(await activeTab(), "Today");
  await openQuick();
  await page.eval(`__t.click("Add Activity", ".overlay button")`);
  await page.waitFor(`document.querySelector(".picker-page")`, 3000, "activity picker open");
  // Cancel on the form (after choosing an activity) also leaves without saving.
  await page.eval(`__t.clickSel(".picker-row")`);
  await page.waitFor(`document.querySelector(".form-bottom")`, 3000, "record form open");
  await page.eval(`__t.click("Cancel", ".form-bottom button")`);
  await appReady();
  assert.equal(await activeTab(), "Today");
  await notHelp();
  assert.equal(await count("records"), before);
});

await step("Cancel on an activity record opened from a child returns to that child", async () => {
  await nav("Kids");
  await page.eval(`__t.clickSel(".child-select-card:not(.add-child-card)")`);
  await page.waitFor(`document.querySelector(".child-tabs, .child-profile, main")`, 3000, "child open");
  await page.eval(`__t.click("Activities")`);
  await page.eval(`__t.click("Add Activity", ".wide-primary")`);
  await page.waitFor(`document.querySelector(".picker-page")`, 3000, "activity picker open");
  await page.eval(`__t.clickSel(".picker-row")`);
  await page.waitFor(`document.querySelector(".form-bottom")`, 3000, "record form open");
  await page.eval(`__t.click("Cancel", ".form-bottom button")`);
  await page.waitFor(`document.body.innerText.includes("Add Activity") && !document.querySelector(".form-page")`, 3000, "back on the child");
  await notHelp();
});

await step("Back on a new Moment returns to where it was opened (Today, Kids, a child), saves nothing and keeps the draft", async () => {
  const before = await count("entries");
  for (const tab of ["Today", "Kids"]) {
    await nav(tab);
    await openQuick();
    await page.eval(`__t.click("Add Moment", ".overlay button")`);
    await page.waitFor(`document.querySelector(".journal-editor")`, 3000, "editor open");
    await page.eval(`__t.type(".journal-editor textarea", "unfinished from ${tab}")`);
    await page.eval(`__t.click("Back", ".journal-editor-bar button")`);
    await appReady();
    assert.equal(await activeTab(), tab);
    await notHelp();
  }
  await nav("Kids");
  await page.eval(`__t.clickSel(".child-select-card:not(.add-child-card)")`);
  await page.waitFor(`document.querySelector(".child-profile")`, 3000, "child open");
  await page.eval(`__t.click("Journal")`);
  await page.eval(`__t.clickSel(".child-profile .journal-write, .child-profile .journal-draft")`);
  await page.waitFor(`document.querySelector(".journal-editor")`, 3000, "editor open");
  await page.eval(`__t.click("Back", ".journal-editor-bar button")`);
  await page.waitFor(`document.querySelector(".child-profile")`, 3000, "back on the child");
  await notHelp();
  assert.equal(await count("entries"), before, "no unfinished Moment saved");
  await page.waitFor(`__t.all("drafts").then(d => d.length > 0)`, 3000, "draft kept");
});

await step("All Moments on Kids opens the timeline, and Back returns to Kids", async () => {
  await nav("Kids");
  await page.eval(`__t.click("All Moments", ".recent-title button")`);
  await page.waitFor(`document.querySelector(".moments-page")`, 3000, "Moments shown");
  await page.eval(`__t.clickSel(".moments-page .page-header .icon-button")`);
  await page.waitFor(`document.querySelector(".children-page")`, 3000, "Kids shown");
  assert.equal(await activeTab(), "Kids");
});

await step("Save still works: a Moment from Quick Add is stored and opens Moments; Add Child keeps the name as typed", async () => {
  const entries = await count("entries");
  await nav("Today");
  await openQuick();
  await page.eval(`__t.click("Add Moment", ".overlay button")`);
  await page.waitFor(`document.querySelector(".journal-editor")`, 3000, "editor open");
  await page.eval(`__t.type(".journal-editor textarea", "Saved from navigation test")`);
  // Two children and none chosen yet: the Moment can't be saved until the parent picks one.
  assert.ok(await page.eval(`document.querySelector(".journal-save").disabled`), "no child chosen yet");
  await page.eval(`__t.type(".entry-child-pick select", "emma")`);
  await page.waitFor(`!document.querySelector(".journal-save").disabled`, 3000, "save enabled");
  await page.eval(`__t.clickSel(".journal-save")`);
  await page.waitFor(`document.body.innerText.includes("Saved from navigation test") && !document.querySelector(".journal-editor")`, 5000, "moment shown");
  assert.equal(await count("entries"), entries + 1);

  const children = await count("children");
  await nav("Kids");
  await page.eval(`__t.clickSel(".header-add-child")`);
  await page.waitFor(`document.querySelector(".overlay")`, 3000, "Add Child open");
  await page.eval(`__t.type(".overlay input", "Navi")`);
  // A birthday is needed (age comes from it), and it can't be in the future.
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await page.waitFor(`document.querySelector(".overlay [role=alert]")`, 3000, "birthday required");
  await page.eval(`__t.type(".overlay input[type=date]", "2099-01-01")`);
  await page.waitFor(`document.querySelector(".overlay [role=alert]")?.textContent.includes("future")`, 3000, "future birthday refused");
  await page.eval(`__t.type(".overlay input[type=date]", "2023-05-01")`);
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await noModal();
  await page.waitFor(`document.body.innerText.includes("Navi")`, 3000, "child shown");
  assert.equal(await count("children"), children + 1);
  const navi = (await page.eval(`__t.all("children")`)).find(c => c.first === "Navi");
  assert.equal(navi.last, "", "no automatic surname");
  await page.eval(`__t.click("Navi", ".child-select-card")`);
  await page.waitFor(`document.querySelector(".profile-hero h1")`, 3000, "profile open");
  assert.equal(await page.eval(`document.querySelector(".profile-hero h1").textContent.trim()`), "Navi");
  assert.ok(!(await page.eval(`document.body.innerText.includes("Navi Child")`)));
});

const maya = async () => (await page.eval(`__t.all("children")`)).find(c => c.id === "emma");
const openEdit = async () => {
  await nav("Kids");
  await page.eval(`__t.click("Maya", ".child-select-card")`);
  await page.waitFor(`document.querySelector(".profile-hero h1")`, 3000, "profile open");
  await page.eval(`__t.click("Edit", ".child-header-actions button")`);
  await page.waitFor(`document.querySelector(".overlay .sheet-fields")`, 3000, "Edit Child open");
};

await step("Edit Child: prefilled; name, birthday and photo saved to the same record (group kept); Moments stay attached", async () => {
  const before = await maya();
  const mine = (await page.eval(`__t.all("entries")`)).filter(e => e.childId === "emma" && !e.deletedAt).length;
  const total = await count("children");
  await openEdit();
  assert.ok(await page.eval(`document.querySelector(".overlay h2").textContent === "Edit Child"`));
  assert.equal(await page.eval(`document.querySelector(".sheet-fields input").value`), `${before.first} ${before.last}`);
  assert.equal(await page.eval(`document.querySelector(".sheet-fields input[type=date]").value`), before.dob);
  await page.eval(`__t.type(".sheet-fields input", "Maya Rose Hao")`);
  await page.eval(`__t.type(".sheet-fields input[type=date]", "2023-03-04")`);
  // Group and notes are no longer on the form; whatever was saved before is kept.
  assert.ok(!(await page.eval(`!!document.querySelector(".sheet-fields select, .sheet-fields textarea")`)), "no group or notes fields");
  const oldPreview = await page.eval(`document.querySelector(".child-photo-row-preview")?.src || ""`);
  await page.setFiles(".child-photo-field input[type=file]", [path.join(IMG, "portrait.png")]);
  await page.waitFor(`(document.querySelector(".child-photo-row-preview")?.src || "") !== ${JSON.stringify(oldPreview)}`, 15000, "new photo shown");
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await noModal();
  await page.waitFor(`document.querySelector(".profile-hero h1").textContent.trim() === "Maya Rose Hao"`, 3000, "profile updated");
  const after = await maya();
  assert.equal(after.id, "emma");
  assert.equal(after.first, "Maya"); assert.equal(after.last, "Rose Hao");
  assert.equal(after.dob, "2023-03-04"); assert.equal(after.group, before.group);
  assert.match(after.photo, /^photo-/); assert.notEqual(after.photo, before.photo);
  assert.equal(await count("children"), total, "no duplicate child");
  assert.equal((await page.eval(`__t.all("entries")`)).filter(e => e.childId === "emma" && !e.deletedAt).length, mine);
  // Reopen after a reload: still saved, and the new name shows on Moments too.
  await page.reload(); await appReady();
  await nav("Kids");
  await page.eval(`__t.click("All Moments", ".recent-title button")`);
  await page.waitFor(`document.querySelector(".moments-page") && document.body.innerText.includes("Maya Rose Hao")`, 3000, "Moments show the new name");
});

await step("Edit Child: × discards the edits, and reopening shows the saved values", async () => {
  const before = await maya();
  await openEdit();
  await page.eval(`__t.type(".sheet-fields input", "Discarded Name")`);
  await page.eval(`__t.type(".sheet-fields input[type=date]", "2020-01-01")`);
  await closeX();
  assert.ok(await page.eval(`!!document.querySelector(".child-profile")`), "still on the child");
  await notHelp();
  await sleep(300);
  assert.deepEqual(await maya(), before);
  await page.eval(`__t.click("Edit", ".child-header-actions button")`);
  await page.waitFor(`document.querySelector(".overlay .sheet-fields")`, 3000, "Edit Child open");
  assert.equal(await page.eval(`document.querySelector(".sheet-fields input").value`), "Maya Rose Hao");
  await closeX();
  // Add Child afterwards starts empty, not with the edited child's details.
  await nav("Kids");
  await page.eval(`__t.clickSel(".header-add-child")`);
  await page.waitFor(`document.querySelector(".overlay .sheet-fields")`, 3000, "Add Child open");
  assert.equal(await page.eval(`document.querySelector(".sheet-fields input").value`), "");
  await closeX();
});

// Regression tests for the 6 Back-target bugs found during the full click-through audit: a screen reachable from
// more than one origin had a hardcoded (or incomplete) back destination, so Back skipped past where the parent
// actually came from. Each test below reproduces the exact origin that used to break, and also exercises the
// screen's other, already-working origin so a future fix can't "fix" one path by breaking the other.

await step("My Week > Add Planning Note: Back returns to My Week, not a settings screen", async () => {
  await nav("Profile");
  await page.eval(`__t.click("My Week", ".menu-section button")`);
  await page.waitFor(`document.querySelector(".week-page")`, 3000, "My Week open");
  await page.eval(`__t.clickSel(".week-page .round-add")`);
  await page.waitFor(`document.querySelector(".overlay")`, 3000, "week add sheet open");
  await page.eval(`__t.click("Add Planning Note", ".overlay button")`);
  await page.waitFor(`document.querySelector(".notes-pad")`, 3000, "Notes open");
  await page.eval(`__t.clickSel(".page-header .icon-button")`);
  await page.waitFor(`document.querySelector(".week-page")`, 3000, "back on My Week");
  await notHelp();
});

await step("Activity Detail > Add to My Week: lands on the Weekly Plan tab even from Completed, and Back there returns to the activity", async () => {
  await nav("Profile");
  await page.eval(`__t.click("My Week", ".menu-section button")`);
  await page.waitFor(`document.querySelector(".week-page")`, 3000, "My Week open");
  // Leave My Week on a tab other than Weekly Plan, so landing on Weekly Plan after Add to My Week is a real
  // change and not just whatever tab was already selected.
  await page.eval(`__t.click("Completed", ".segmented button")`);
  assert.equal(await page.eval(`document.querySelector(".segmented button.active")?.textContent.trim()`), "Completed");
  // Back here returns to Profile (My Week's other real origin), preserving the tab just set.
  await page.eval(`__t.clickSel(".page-header .icon-button")`);
  await page.waitFor(`document.querySelector(".bottom-nav")`, 3000, "back on a tab page");
  assert.equal(await activeTab(), "Profile");

  await nav("Discover");
  await page.eval(`__t.clickSel(".activity-name")`);
  await page.waitFor(`document.body.innerText.includes("Add to My Week")`, 3000, "activity open");
  await page.eval(`__t.click("Add to My Week")`);
  await page.waitFor(`document.querySelector(".overlay .child-checks button")`, 3000, "plan sheet open");
  await page.eval(`__t.clickSel(".overlay .child-checks button")`);
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await page.waitFor(`document.querySelector(".week-page")`, 3000, "landed on My Week");
  assert.equal(await page.eval(`document.querySelector(".segmented button.active")?.textContent.trim()`), "Weekly Plan");
  await notHelp();

  await page.eval(`__t.clickSel(".page-header .icon-button")`);
  await page.waitFor(`document.body.innerText.includes("Mark as Tried")`, 3000, "back on the activity, not Profile");
  await notHelp();
});

await step("Moments > Weekly Recap: Back returns to Moments", async () => {
  await nav("Kids");
  await page.eval(`__t.click("All Moments", ".recent-title button")`);
  await page.waitFor(`document.querySelector(".moments-page")`, 3000, "Moments shown");
  await page.eval(`__t.clickSel(".moments-week-link")`);
  await page.waitFor(`document.querySelector(".recap-page")`, 3000, "Weekly Recap open");
  await page.eval(`__t.clickSel(".page-header .icon-button")`);
  await page.waitFor(`document.querySelector(".moments-page")`, 3000, "back on Moments");
  await notHelp();
});

await step("Profile > Saved Activities > an activity: Back returns to Saved Activities, not Discover", async () => {
  await nav("Discover");
  await page.eval(`__t.clickSel(".activity-name")`);
  await page.waitFor(`document.body.innerText.includes("Add to My Week")`, 3000, "activity open");
  const wasSaved = await page.eval(`document.querySelectorAll(".detail-actions button")[1].getAttribute("aria-pressed") === "true"`);
  if (!wasSaved) await page.eval(`__t.clickSel(".detail-actions button", 1)`);
  await page.waitFor(`document.querySelectorAll(".detail-actions button")[1].getAttribute("aria-pressed") === "true"`, 3000, "activity saved");
  await page.eval(`__t.clickSel(".detail-actions button", 0)`);
  await appReady();

  await nav("Profile");
  await page.eval(`__t.click("Saved Activities", ".menu-section button")`);
  await page.waitFor(`document.querySelector(".simple-page .week-list")`, 3000, "Saved Activities open");
  await page.eval(`__t.clickSel(".simple-page .week-list button")`);
  await page.waitFor(`document.body.innerText.includes("Add to My Week")`, 3000, "activity open from Saved Activities");
  await page.eval(`__t.clickSel(".detail-actions button", 0)`);
  await page.waitFor(`document.querySelector(".simple-page h1")?.textContent.trim() === "Saved Activities"`, 3000, "back on Saved Activities, not Discover");
});

await step("Today > Looking Back > Child Profile: Back returns to Today", async () => {
  await nav("Today");
  const past = new Date(Date.now() - 9 * 86400000);
  await page.eval(`__t.put("records", { id: "nav-test-tried", childId: "emma", lesson: "Mopping the Floor", area: "practical-life", date: ${JSON.stringify(past.toISOString().slice(0, 10))}, kind: "tried", activityId: "mopping", createdAt: ${JSON.stringify(past.toISOString())}, origin: "user" })`);
  await page.reload();
  await appReady();
  await page.waitFor(`document.querySelector("#today-looking-back")`, 5000, "Looking Back card shown");
  await page.eval(`__t.clickSel(".today-memory.tried")`);
  await page.waitFor(`document.querySelector(".profile-hero h1")`, 3000, "child profile open");
  await page.eval(`__t.clickSel(".child-header button")`);
  await page.waitFor(`document.querySelector(".bottom-nav")`, 3000, "back on a tab page");
  assert.equal(await activeTab(), "Today");
  await notHelp();
  // Clean up the seeded record; it was only needed to make the card appear.
  await page.eval(`__t.del("records", "nav-test-tried")`);
});

await step("Normal paths still work: My Week and an activity each still return to Profile/Discover by default", async () => {
  await nav("Profile");
  await page.eval(`__t.click("My Week", ".menu-section button")`);
  await page.waitFor(`document.querySelector(".week-page")`, 3000, "My Week open");
  await page.eval(`__t.clickSel(".page-header .icon-button")`);
  await page.waitFor(`document.querySelector(".bottom-nav")`, 3000, "back on a tab page");
  assert.equal(await activeTab(), "Profile");

  await nav("Discover");
  await page.eval(`__t.clickSel(".activity-name")`);
  await page.waitFor(`document.body.innerText.includes("Add to My Week")`, 3000, "activity open");
  await page.eval(`__t.clickSel(".detail-actions button", 0)`);
  await page.waitFor(`document.querySelector(".bottom-nav")`, 3000, "back on a tab page");
  assert.equal(await activeTab(), "Discover");
});

await page.close();
const failed = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
