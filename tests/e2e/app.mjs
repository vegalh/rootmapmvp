import path from "node:path";
import assert from "node:assert/strict";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { FIXTURE } from "./fixture.mjs";
import { BASE, IMG, tempProfile } from "./env.mjs";

// Migration, everyday features and persistence, on one simulated device.
const PROFILE = tempProfile("app");
const PORT = 9333;

const results = [];
let page;
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

async function start() {
  page = await launch(PROFILE, PORT);
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
}
const appReady = () => page.waitFor(`document.querySelector(".app-shell") && document.querySelector(".bottom-nav, .page-content, main")`, 15000, "app rendered");
const dump = () => page.eval("__t.dump()");
const ls = () => page.eval("__t.ls()");
// Bottom navigation only exists on top-level screens; a reload returns to My Children like a fresh visit.
const nav = async label => {
  if (!(await page.eval(`!!document.querySelector(".bottom-nav")`))) { await page.reload(); await appReady(); }
  await page.eval(`__t.click(${JSON.stringify(label)}, ".bottom-nav button")`);
  await sleep(150);
};

// Legacy localStorage exactly as the previous version wrote it, with large inline photos, Unicode and edge cases.


// ---------------------------------------------------------------------------------------------------------
await start();
let fixture, lsBefore;

await step("1. Seed legacy localStorage (previous version's format, 4 large inline photos + avatars)", async () => {
  await page.nav(`${BASE}/package.json`);
  await page.eval("__t.deleteDb()");
  fixture = await page.eval(FIXTURE);
  lsBefore = await ls();
  const bytes = Object.values(lsBefore).reduce((n, v) => n + v.length, 0);
  console.log(`      localStorage fixture: ${Object.keys(lsBefore).length} keys, ${(bytes / 1e6).toFixed(2)}M chars`);
});

let db;
await step("2-9. First start migrates everything: children, entries+photos, records, plans, goals, saved, deleted children, drafts, settings", async () => {
  await page.nav(`${BASE}/`);
  await appReady();
  await page.waitFor(`__t.all("meta").then(m => m && m.some(x => x.key === "migration" && x.state === "complete"))`);
  db = await dump();
  const { data, photos } = fixture;
  const ids = list => list.map(x => x.id).sort();
  // children: 3 active + 1 deleted (the stale snapshot of active "noah" is archived, not a second record)
  assert.deepEqual(ids(db.children.filter(c => !c.deletedAt)), ["c-1760000000000", "emma", "noah"]);
  assert.deepEqual(db.children.filter(c => c.deletedAt).map(c => [c.id, c.deletedAt]), [["c-1760000000001", "2026-09-20T10:00:00.000Z"]]);
  assert.ok(db.archive.some(a => a.reason === "snapshot-of-active-child" && a.value.id === "noah"));
  const xm = db.children.find(c => c.id === "c-1760000000000");
  assert.equal(xm.first, "小明"); assert.equal(xm.notes, "Loves trains 🚂");
  // entries keep ids, dates, text, child links and timestamps
  assert.deepEqual(ids(db.entries), ids(data["rootmap-journal"]));
  for (const orig of data["rootmap-journal"]) {
    const e = db.entries.find(x => x.id === orig.id);
    for (const k of ["childId", "date", "title", "text", "createdAt", "updatedAt"]) assert.equal(e[k], orig[k], `${orig.id}.${k}`);
    assert.equal(e.photos.length, orig.photos.length);
    assert.ok(e.photos.every(p => /^photo-[0-9a-f-]{36}$/.test(p)), "photos referenced by id");
    assert.equal(e.deletedAt, null);
  }
  // photos are byte-identical to the originals
  const e1 = db.entries.find(x => x.id === "m-1760000000000-a1b2c3");
  for (const [i, key] of ["P1", "P2", "P3"].entries()) assert.equal(await page.eval(`__t.photoB64(${JSON.stringify(e1.photos[i])})`), photos[key].split(",")[1], `${key} bytes`);
  assert.equal(await page.eval(`__t.photoB64(${JSON.stringify(xm.photo)})`), photos.A.split(",")[1], "child photo bytes");
  const profile = db.settings.find(s => s.key === "rootmap-profile").value;
  assert.equal(profile.name, "Lin Wei 林伟");
  assert.equal(await page.eval(`__t.photoB64(${JSON.stringify(profile.photo)})`), photos.C.split(",")[1], "profile photo bytes");
  // draft photo is the same stored photo as the entry's (deduplicated)
  const draft = db.drafts.find(d => d.key === "emma:new");
  assert.equal(draft.text, "She said 'again!'"); assert.equal(draft.photos[0], e1.photos[1]);
  assert.equal(db.photoBlobs.length, 7, "A, B, C, P1-P4 stored once each");
  assert.equal(db.photos.length, 7);
  assert.ok(db.photos.every(p => p.storagePath === null && p.uploadedAt === null && p.source === "migrated"));
  // records, plans, goals, saved
  assert.deepEqual(ids(db.records), ["r1", "r2", "t-1760000000000-qwerty"]);
  assert.equal(db.records.find(r => r.id === "r1").createdAt, null, "no invented creation date");
  assert.equal(db.records.find(r => r.id === "t-1760000000000-qwerty").date, "2026-10-04");
  assert.deepEqual(ids(db.plans), ["p-1760000000000", "p-1760000000001"]);
  assert.deepEqual(ids(db.goals), ["g-1760000000000", "g-1760000000001"]);
  assert.equal(db.goals.find(g => g.id === "g-1760000000000").title, "Read together every night 每晚一起读书");
  assert.deepEqual(db.saved.sort((a, b) => a.position - b.position).map(s => s.id), ["water-pouring", "dotting", "sweeping"]);
  // settings
  const setting = k => db.settings.find(s => s.key === k)?.value;
  assert.equal(setting("rootmap-personal-notes"), "Custom activity: 纸杯电话\nMaterials:");
  assert.equal(setting("rootmap-pref-Follow-up reminders"), false);
  assert.deepEqual(setting("rootmap-read-notifications"), ["n1"]);
  // origin labels
  assert.equal(db.children.find(c => c.id === "emma").origin, "demo");
  assert.equal(xm.origin, "user");
  assert.ok(db.archive.some(a => a.source === "rootmap-goals.corrupt"));
  // every stored record has sync fields
  for (const name of ["children", "records", "observations", "entries", "plans", "goals", "saved"]) {
    for (const r of db[name]) assert.ok("createdAt" in r && typeof r.updatedAt === "string" && "deletedAt" in r && r.migratedAt, `${name}/${r.id} sync fields`);
  }
  const m = db.meta.find(x => x.key === "migration");
  console.log(`      migration report: ${JSON.stringify(m.report.counts)}, photos ${m.report.photos} (${(m.report.photoBytes / 1e6).toFixed(2)} MB), archived ${m.report.archived}`);
});

await step("Original localStorage is untouched by the migration", async () => {
  const after = await ls();
  const added = Object.keys(after).filter(k => !(k in lsBefore));
  assert.deepEqual(added, ["rootmap-data-store"]);
  for (const k of Object.keys(lsBefore)) assert.equal(after[k], lsBefore[k], `localStorage ${k} changed`);
});

await step("Migrated data displays: children, photos (blob URLs), Moments, profile", async () => {
  const text = await page.eval("__t.text()");
  for (const s of ["Maya", "Leo", "小明"]) assert.ok(text.includes(s), `children page shows ${s}`);
  assert.ok(!text.includes("Zoë"), "deleted child hidden");
  await page.waitFor(`__t.imagesLoaded(".child-select-photo img").every(i => i.ok)`, 5000, "child photos load");
  await nav("Moments");
  await page.waitFor(`document.body.innerText.includes("第一次骑车")`);
  await page.waitFor(`__t.imagesLoaded(".journal-card-photo img").length >= 1 && __t.imagesLoaded(".journal-card-photo img").every(i => i.ok && i.src.startsWith("blob:"))`, 5000, "entry photos load from blob URLs");
  assert.ok((await page.eval("__t.text()")).includes("Continue writing"), "migrated draft offered");
  await nav("Profile");
  await page.waitFor(`document.body.innerText.includes("Lin Wei 林伟")`);
  await page.waitFor(`__t.imagesLoaded(".user-summary img").every(i => i.ok && i.src.startsWith("blob:"))`, 5000, "profile photo");
});

await step("10. Refresh keeps data; 12. repeated start does not duplicate anything", async () => {
  await page.reload();
  await appReady();
  const again = await dump();
  for (const s of ["children", "entries", "records", "plans", "goals", "saved", "photos", "photoBlobs", "drafts", "settings"]) assert.equal(again[s].length, db[s].length, `${s} count`);
  assert.deepEqual(again.meta, db.meta, "migration did not run again");
});

await step("12b. Forcing the migration to run again (marker removed) still yields no duplicates", async () => {
  await page.eval(`__t.del("meta", "migration")`);
  await page.reload();
  await appReady();
  await page.waitFor(`__t.all("meta").then(m => m.some(x => x.key === "migration"))`);
  const again = await dump();
  for (const s of ["children", "entries", "records", "plans", "goals", "saved", "photos", "photoBlobs", "drafts"]) assert.equal(again[s].length, db[s].length, `${s} count`);
  db = again;
});

await step("13. Interrupted migration (partial data, no completion marker) is redone cleanly", async () => {
  await page.eval(`__t.del("meta", "migration")`);
  await page.eval(`__t.put("entries", { id: "half-written-junk", childId: "emma", date: "2026-01-01", photos: [], createdAt: "x", updatedAt: "x" })`);
  await page.eval(`__t.del("children", "emma")`);
  await page.reload();
  await appReady();
  await page.waitFor(`__t.all("meta").then(m => m.some(x => x.key === "migration"))`);
  const again = await dump();
  assert.ok(!again.entries.some(e => e.id === "half-written-junk"), "partial leftovers cleared");
  assert.ok(again.children.some(c => c.id === "emma"), "missing record restored from localStorage");
  for (const s of ["children", "entries", "records", "photos"]) assert.equal(again[s].length, db[s].length, `${s} count`);
  db = again;
});

await step("14. Failed migration keeps the app on the original data (and retries next start)", async () => {
  await page.eval("__t.deleteDb()");
  await page.nav(`${BASE}/package.json`);
  await page.eval("__t.deleteDb()");
  const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `{ const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...a) { if (this.name === "photoBlobs") throw new DOMException("Simulated full disk", "QuotaExceededError"); return put.apply(this, a); }; }` });
  page.warnings.length = 0;
  await page.nav(`${BASE}/`);
  await appReady();
  const text = await page.eval("__t.text()");
  assert.ok(text.includes("小明") && text.includes("Maya"), "original data shown");
  assert.equal(await page.eval(`__t.all("meta").then(m => (m || []).length)`), 0, "not marked migrated");
  assert.ok(page.warnings.some(w => w.includes("using localStorage")), "explained in a console warning");
  const after = await ls();
  for (const k of Object.keys(lsBefore)) assert.equal(after[k], lsBefore[k], `localStorage ${k} changed`);
  await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  await page.reload();
  await appReady();
  await page.waitFor(`__t.all("meta").then(m => m && m.some(x => x.key === "migration"))`, 10000, "migrated on retry");
  db = await dump();
  assert.equal(db.photoBlobs.length, 7);
});

await step("16. Create a new Moment with 3 large camera-sized photos (one ~13 MB incompressible)", async () => {
  await page.nav(`${BASE}/`);
  await appReady();
  await nav("Moments");
  await page.eval(`__t.type(".moments-controls select", "c-1760000000000")`);
  await page.eval(`__t.click("Add Moment")`);
  await page.waitFor(`document.querySelector(".journal-text-input")`);
  await page.setFiles(".journal-add-photo input[type=file]", ["landscape.png", "noise.png", "portrait.png"].map(f => path.join(IMG, f)));
  await page.waitFor(`document.querySelectorAll(".journal-photos figure img").length === 3`, 30000, "3 photos added");
  await page.waitFor(`__t.imagesLoaded(".journal-photos figure img").every(i => i.ok)`, 10000, "previews load");
  await page.eval(`__t.type(".journal-title-input", "Big photos 大照片")`);
  await page.eval(`__t.type(".journal-text-input", "Three large photos.")`);
  await page.eval(`document.querySelector(".journal-save").click()`);
  await page.waitFor(`document.querySelector(".toast")?.textContent === "Saved"`);
  const now = await dump();
  const e = now.entries.find(x => x.title === "Big photos 大照片");
  assert.ok(e && /^m-[0-9a-f]{8}-/.test(e.id), "uuid-based id");
  assert.equal(e.photos.length, 3);
  assert.equal(e.origin, "user");
  assert.ok(e.createdAt && e.updatedAt && e.deletedAt === null);
  const metas = e.photos.map(id => now.photos.find(p => p.id === id));
  for (const m of metas) assert.ok(m && Math.max(m.width, m.height) <= 2048 && m.byteSize > 0 && m.source === "upload", JSON.stringify(m));
  console.log(`      stored sizes: ${metas.map(m => `${m.width}x${m.height} ${(m.byteSize / 1e6).toFixed(2)}MB`).join(", ")}`);
  assert.equal(now.entries.length, db.entries.length + 1, "exactly one new entry");
  assert.ok(!now.drafts.some(d => d.key === "c-1760000000000:new"), "draft cleared with the save");
  db = now;
});

await step("17. Edit an existing entry: same id, createdAt kept, photos kept, updatedAt changes", async () => {
  const orig = db.entries.find(x => x.id === "m-1760000000000-a1b2c3");
  await page.eval(`__t.type(".moments-controls select", "All")`);
  await page.waitFor(`document.body.innerText.includes("第一次骑车")`);
  await page.eval(`__t.click("第一次骑车", ".journal-card")`);
  await page.waitFor(`document.querySelector(".journal-entry")`);
  await page.waitFor(`__t.imagesLoaded(".journal-entry-photos img").length === 3 && __t.imagesLoaded(".journal-entry-photos img").every(i => i.ok)`, 5000, "detail photos");
  await page.eval(`__t.click("Edit")`);
  await page.waitFor(`document.querySelector(".journal-title-input")`);
  await page.eval(`__t.type(".journal-title-input", "第一次骑车 🚲 (edited)")`);
  await page.eval(`document.querySelector(".journal-save").click()`);
  await page.waitFor(`document.querySelector(".toast")?.textContent === "Saved"`);
  const now = await dump();
  const e = now.entries.find(x => x.id === orig.id);
  assert.equal(e.title, "第一次骑车 🚲 (edited)");
  assert.equal(e.createdAt, orig.createdAt);
  assert.deepEqual(e.photos, orig.photos);
  assert.equal(e.date, orig.date);
  assert.notEqual(e.updatedAt, orig.updatedAt);
  assert.equal(now.entries.length, db.entries.length);
  db = now;
});

await step("Drafts: autosave, survive refresh, resume without duplicating", async () => {
  await nav("Moments");
  await page.eval(`__t.type(".moments-controls select", "noah")`);
  await page.eval(`__t.click("Add Moment")`);
  await page.waitFor(`document.querySelector(".journal-text-input")`);
  await page.eval(`__t.type(".journal-text-input", "Leo stacked five blocks")`);
  await page.waitFor(`document.querySelector(".journal-status")?.textContent === "Draft saved on this device"`, 5000, "draft saved status");
  assert.ok((await page.eval(`__t.all("drafts")`)).some(d => d.key === "noah:new" && d.text === "Leo stacked five blocks"));
  await page.reload();
  await appReady();
  await nav("Moments");
  await page.eval(`__t.type(".moments-controls select", "noah")`);
  await page.waitFor(`document.body.innerText.includes("Continue writing")`);
  await page.eval(`__t.click("Continue writing", "button")`);
  await page.waitFor(`document.querySelector(".journal-text-input")?.value === "Leo stacked five blocks"`);
  assert.ok((await page.eval("__t.text()")).includes("Your unsaved draft was restored."));
  await page.eval(`document.querySelector(".journal-save").click()`);
  await page.waitFor(`document.querySelector(".toast")?.textContent === "Saved"`);
  const now = await dump();
  assert.equal(now.entries.filter(e => e.text === "Leo stacked five blocks").length, 1, "one entry");
  assert.ok(!now.drafts.some(d => d.key === "noah:new"), "draft gone");
  db = now;
});

await step("Drafts: typing then closing immediately (before autosave) is not lost", async () => {
  await page.eval(`__t.click("Add Moment")`);
  await page.waitFor(`document.querySelector(".journal-text-input")`);
  await page.eval(`__t.type(".journal-text-input", "typed then closed at once")`);
  await page.reload(); // well inside the 600 ms autosave delay
  await appReady();
  const drafts = await page.eval(`__t.all("drafts")`);
  assert.ok(drafts.some(d => d.key === "noah:new" && d.text === "typed then closed at once"), JSON.stringify(drafts.map(d => [d.key, d.text])));
  assert.equal(await page.eval(`localStorage.getItem("rootmap-draft-rescue")`), null, "rescue copy cleaned up");
});

await step("18. Mark as Tried still works (stored with uuid id and timestamps)", async () => {
  await nav("Discover");
  await page.eval(`__t.click("Dotting", ".activity-name")`).catch(() => page.eval(`__t.clickSel(".activity-name")`));
  await page.waitFor(`document.body.innerText.includes("Mark as Tried")`);
  await page.eval(`__t.click("Mark as Tried")`);
  await page.waitFor(`document.querySelector(".modal select, .sheet-fields select")`);
  await page.eval(`__t.type(".sheet-fields select", "c-1760000000000")`);
  await page.eval(`__t.type(".sheet-fields textarea", "Tried again 再试一次")`);
  await page.eval(`[...document.querySelectorAll(".sheet-buttons button")].at(-1).click()`);
  await page.waitFor(`document.querySelector(".tried-done")`);
  const now = await dump();
  const added = now.records.filter(r => !db.records.some(x => x.id === r.id));
  assert.equal(added.length, 1);
  assert.equal(added[0].kind, "tried"); assert.equal(added[0].notes, "Tried again 再试一次");
  assert.ok(/^t-[0-9a-f]{8}-/.test(added[0].id) && added[0].createdAt && added[0].origin === "user");
  await page.eval(`__t.click("Done")`);
  db = now;
});

await step("19. Delete a child (soft delete, one write) and restore it (same id, data comes back)", async () => {
  await nav("My Children");
  await page.eval(`__t.click("小明", ".child-select-card")`);
  await page.waitFor(`document.querySelector(".profile-hero")`);
  await page.eval(`document.querySelector(".child-header-actions button:last-child").click()`);
  await page.waitFor(`__t.all("children").then(c => c.find(x => x.id === "c-1760000000000").deletedAt)`);
  assert.ok(page.dialogs.at(-1).includes("Journal entries: 2"), page.dialogs.at(-1));
  const afterDelete = await dump();
  assert.equal(afterDelete.entries.filter(e => e.childId === "c-1760000000000" && !e.deletedAt).length, 2, "entries kept");
  await page.waitFor(`!document.body.innerText.includes("小明")`);
  await nav("Profile");
  await page.eval(`__t.click("Recently Deleted Children")`);
  await page.waitFor(`document.body.innerText.includes("小明") && document.body.innerText.includes("Zoë")`);
  await page.waitFor(`__t.imagesLoaded(".deleted-row img").every(i => i.ok)`, 5000, "deleted child photos");
  await page.eval(`[...document.querySelectorAll(".deleted-row")].find(r => r.innerText.includes("小明")).querySelector("button").click()`);
  await page.waitFor(`document.querySelector(".toast")?.textContent.includes("restored")`);
  const now = await dump();
  const c = now.children.find(x => x.id === "c-1760000000000");
  assert.equal(c.deletedAt, null); assert.equal(c.first, "小明");
  assert.equal(now.children.length, afterDelete.children.length, "no duplicate child record");
  await page.eval(`__t.click("Back", "button")`).catch(() => {});
  db = now;
});

await step("Restore a migrated deleted child (Zoë) and her migrated entry + photo come back", async () => {
  await nav("Profile");
  await page.eval(`__t.click("Recently Deleted Children")`);
  await page.waitFor(`document.body.innerText.includes("Zoë")`);
  await page.eval(`[...document.querySelectorAll(".deleted-row")].find(r => r.innerText.includes("Zoë")).querySelector("button").click()`);
  await page.waitFor(`document.querySelector(".toast")?.textContent.includes("restored")`);
  await nav("Moments");
  await page.waitFor(`document.body.innerText.includes("Zoë's garden")`);
  await page.waitFor(`__t.imagesLoaded(".journal-card-photo img").every(i => i.ok)`, 5000);
});

await step("Other soft deletes: deleting an entry and a goal keeps them stored but hidden", async () => {
  await page.eval(`__t.click("Zoë's garden", ".journal-card")`);
  await page.waitFor(`document.querySelector(".journal-entry")`);
  await page.eval(`document.querySelector('.journal-editor-bar button[aria-label]').click()`);
  await page.waitFor(`document.querySelector(".toast")?.textContent === "Deleted"`);
  const e = (await page.eval(`__t.all("entries")`)).find(x => x.id === "m-1760000000002-zzzzzz");
  assert.ok(e && e.deletedAt && e.photos.length === 1, "entry tombstoned, still identifiable");
  assert.ok(!(await page.eval("__t.text()")).includes("Zoë's garden"));
  await page.reload();
  await appReady();
  await nav("Moments");
  assert.ok(!(await page.eval("__t.text()")).includes("Zoë's garden"), "stays hidden after refresh");
});

await step("My Week / Goals / Saved still read and write", async () => {
  await nav("Profile");
  await page.eval(`__t.click("My Goals")`);
  await page.waitFor(`document.body.innerText.includes("每晚一起读书")`);
  await page.eval(`document.querySelector(".goal-check").click()`);
  await page.waitFor(`__t.all("goals").then(g => g.find(x => x.id === "g-1760000000000").completed)`);
  await page.eval(`__t.click("Back", "button")`).catch(() => {});
  await page.reload(); await appReady();
  await nav("Profile");
  await page.eval(`__t.click("My Week")`);
  await page.waitFor(`document.querySelector(".week-page")`);
  await page.eval(`__t.click("Saved", ".segmented button")`);
  await page.waitFor(`document.querySelectorAll(".week-list .activity-row").length === 3`, 5000, "3 saved activities");
  await page.eval(`__t.click("Weekly Plan", ".segmented button")`).catch(() => {});
});

await step("15. A storage failure while saving shows a clear message and no 'Saved'", async () => {
  await page.reload(); await appReady();
  await nav("Moments");
  await page.eval(`__t.click("Add Moment")`).catch(() => page.eval(`__t.click("Continue writing")`));
  await page.waitFor(`document.querySelector(".journal-text-input")`);
  await page.eval(`__t.type(".journal-text-input", "this save will fail")`);
  await page.eval(`{ const tx = IDBDatabase.prototype.transaction; window.__restoreTx = () => { IDBDatabase.prototype.transaction = tx; }; IDBDatabase.prototype.transaction = function (stores, mode) { if (mode === "readwrite" && [].concat(stores).includes("entries")) throw new DOMException("Simulated full disk", "QuotaExceededError"); return tx.call(this, stores, mode); }; }`);
  const before = (await page.eval(`__t.all("entries")`)).length;
  await page.eval(`document.querySelector(".journal-save").click()`);
  await page.waitFor(`document.querySelector(".journal-status.error[role=alert]")`);
  assert.ok((await page.eval(`document.querySelector(".journal-status.error[role=alert]").textContent`)).includes("isn't enough space"));
  assert.ok(!(await page.eval(`document.querySelector(".toast")?.textContent === "Saved"`)), "no success message");
  assert.equal((await page.eval(`__t.all("entries")`)).length, before, "nothing half-saved");
  assert.ok(await page.eval(`!!document.querySelector(".journal-text-input")`), "still in the editor with the text");
  await page.eval(`window.__restoreTx()`);
  await page.eval(`document.querySelector(".journal-save").click()`);
  await page.waitFor(`document.querySelector(".toast")?.textContent === "Saved"`);
  assert.equal((await page.eval(`__t.all("entries")`)).length, before + 1, "saved once storage works again");
});

await step("15b. A background write failure (goal toggle) is reported with a toast", async () => {
  await nav("Profile");
  await page.eval(`__t.click("My Goals")`);
  await page.waitFor(`document.querySelector(".goal-check")`);
  await page.eval(`{ const tx = IDBDatabase.prototype.transaction; window.__restoreTx = () => { IDBDatabase.prototype.transaction = tx; }; IDBDatabase.prototype.transaction = function (stores, mode) { if (mode === "readwrite") throw new DOMException("Simulated", "UnknownError"); return tx.call(this, stores, mode); }; }`);
  await page.eval(`document.querySelector(".goal-check").click()`);
  await page.waitFor(`document.querySelector(".toast")?.textContent === "Your changes could not be saved on this device."`);
  await page.eval(`window.__restoreTx()`);
});

await step("20. English and Chinese still work (and the choice persists)", async () => {
  await page.reload(); await appReady();
  await nav("Profile");
  await page.eval(`__t.click("Language")`);
  await page.eval(`__t.click("简体中文")`);
  await page.waitFor(`document.documentElement.lang === "zh-CN" && document.body.innerText.includes("语言")`);
  await page.reload(); await appReady();
  assert.ok((await page.eval(`document.querySelector(".bottom-nav").innerText`)).includes("我的孩子们"));
  assert.equal(await page.eval(`document.documentElement.lang`), "zh-CN");
  assert.equal(lsBefore["rootmap-language"], JSON.stringify("en"));
  await nav("个人中心");
  await page.eval(`__t.click("语言")`);
  await page.eval(`__t.click("English")`);
  await page.waitFor(`document.documentElement.lang === "en" && document.body.innerText.includes("Language")`);
});

await step("Dark mode setting persists", async () => {
  await nav("Profile");
  await page.eval(`__t.click("Appearance")`);
  await page.eval(`__t.click("Dark")`);
  await page.waitFor(`document.documentElement.dataset.theme === "dark"`);
  await page.reload(); await appReady();
  assert.equal(await page.eval(`document.documentElement.dataset.theme`), "dark");
  await nav("Profile"); await page.eval(`__t.click("Appearance")`); await page.eval(`__t.click("Light")`);
});

await step("Profile photo upload and child photo upload store photos by id", async () => {
  await nav("Profile");
  await page.eval(`__t.click("Personal Information")`).catch(() => page.eval(`[...document.querySelectorAll(".menu-section button")].find(b => b.innerText.includes("Personal")).click()`));
  await page.waitFor(`document.querySelector(".profile-edit-photo")`);
  await page.setFiles(".info-card input[type=file]", [path.join(IMG, "landscape.png")]);
  await page.waitFor(`document.querySelector(".profile-edit-photo").src.startsWith("blob:")`);
  await page.eval(`document.querySelector(".simple-page > .wide-primary").click()`);
  await page.waitFor(`__t.all("settings").then(s => /^photo-/.test(s.find(x => x.key === "rootmap-profile").value.photo))`);
  const p = (await page.eval(`__t.all("settings")`)).find(x => x.key === "rootmap-profile").value;
  const meta = (await page.eval(`__t.all("photos")`)).find(x => x.id === p.photo);
  assert.ok(meta.width <= 640 && meta.height <= 640, "avatar downscaled as before");
  // Add Child with photo
  await page.reload(); await appReady();
  await page.eval(`document.querySelector(".nav-add").click()`);
  await page.eval(`__t.click("Add Child")`);
  await page.waitFor(`document.querySelector(".child-photo-field input[type=file]")`);
  await page.eval(`__t.type(".sheet-fields input", "Ōtsuka Hana 花")`);
  await page.setFiles(".child-photo-field input[type=file]", [path.join(IMG, "noise.png")]);
  await page.waitFor(`document.querySelector(".child-photo-row-preview")?.complete && document.querySelector(".child-photo-row-preview").naturalWidth > 0`);
  await page.eval(`document.querySelector(".modal-primary").click()`);
  await page.waitFor(`__t.all("children").then(c => c.some(x => x.first === "Ōtsuka"))`);
  const child = (await page.eval(`__t.all("children")`)).find(x => x.first === "Ōtsuka");
  assert.ok(/^c-[0-9a-f]{8}-/.test(child.id) && /^photo-/.test(child.photo) && child.createdAt && child.origin === "user");
});

await step("22. Opening animation preview routes still work", async () => {
  await page.nav(`${BASE}/?opening`);
  await page.waitFor(`document.querySelector(".opening")`, 10000, "opening rendered");
  await page.nav(`${BASE}/?opening=final`);
  await page.waitFor(`document.querySelector(".opening")`, 10000, "opening final rendered");
  await sleep(500);
});

const snapshot = await (async () => { await page.nav(`${BASE}/`); await appReady(); return dump(); })();
await step("11. Restarting the browser keeps everything", async () => {
  await page.close();
  await start();
  await page.nav(`${BASE}/`);
  await appReady();
  const after = await dump();
  for (const s of ["children", "entries", "records", "plans", "goals", "saved", "photos", "photoBlobs", "drafts", "settings"]) assert.deepEqual(after[s], snapshot[s], `${s} after restart`);
  await nav("Moments");
  await page.waitFor(`document.body.innerText.includes("Big photos 大照片")`);
  await page.waitFor(`__t.imagesLoaded(".journal-card-photo img").every(i => i.ok)`, 5000, "photos after restart");
});

await step("Backup export and restore round-trip through IndexedDB (dev utility)", async () => {
  // Export uses the same code path as the Backup page.
  const url = await page.eval(`performance.getEntriesByType("resource").map(e => e.name).find(n => n.includes("/src/lib/data/store.ts"))`);
  const data = await page.eval(`import(${JSON.stringify(url)}).then(async m => { const d = await m.backupData(); return { children: d["rootmap-children"].length, deleted: d["rootmap-deleted-children"].length, entries: d["rootmap-journal"].length, inline: d["rootmap-journal"].every(e => e.photos.every(p => p.startsWith("data:image/"))) }; })`);
  assert.ok(data.inline, "photos inlined as data URLs in the backup file");
  assert.equal(data.entries, snapshot.entries.filter(e => !e.deletedAt).length);
});

await page.close();
const failed = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
