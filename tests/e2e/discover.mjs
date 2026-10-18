import assert from "node:assert/strict";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { BASE, tempProfile, openDemoEraDevice } from "./env.mjs";

// Discover > Activities | Books (music activities are listed in Activities), the book Wishlist, and music activities
// in the My Week workflow.
// Checks are written against whatever books and music the data files hold, so they keep passing as the sample
// entries are replaced with real ones.

const page = await launch(tempProfile("discover"), 9343);
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
// Ready on whatever page the URL names (a refresh stays on the current page).
const appReady = () => page.waitFor(`document.querySelector(".app-shell") && document.querySelector(".bottom-nav, main")`, 15000, "app rendered");
// Bottom navigation only exists on top-level pages; elsewhere a fresh visit to the app address opens Today first.
const nav = async index => {
  if (!(await page.eval(`!!document.querySelector(".bottom-nav")`))) { await page.home(); await appReady(); }
  await page.eval(`__t.clickSel(".bottom-nav button", ${index})`); await sleep(200);
};
const NAV = { today: 0, discover: 1, kids: 3, profile: 4 };
const tab = async label => { await page.eval(`__t.click(${q(label)}, ".discover-tabs button")`); await sleep(150); };
const activeTab = () => page.eval(`document.querySelector(".discover-tabs button.active")?.textContent.trim()`);
const count = sel => page.eval(`document.querySelectorAll(${q(sel)}).length`);
const search = async text => { await page.eval(`__t.type(".discover-search input", ${q(text)})`); await sleep(150); };
const pickAge = async option => {
  await page.eval(`__t.clickSel(".filter-row .filter-pill")`);
  await page.waitFor(`document.querySelector(".filter-popover")`, 3000, "age options open");
  await page.eval(`__t.click(${q(option)}, ".filter-popover-option")`);
  await sleep(150);
};
// The age options the open tab offers: only ages that have something to show, never an empty filter.
const offeredAges = async () => {
  await page.eval(`__t.clickSel(".filter-row .filter-pill")`);
  await page.waitFor(`document.querySelector(".filter-popover")`, 3000, "age options open");
  const ages = await page.eval(`[...document.querySelectorAll(".filter-popover-option")].map(b => b.textContent.trim()).filter(x => x !== "All Ages")`);
  await page.eval(`__t.clickSel(".filter-row .filter-pill")`); await sleep(100);
  for (const a of ages) assert.ok(AGES.includes(a), a);
  return ages;
};
// Activities filters by label ("Setting", "Age", "Category", "Materials"): open the pill and choose an option.
const pills = () => page.eval(`[...document.querySelectorAll(".filter-row .filter-pill")].map(b => b.textContent.trim())`);
const pickFilter = async (label, option) => {
  await page.eval(`[...document.querySelectorAll(".filter-row .filter-pill")].find(b => b.textContent.trim().startsWith(${q(label + ":")})).click()`);
  await page.waitFor(`document.querySelector(".filter-popover")`, 3000, `${label} options open`);
  await page.eval(`__t.click(${q(option)}, ".filter-popover-option")`);
  await sleep(150);
};
const setting = async key => (await page.eval(`__t.all("settings")`)).find(s => s.key === key)?.value;
const live = async store => (await page.eval(`__t.all(${q(store)})`)).filter(r => !r.deletedAt);
const noOverflow = async label => {
  const w = await page.eval(`document.documentElement.scrollWidth`);
  assert.ok(w <= 390, `${label}: page is ${w}px wide at 390px`);
};
const AGES = ["0–2", "2–3", "3–4", "4–6", "6+"];

await openDemoEraDevice(page, `${BASE}/`);
await appReady();
await page.waitFor(`__t.dbExists()`, 10000, "data stored");
const plansBefore = await live("plans");
const savedBefore = await live("saved");

await step("Discover shows Activities | Books, with Activities first and selected", async () => {
  await nav(NAV.discover);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll(".discover-tabs button")].map(b => b.textContent.trim())`), ["Activities", "Books"]);
  assert.equal(await activeTab(), "Activities");
  assert.equal(await page.eval(`document.querySelectorAll(".bottom-nav button").length`), 5, "bottom navigation unchanged");
  assert.ok((await count(".activity-card")) > 0);
  assert.deepEqual(await pills(), ["Setting: All Settings", "Age: All Ages", "Category: All", "Materials: All"]);
  assert.ok((await count(".music-card")) > 0, "music is listed with the activities");
  await noOverflow("Activities");
});

await step("Activities still search, save, open and come back to the Activities tab", async () => {
  const total = await count(".activity-card");
  await search("mopping");
  assert.equal(await count(".activity-card"), 1);
  await search("");
  assert.equal(await count(".activity-card"), total);
  await page.eval(`__t.clickSel(".activity-card .activity-name")`);
  await page.waitFor(`document.querySelector(".detail-page .material-list")`, 3000, "activity detail");
  await page.eval(`__t.clickSel(".detail-actions button")`);
  await page.waitFor(`document.querySelector(".discover-tabs")`, 3000, "back on Discover");
  assert.equal(await activeTab(), "Activities");
});

let bookTitle, bookCount;
await step("Books: search by title and author, and filter by age (a book may be in several ranges)", async () => {
  await tab("Books");
  assert.equal(await activeTab(), "Books");
  bookCount = await count(".book-tile");
  assert.ok(bookCount > 0, "the collection has books");
  bookTitle = await page.eval(`document.querySelector(".book-tile strong").textContent`);
  const author = await page.eval(`document.querySelector(".book-tile small").textContent`);
  await search(bookTitle.toUpperCase());
  assert.ok(await page.eval(`[...document.querySelectorAll(".book-tile strong")].some(s => s.textContent === ${q(bookTitle)})`), "title search");
  await search(author);
  assert.ok((await count(".book-tile")) >= 1, "author search");
  await search("zzz-no-such-book");
  assert.equal(await count(".book-tile"), 0);
  assert.ok(await page.eval(`!!document.querySelector(".empty")`), "empty result message");
  await search("");
  let inRanges = 0;
  for (const age of await offeredAges()) {
    await pickAge(age);
    const n = await count(".book-tile");
    assert.ok(n > 0, `${age} is offered only when it has books`);
    assert.ok(n <= bookCount, `${age}: ${n} of ${bookCount}`);
    assert.ok(await page.eval(`document.querySelector(".filter-row .filter-pill").textContent.includes(${q(age)})`));
    inRanges += n;
  }
  assert.ok(inRanges >= bookCount, "every book is in at least one age range");
  await page.eval(`__t.click("Reset", ".reset-link")`); await sleep(150);
  assert.equal(await count(".book-tile"), bookCount);
  await noOverflow("Books");
});

await step("Book details: cover, title, author, ages, description, why we recommend it, Add to Wishlist", async () => {
  await page.eval(`__t.clickSel(".book-tile")`);
  await page.waitFor(`document.querySelector(".book-detail")`, 3000, "book detail");
  assert.equal(await page.eval(`document.querySelector(".book-detail h1").textContent`), bookTitle);
  for (const sel of [".book-detail-cover .book-cover", ".book-author", ".book-ages", ".description", ".book-why"]) {
    assert.ok(await page.eval(`!!document.querySelector(${q(sel)})?.textContent.trim() || !!document.querySelector(${q(sel)} + " img")`), sel);
  }
  assert.ok(await page.eval(`document.body.innerText.includes("Why We Recommend It")`));
  assert.equal(await page.eval(`document.querySelector(".sticky-action button").textContent.trim()`), "Add to Wishlist");
  await noOverflow("Book details");
});

const shelf = async () => (await setting("rootmap-bookshelf")) ?? [];
const shelfButton = () => page.eval(`document.querySelector(".sticky-action button").textContent.trim()`);
const toggleWishlist = async () => { await page.eval(`__t.clickSel(".sticky-action button")`); await sleep(200); };

let bookId;
await step("One tap saves a book to the Wishlist, another removes it; no shelf to choose, no duplicates", async () => {
  await toggleWishlist();
  assert.ok(!(await page.eval(`!!document.querySelector(".overlay")`)), "no shelf sheet");
  await page.waitFor(`document.querySelector(".toast")?.textContent === "Added to Wishlist"`, 3000, "toast");
  await page.waitFor(`__t.all("settings").then(s => s.find(x => x.key === "rootmap-bookshelf")?.value?.length === 1)`, 3000, "stored");
  let items = await shelf();
  assert.equal(items[0].shelf, "wishlist");
  bookId = items[0].bookId;
  assert.equal(await shelfButton(), "On Wishlist");
  assert.equal(await page.eval(`document.querySelector(".sticky-action button").getAttribute("aria-pressed")`), "true");

  await toggleWishlist();
  await page.waitFor(`document.querySelector(".toast")?.textContent === "Removed from Wishlist"`, 3000, "removed toast");
  await sleep(200);
  assert.deepEqual(await shelf(), []);
  assert.equal(await shelfButton(), "Add to Wishlist");

  // Two books on the Wishlist.
  await toggleWishlist();
  await page.eval(`__t.clickSel(".detail-actions button")`);
  await page.waitFor(`document.querySelector(".book-tile")`, 3000, "back on Books");
  assert.equal(await activeTab(), "Books", "back returns to the Books tab");
  if (bookCount > 1) {
    await page.eval(`__t.clickSel(".book-tile", 1)`);
    await page.waitFor(`document.querySelector(".book-detail")`, 3000, "second book");
    await toggleWishlist();
  }
  const final = await shelf();
  assert.equal(new Set(final.map(i => i.bookId)).size, final.length, "each book once");
  assert.ok(final.every(i => i.shelf === "wishlist"));
});

await step("Wishlist (Profile) persists after a refresh; books saved earlier to My Books are on it too", async () => {
  // A book saved under the former "My Books" shelf (stored shelf "owned") stays stored as it is and is listed.
  const ids = await page.eval(`import("/src/data/books.ts").then(m => m.books.map(b => b.id))`);
  const current = await shelf();
  const legacy = ids.find(id => !current.some(i => i.bookId === id));
  assert.ok(legacy, "a book not saved yet");
  await page.eval(`import("/src/lib/data/hooks.ts").then(m => m.saveSetting("rootmap-bookshelf", [...${q(current)}, { bookId: ${q(legacy)}, shelf: "owned", addedAt: "2026-01-01T00:00:00.000Z" }]))`);
  await page.reload();
  await appReady();
  await nav(NAV.profile);
  const row = await page.eval(`[...document.querySelectorAll(".menu-section button")].find(b => b.textContent.includes("Wishlist"))?.textContent`);
  assert.ok(row, "Profile has Wishlist");
  assert.ok(!(await page.eval(`document.body.innerText.includes("Family Bookshelf")`)));
  const expected = (await shelf()).length;
  assert.ok(row.includes(String(expected)), `count ${expected} shown: ${row}`);
  await page.eval(`__t.click("Wishlist", ".menu-section button")`);
  await page.waitFor(`document.querySelector(".bookshelf-page")`, 3000, "wishlist page");
  assert.ok(!(await page.eval(`!!document.querySelector(".bookshelf-page .segmented")`)), "one list, no tabs");
  assert.equal(await count(".bookshelf-page .book-tile"), expected, "every saved book, including the earlier My Books one");
  assert.ok((await shelf()).some(i => i.bookId === legacy && i.shelf === "owned"), "stored value unchanged");
  await noOverflow("Wishlist");

  // Opening a book from the Wishlist, removing it, and coming back lands on the Wishlist.
  for (let i = 0; i < expected; i++) {
    await page.eval(`__t.clickSel(".bookshelf-page .book-tile")`);
    await page.waitFor(`document.querySelector(".book-detail")`, 3000, "book from wishlist");
    assert.equal(await shelfButton(), "On Wishlist");
    await toggleWishlist();
    await page.eval(`__t.clickSel(".detail-actions button")`);
    await page.waitFor(`document.querySelector(".bookshelf-page")`, 3000, "back on the wishlist");
  }
  assert.ok(await page.eval(`!!document.querySelector(".shelf-empty")`), "empty wishlist invites exploring");
  await page.eval(`__t.click("Explore Books", ".shelf-empty button")`);
  await page.waitFor(`document.querySelector(".discover-tabs")`, 3000, "Discover");
  assert.equal(await activeTab(), "Books");
});

let musicTitle, musicId;
await step("Music in Activities: search, Category, and Setting + Age + Category + Materials together", async () => {
  await tab("Activities");
  const all = await count(".activity-card");
  const total = await count(".music-card");
  assert.ok(total > 0 && all > total);
  musicTitle = await page.eval(`document.querySelector(".music-card .activity-name").textContent`);
  await search(musicTitle.slice(0, 5).toLowerCase());
  assert.ok(await page.eval(`[...document.querySelectorAll(".music-card .activity-name")].some(s => s.textContent === ${q(musicTitle)})`));
  await search("zzz-no-such-song");
  assert.equal(await count(".activity-card"), 0);
  assert.ok(await page.eval(`!!document.querySelector(".empty .reset-link")`), "empty state offers Clear filters");
  await search("");
  await pickFilter("Category", "Art & Creativity");
  assert.equal(await count(".music-card"), total, "every music activity is in Art & Creativity");
  assert.ok((await count(".activity-card")) > total, "with the art activities");
  assert.ok(await page.eval(`[...document.querySelectorAll(".activity-card p")].every(p => p.textContent.includes("Art & Creativity"))`));
  await pickFilter("Setting", "Park");
  await pickFilter("Materials", "Nothing Needed");
  const n = await count(".activity-card");
  assert.ok(n > 0 && n === (await count(".music-card")) && n < total, "park + art + nothing needed: the music a parent can sing or call out");
  await pickFilter("Age", "0–2");
  assert.ok((await count(".music-card")) > 0 && (await count(".music-card")) < n, "age narrows it further");
  await page.eval(`__t.click("Reset", ".reset-link")`); await sleep(150);
  assert.equal(await count(".activity-card"), all);
  assert.deepEqual(await pills(), ["Setting: All Settings", "Age: All Ages", "Category: All", "Materials: All"]);
  for (const sel of [".music-card img", ".music-card .music-play", ".music-card .heart", ".music-card p", ".music-card small"]) assert.ok((await count(sel)) >= total, sel);
  await noOverflow("Activities with music");
});

await step("An old Music tab link opens Activities", async () => {
  await page.eval(`location.hash = "#/discover/music"`); await sleep(300);
  assert.equal(await activeTab(), "Activities");
  assert.ok((await count(".music-card")) > 0);
});

await step("Music details: missing audio shows 'coming soon' instead of a broken player", async () => {
  await page.eval(`__t.clickSel(".music-card .activity-image")`);
  await page.waitFor(`document.querySelector(".music-detail")`, 3000, "music detail");
  assert.equal(await page.eval(`document.querySelector(".music-detail h1").textContent`), musicTitle);
  for (const text of ["How to Play", "What Children Explore", "Mark as Tried", "Add to My Week"]) {
    assert.ok(await page.eval(`document.body.innerText.includes(${q(text)})`), text);
  }
  assert.ok(await page.eval(`document.querySelectorAll(".music-detail ol li").length > 0`));
  assert.ok(await page.eval(`document.querySelectorAll(".explore-tags span").length > 0`));
  // Sample music has no recordings yet; an activity with a recording shows the player instead.
  const hasAudio = await page.eval(`!!document.querySelector(".music-detail audio")`);
  if (!hasAudio) {
    assert.ok(await page.eval(`document.querySelector(".audio-player.unavailable")?.textContent.includes("Recording coming soon")`));
  } else {
    assert.ok(await page.eval(`!!document.querySelector(".audio-toggle") && document.querySelector(".music-detail audio").autoplay === false`));
  }
  await noOverflow("Music details");
});

await step("Music: save, Add to My Week, Mark as Tried, all through the existing records", async () => {
  await page.eval(`__t.clickSel(".detail-actions div button")`);
  await page.waitFor(`__t.all("saved").then(s => s.some(x => !x.deletedAt && x.id.startsWith("music-")))`, 3000, "saved");
  musicId = (await live("saved")).find(x => x.id.startsWith("music-")).id;

  await page.eval(`__t.click("Mark as Tried", ".sticky-action button")`);
  await page.waitFor(`document.querySelector(".overlay select")`, 3000, "tried sheet");
  await page.eval(`__t.type(".overlay select", "emma")`);
  await page.eval(`__t.click("Save", ".overlay .sheet-buttons button")`);
  await page.waitFor(`document.querySelector(".tried-done")`, 3000, "tried saved");
  const tried = (await live("records")).filter(r => r.kind === "tried" && r.activityId === musicId);
  assert.equal(tried.length, 1);
  assert.equal(tried[0].childId, "emma");
  await page.eval(`__t.click("Done", ".overlay button")`);
  await page.waitFor(`!document.querySelector(".overlay")`, 3000, "closed");

  await page.eval(`__t.click("Add to My Week", ".sticky-action button")`);
  await page.waitFor(`document.querySelector(".overlay .plan-activity")`, 3000, "plan sheet");
  assert.equal(await page.eval(`document.querySelector(".overlay .plan-activity strong").textContent`), musicTitle);
  // Two children: none is assumed, so the plan can't be added until one is chosen.
  assert.ok(await page.eval(`document.querySelector(".overlay .modal-primary").disabled`), "no child chosen yet");
  await page.eval(`__t.click("Maya", ".overlay .child-checks button")`);
  await page.waitFor(`!document.querySelector(".overlay .modal-primary").disabled`, 3000, "Maya chosen");
  await page.eval(`__t.clickSel(".overlay .modal-primary")`);
  await page.waitFor(`document.querySelector(".week-page")`, 3000, "My Week");
  const plans = (await live("plans")).filter(p => p.activityId === musicId);
  assert.equal(plans.length, 1);
});

await step("My Week shows the music activity in Weekly Plan, Completed and Saved; repeating works", async () => {
  assert.ok(await page.eval(`document.querySelector(".week-list").innerText.includes(${q(musicTitle)})`), "in the weekly plan");
  const row = `[...document.querySelectorAll(".day-plan")].find(d => d.innerText.includes(${q(musicTitle)}))`;
  const triedBefore = (await live("records")).filter(r => r.activityId === musicId).length;
  await page.eval(`${row}.querySelector(".plan-actions button").click()`); await sleep(200);
  const plan = (await live("plans")).find(p => p.activityId === musicId);
  assert.equal(plan.completed, true);
  // Completing the plan adds it to Maya's activity history, once.
  const done = (await live("records")).filter(r => r.activityId === musicId && r.planId === plan.id);
  assert.equal(done.length, 1, "one record for the completed plan");
  assert.equal(done[0].childId, "emma");
  assert.equal((await live("records")).filter(r => r.activityId === musicId).length, triedBefore + 1);
  await page.eval(`__t.click("Completed", ".segmented button")`); await sleep(150);
  assert.ok(await page.eval(`document.querySelector(".week-list").innerText.includes(${q(musicTitle)})`), "in completed");
  await page.eval(`[...document.querySelectorAll(".week-list .activity-row")].find(r => r.innerText.includes(${q(musicTitle)})).querySelector("button").click()`);
  await sleep(200);
  assert.equal((await live("plans")).filter(p => p.activityId === musicId).length, 2, "repeated");
  await page.eval(`__t.click("Saved", ".segmented button")`); await sleep(150);
  assert.ok(await page.eval(`document.querySelector(".week-list").innerText.includes(${q(musicTitle)})`), "in saved");
  await page.eval(`[...document.querySelectorAll(".week-list .activity-row")].find(r => r.innerText.includes(${q(musicTitle)})).querySelector("button").click()`);
  await page.waitFor(`document.querySelector(".music-detail")`, 3000, "opens the music page");
  await page.eval(`__t.clickSel(".detail-actions button")`);
  await page.waitFor(`document.querySelector(".week-page")`, 3000, "back to My Week");
});

await step("Existing plans and saved activities are unchanged; Saved Activities and the child's history include music", async () => {
  const plansNow = await live("plans");
  for (const p of plansBefore) assert.deepEqual(plansNow.find(x => x.id === p.id), p, `plan ${p.id} untouched`);
  const savedNow = (await live("saved")).map(s => s.id);
  for (const s of savedBefore) assert.ok(savedNow.includes(s.id), `saved ${s.id} kept`);
  await page.eval(`__t.clickSel(".page-header .icon-button")`);
  await page.waitFor(`document.querySelector(".profile-page")`, 3000, "Profile");
  await page.eval(`__t.click("Saved Activities", ".menu-section button")`);
  await page.waitFor(`document.querySelector(".simple-page .week-list")`, 3000, "Saved Activities");
  assert.ok(await page.eval(`document.querySelector(".week-list").innerText.includes(${q(musicTitle)})`));
  await page.eval(`__t.clickSel(".page-header .icon-button")`);
  await page.waitFor(`document.querySelector(".profile-page")`, 3000, "Profile");
  await nav(NAV.kids);
  await page.eval(`[...document.querySelectorAll(".child-select-card")].find(c => c.innerText.includes("Maya")).click()`);
  await page.waitFor(`document.querySelector(".tabs")`, 3000, "child page");
  await page.eval(`__t.click("Activities", ".tabs button")`); await sleep(150);
  assert.ok(await page.eval(`document.body.innerText.includes(${q(musicTitle)})`), "tried music in the child's activities");
  await page.eval(`__t.clickSel(".child-header > button")`);
  await page.waitFor(`document.querySelector(".bottom-nav")`, 3000, "back on Kids");
});

const BOOKS_EN = ["Guess How Much I Love You", "The Carrot Seed", "A Pocketful of Kisses", "Something from Nothing", "The Runaway Bunny", "The Giving Tree", "Charlie Needs a Cloak", "A Squash and a Squeeze", "The Smartest Giant in Town", "Lazy Ozzie", "The Reason for Being Late", "Badger's Parting Gifts", "The Cat That Lived a Million Times", "The Little Mouse Series", "Where Does Thursday Go?", "Happy Birthday, Moon", "Little Bear's Special Wish", "The Crocodile and the Dentist", "The Color Monster", "Dotty and Scaly", "Just Like My Mum", "Just Like My Dad", "A Child of Books", "Delicious!", "Little Polar Bear and the Brave Little Hare", "Lots: The Diversity of Life on Earth", "Tiny Creatures: The World of Microbes", "Musical Max", "Guess How Much I Love You: Counting", "Guess How Much I Love You: Colors", "Little Bear and the Best Dad", "The Storm Seal", "The Snowman", "Mole and the Baby Bird", "The Tanya Books"];
const BOOKS_ZH = ["猜猜我有多爱你", "胡萝卜种子", "一口袋的吻", "爷爷一定有办法", "逃家小兔", "爱心树", "阿利的红斗篷", "小房子变大房子", "城里最漂亮的巨人", "懒奥西", "迟到的理由", "獾的礼物", "活了一百万次的猫", "可爱的鼠小弟", "“星期四”要去哪里呢？", "月亮生日快乐", "小熊的特别愿望", "鳄鱼怕怕牙医怕怕", "我的情绪小怪兽", "花点点和鳞片片", "像妈妈一样", "像爸爸一样", "书之子", "最好喝的汤", "小北极熊和勇敢的小野兔", "数不清！大自然的生物多样性", "微生物：看不见的魔术师", "爱音乐的马可", "猜猜我有多爱你（数一数）", "猜猜我有多爱你（颜色）", "小熊和最好的爸爸", "暴风雨后的小海豹", "雪人", "鼹鼠与小鸟", "爱跳舞的孩子"];
const setLanguage = async (from, to, check) => {
  await nav(NAV.profile);
  await page.eval(`__t.click(${q(from)}, ".menu-section button")`);
  await page.eval(`__t.click(${q(to)})`);
  await page.waitFor(check, 3000, to);
  await page.eval(`__t.clickSel(".page-header .icon-button")`); await sleep(150);
};
// Each cover shows the current language's edition: its image, or a placeholder with the title in that language.
const covers = sel => page.eval(`[...document.querySelectorAll(${q(sel)})].map(t => ({ title: t.querySelector(":scope > strong").textContent, cover: t.querySelector(".book-cover strong")?.textContent ?? null, img: t.querySelector(".book-cover img")?.getAttribute("src") ?? null, broken: [...t.querySelectorAll("img")].some(i => i.complete && !i.naturalWidth), badge: t.querySelector(".book-cover em")?.textContent ?? null }))`);
const checkCovers = (list, titles, badge) => {
  for (const c of list) {
    assert.ok(titles.includes(c.title), `${c.title} in this language`);
    assert.ok(!c.broken, `${c.title}: no broken image`);
    if (!c.img) {
      assert.equal(c.cover, c.title, `${c.title}: placeholder in the same language`);
      assert.equal(c.badge, badge, `${c.title}: marked as a placeholder`);
    }
  }
};

await step("Books: the curated books, covers and titles follow the language without a refresh; the bookshelf never doubles", async () => {
  await nav(NAV.discover);
  await tab("Books");
  const en = await covers(".book-grid .book-tile");
  assert.deepEqual(en.map(c => c.title), BOOKS_EN);
  checkCovers(en, BOOKS_EN, "Cover coming soon");
  const enImg = title => en.find(c => c.title === title).img;
  assert.match(enImg("The Giving Tree") ?? "", /the-giving-tree-en\.jpg/, "English edition cover");
  assert.equal(enImg("Lazy Ozzie"), null, "no English cover yet: placeholder, not the Chinese one");
  assert.ok(en.every(c => !c.img || /-en\.jpg/.test(c.img)), "only English covers in English");
  const stored = await shelf();
  await setLanguage("Language", "简体中文", `document.documentElement.lang === "zh-CN"`);
  await nav(NAV.discover);
  await tab("绘本");
  const zh = await covers(".book-grid .book-tile");
  assert.deepEqual(zh.map(c => c.title), BOOKS_ZH);
  checkCovers(zh, BOOKS_ZH, "封面即将上线");
  const zhImg = title => zh.find(c => c.title === title).img;
  assert.match(zhImg("爱心树") ?? "", /the-giving-tree-zh\.jpg/, "Chinese edition cover");
  assert.match(zhImg("懒奥西") ?? "", /lazy-ozzie-zh\.jpg/);
  assert.ok(zh.every(c => !c.img || /-zh\.jpg/.test(c.img)), "only Chinese covers in Chinese");
  for (const [text, expect] of [["胡萝卜", ["胡萝卜种子"]], ["Carrot", ["胡萝卜种子"]], ["Krauss", ["胡萝卜种子"]], ["唐纳森", ["小房子变大房子", "城里最漂亮的巨人"]]]) {
    await search(text);
    assert.deepEqual((await covers(".book-grid .book-tile")).map(c => c.title), expect, `search ${text}`);
  }
  await search("");
  await page.eval(`__t.click("胡萝卜种子", ".book-tile")`);
  await page.waitFor(`document.querySelector(".book-detail")`, 3000, "book");
  assert.equal(await page.eval(`document.querySelector(".book-detail h1").textContent`), "胡萝卜种子");
  assert.equal(await page.eval(`document.querySelector(".book-detail-cover .book-cover strong")?.textContent`), "胡萝卜种子", "Chinese cover placeholder");
  assert.ok(await page.eval(`document.querySelector(".book-detail .description").textContent.startsWith("一个小男孩")`));
  assert.ok(await page.eval(`document.querySelector(".book-ages").textContent.includes("2–5岁")`));
  await page.eval(`__t.clickSel(".detail-actions button")`); await sleep(200);
  // The Wishlist in Chinese: the same entries, shown as the Chinese editions.
  await nav(NAV.profile);
  await page.eval(`__t.click("心愿书单", ".menu-section button")`);
  await page.waitFor(`document.querySelector(".bookshelf-page")`, 3000, "wishlist");
  assert.ok(await page.eval(`document.querySelector(".bookshelf-page h1").textContent === "心愿书单"`));
  const list = await covers(".bookshelf-page .book-tile");
  assert.equal(list.length, stored.length, "same entries");
  checkCovers(list, BOOKS_ZH, "封面即将上线");
  assert.deepEqual(await shelf(), stored, "switching language changes nothing stored");
  await noOverflow("Wishlist (zh)");
  await page.eval(`__t.clickSel(".page-header .icon-button")`); await sleep(150);
  await setLanguage("语言", "English", `document.documentElement.lang === "en"`);
  await nav(NAV.profile);
  await page.eval(`__t.click("Wishlist", ".menu-section button")`);
  await page.waitFor(`document.querySelector(".bookshelf-page")`, 3000, "bookshelf");
  checkCovers(await covers(".bookshelf-page .book-tile"), BOOKS_EN, "Cover coming soon");
  assert.deepEqual(await shelf(), stored);
  await page.eval(`__t.clickSel(".page-header .icon-button")`); await sleep(150);
});

await step("Chinese: tabs, Books search in Chinese, Music labels; then back to English", async () => {
  await nav(NAV.profile);
  await page.eval(`__t.click("Language", ".menu-section button")`);
  await page.eval(`__t.click("简体中文")`);
  await page.waitFor(`document.documentElement.lang === "zh-CN"`, 3000, "Chinese");
  await page.eval(`__t.clickSel(".page-header .icon-button")`); await sleep(150);
  assert.ok(await page.eval(`document.body.innerText.includes("心愿书单")`), "Profile row");
  await nav(NAV.discover);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll(".discover-tabs button")].map(b => b.textContent.trim())`), ["活动", "绘本"]);
  await tab("活动");
  assert.deepEqual(await pills(), ["场景: 全部场景", "年龄: 所有年龄", "类别: 全部", "所需材料: 全部"]);
  await tab("绘本");
  const zhTitle = await page.eval(`document.querySelector(".book-tile strong").textContent`);
  await search(zhTitle);
  assert.ok((await count(".book-tile")) >= 1, "Chinese title search");
  await search("");
  await page.eval(`__t.clickSel(".book-tile")`);
  await page.waitFor(`document.querySelector(".book-detail")`, 3000, "book");
  assert.ok(await page.eval(`document.body.innerText.includes("推荐理由") && document.body.innerText.includes("加入心愿书单")`));
  await page.eval(`__t.clickSel(".detail-actions button")`); await sleep(200);
  await tab("活动");
  await search("你唱我学");
  assert.ok(await page.eval(`[...document.querySelectorAll(".music-card p")].some(p => p.textContent.includes("艺术与创造"))`), "Chinese music search and category");
  await page.eval(`__t.clickSel(".music-card .activity-image")`);
  await page.waitFor(`document.querySelector(".music-detail")`, 3000, "music");
  for (const text of ["玩法介绍", "孩子在探索什么", "标记已尝试"]) assert.ok(await page.eval(`document.body.innerText.includes(${q(text)})`), text);
  await page.eval(`__t.clickSel(".detail-actions button")`); await sleep(200);
  await nav(NAV.profile);
  await page.eval(`__t.click("语言", ".menu-section button")`);
  await page.eval(`__t.click("English")`);
  await page.waitFor(`document.documentElement.lang === "en"`, 3000, "English");
  await page.eval(`__t.clickSel(".page-header .icon-button")`); await sleep(150);
});

await step("Dark mode: the new screens use the dark theme and fit 390px", async () => {
  await page.eval(`__t.click("Appearance", ".menu-section button")`);
  await page.eval(`__t.click("Dark")`);
  await page.waitFor(`document.documentElement.dataset.theme === "dark"`, 3000, "dark");
  await page.eval(`__t.clickSel(".page-header .icon-button")`); await sleep(150);
  await nav(NAV.discover);
  const bg = sel => page.eval(`getComputedStyle(document.querySelector(${q(sel)})).backgroundColor`);
  for (const t of ["Books", "Activities"]) {
    await tab(t);
    await noOverflow(t);
  }
  assert.equal(await bg(".music-card"), "rgb(30, 38, 32)", "cards use the dark card colour");
  await page.eval(`__t.clickSel(".music-card .activity-image")`);
  await page.waitFor(`document.querySelector(".music-detail")`, 3000, "music");
  assert.equal(await bg(".music-detail"), "rgb(20, 26, 22)", "page uses the dark background");
  await noOverflow("Music details (dark)");
  await page.eval(`__t.clickSel(".detail-actions button")`); await sleep(200);
  await nav(NAV.profile);
  await page.eval(`__t.click("Appearance", ".menu-section button")`);
  await page.eval(`__t.click("Light")`);
  await page.waitFor(`document.documentElement.dataset.theme === "light"`, 3000, "light");
});

await step("Every screen shows an activity's current category, in English and Chinese", async () => {
  // Matching Color Caps: learning area Practical Life (shown as "Everyday Life" before), category Sensory & Movement.
  const LABELS = { en: ["Practical Life", "Language", "Math", "Art & Creativity", "Nature & Culture", "Sensory & Movement"], zh: ["日常生活", "语言", "数学", "艺术与创造", "自然与文化", "感官与运动"] };
  const check = async (lang, expected, old) => {
    await page.eval(`location.hash = "#/activity/matching-color-caps"`);
    await page.waitFor(`document.querySelector(".detail-page .meta")`, 3000, "activity detail");
    const meta = await page.eval(`document.querySelector(".detail-page .meta").textContent`);
    assert.ok(meta.includes(expected) && !meta.includes(old), `${lang} detail: ${meta}`);
    await page.eval(`[...document.querySelectorAll(".sticky-action button")].find(b => b.textContent.includes(${q(lang === "zh" ? "标记已尝试" : "Mark as Tried")})).click()`);
    await page.waitFor(`document.querySelector(".overlay .plan-activity small")`, 3000, "Mark as Tried sheet");
    assert.equal(await page.eval(`document.querySelector(".overlay .plan-activity small").textContent`), expected, `${lang} Mark as Tried`);
    await page.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`); await sleep(400);
    await page.eval(`location.hash = "#/today"`);
    await page.waitFor(`document.querySelector(".today-feature-caption small")`, 3000, "Today");
    const today = await page.eval(`document.querySelector(".today-feature-caption small").textContent`);
    assert.ok(LABELS[lang].includes(today), `${lang} Today: ${today}`);
    await page.eval(`location.hash = "#/my-week"`);
    await page.waitFor(`document.querySelector(".week-page")`, 3000, "My Week");
    await page.eval(`__t.click(${q(lang === "zh" ? "已收藏" : "Saved")}, ".segmented button")`); await sleep(150);
    const rows = await page.eval(`[...document.querySelectorAll(".week-list .activity-row small")].map(s => s.textContent)`);
    assert.ok(rows.length > 0 && rows.every(r => LABELS[lang].includes(r.split(" · ").pop())), `${lang} My Week: ${JSON.stringify(rows)}`);
  };
  const setLang = async (label, code) => {
    await page.eval(`location.hash = "#/language"`); await sleep(300);
    await page.eval(`__t.click(${q(label)})`);
    await page.waitFor(`document.documentElement.lang === ${q(code)}`, 3000, code);
  };
  await check("en", "Sensory & Movement", "Everyday Life");
  await setLang("简体中文", "zh-CN");
  await check("zh", "感官与运动", "日常生活");
  await setLang("English", "en");
});

await page.close();
const failed = results.filter(r => r[0] === "FAIL");
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
