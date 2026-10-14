// Settings shared by the browser suites; run.mjs fills them in through environment variables.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The running app (run.mjs starts a dev server unless RM_BASE points at one).
export const BASE = process.env.RM_BASE || "http://localhost:8443";
// Large generated test photos (see run.mjs).
export const IMG = process.env.RM_IMG_DIR || path.join(os.tmpdir(), "rootmap-test-images");
// A fresh, empty browser profile, so every run starts like a new device.
export const tempProfile = name => fs.mkdtempSync(path.join(os.tmpdir(), `rootmap-${name}-`));

// Opens `url` as a device that used RootMap before new families stopped getting demo data: on its first start it
// receives the demo family (Maya and Leo) exactly as such devices did. Most suites were written against that data.
// New families (no demo data) are covered by fresh.mjs.
export async function openDemoEraDevice(page, url) {
  const { identifier } = await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { if (!localStorage.getItem("rootmap-seed-version")) localStorage.setItem("rootmap-seed-version", "3"); } catch {}`,
  });
  await page.nav(url);
  await page.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
}
