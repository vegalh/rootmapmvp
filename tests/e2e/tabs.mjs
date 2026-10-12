import assert from "node:assert/strict";
import { HELPERS, Page, launch, sleep } from "./cdp.mjs";
import { FIXTURE } from "./fixture.mjs";
import { BASE as DEV, tempProfile } from "./env.mjs";

// Two tabs opening RootMap for the first time at the same moment must produce one consistent migration.
let ok = true;
for (let round = 1; round <= 3; round++) {
  const a = await launch(tempProfile("tabs"), 9337);
  await a.send("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
  await a.nav(`${DEV}/package.json`);
  await a.eval("__t.deleteDb()");
  await a.eval(FIXTURE);
  const t = await (await fetch("http://127.0.0.1:9337/json/new?about:blank", { method: "PUT" })).json();
  const b = await Page.connect(t.webSocketDebuggerUrl);
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
  // Both tabs start the app at the same moment on a device that has never migrated.
  await Promise.all([a.nav(`${DEV}/`), b.nav(`${DEV}/`)]);
  for (const p of [a, b]) await p.waitFor(`document.querySelector(".app-shell")`, 20000);
  await sleep(500);
  try {
    const dump = await a.eval("__t.dump()");
    assert.equal(dump.photoBlobs.length, 7, "one set of photos");
    const blobIds = new Set(dump.photoBlobs.map(p => p.id));
    for (const e of dump.entries) for (const ref of e.photos) assert.ok(blobIds.has(ref), `entry ${e.id} photo resolves`);
    for (const p of [a, b]) {
      assert.ok(await p.eval(`__t.imagesLoaded(".child-select-photo img").every(i => i.ok)`), "both tabs show photos");
      assert.ok((await p.eval("__t.text()")).includes("小明"));
      assert.deepEqual(p.errors, []);
    }
    console.log(`PASS  two tabs on first start, round ${round}: one migration, all photo references resolve in both tabs`);
  } catch (e) {
    ok = false;
    console.log(`FAIL  round ${round}: ${e.message}`);
  }
  await a.close();
}
process.exit(ok ? 0 : 1);
