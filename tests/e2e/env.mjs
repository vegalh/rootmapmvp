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
