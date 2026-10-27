// Runs the browser regression suites in headless Chrome. No dependencies: Chrome is driven over the DevTools
// protocol (cdp.mjs) with Node's built-in WebSocket.
//
//   npm run test:e2e                      starts its own Vite dev server on a spare port
//   RM_BASE=http://localhost:8443 npm run test:e2e   uses an already running server instead
//   CHROME_PATH=/path/to/chrome           if Chrome isn't in the default macOS location
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SUITES = ["app.mjs", "resilience.mjs", "tabs.mjs", "reactive.mjs", "navigation.mjs", "discover.mjs", "activities.mjs", "fresh.mjs", "memories.mjs", "collections.mjs", "profile.mjs", "journey.mjs"];

// Writes an RGB PNG. `pixel(x, y)` returns [r, g, b].
function writePng(file, width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0, o = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 1 })), chunk("IEND", Buffer.alloc(0))]));
}

// Phone-camera sized photos, including a worst-case noise image that barely compresses.
function makeImages(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const noise = crypto.randomBytes(2400 * 1800 * 3);
  writePng(path.join(dir, "landscape.png"), 4032, 3024, (x, y) => [(x * 255 / 4032) | 0, (y * 255 / 3024) | 0, (x + y) & 255]);
  writePng(path.join(dir, "noise.png"), 2400, 1800, (x, y) => { const i = (y * 2400 + x) * 3; return [noise[i], noise[i + 1], noise[i + 2]]; });
  writePng(path.join(dir, "portrait.png"), 3024, 4032, (x, y) => [(y >> 4) & 255, (x * 255 / 3024) | 0, 128]);
  return fs.readdirSync(dir).map(f => `${f} ${(fs.statSync(path.join(dir, f)).size / 1e6).toFixed(1)} MB`).join(", ");
}

async function startServer() {
  const port = 5100 + Math.floor(Math.random() * 800);
  const proc = spawn(path.join(ROOT, "node_modules/.bin/vite"), ["--port", String(port), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) return { base, proc }; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error("dev server did not start");
}

const imgDir = path.join(os.tmpdir(), "rootmap-test-images");
console.log(`test images: ${makeImages(imgDir)}`);
const server = process.env.RM_BASE ? null : await startServer();
const base = process.env.RM_BASE || server.base;
console.log(`app: ${base}\n`);

let failed = 0;
try {
  for (const suite of SUITES) {
    console.log(`── ${suite}`);
    const code = await new Promise(resolve => {
      const p = spawn(process.execPath, [path.join(ROOT, "tests/e2e", suite)], { stdio: "inherit", env: { ...process.env, RM_BASE: base, RM_IMG_DIR: imgDir } });
      p.on("exit", resolve);
    });
    if (code !== 0) failed++;
    console.log("");
  }
} finally {
  server?.proc.kill();
}
console.log(failed ? `${failed} of ${SUITES.length} suites failed` : `all ${SUITES.length} suites passed`);
process.exit(failed ? 1 : 0);
