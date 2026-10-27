// Shared set-up for the browser tests with cloud features ON (cloud.mjs, spaces.mjs): the local Supabase stack,
// a dev server with cloud on, one browser profile per simulated device, sign-in through the app's own screens,
// and reading any of the app's local databases.
import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import pg from "pg";
import { HELPERS, launch, sleep } from "./cdp.mjs";
import { tempProfile } from "./env.mjs";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
export const API = status.API_URL;
export const MAIL = status.MAILPIT_URL ?? status.INBUCKET_URL;
export const DB_URL = status.DB_URL;
export const KEY = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
export const SERVICE = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY;
for (const u of [API, MAIL, DB_URL]) if (!["127.0.0.1", "localhost"].includes(new URL(u).hostname)) throw new Error(`refusing non-local stack ${u}`);

// A dev server with cloud features on (environment "local"). `env` adds or overrides variables (analytics.mjs).
export async function startServer(env = {}) {
  const port = 5100 + Math.floor(Math.random() * 800);
  const server = spawn(path.join(ROOT, "node_modules/.bin/vite"), ["--port", String(port), "--strictPort"], {
    cwd: ROOT, stdio: "ignore",
    env: { ...process.env, VITE_ROOTMAP_CLOUD: "on", VITE_SUPABASE_URL: API, VITE_SUPABASE_PUBLISHABLE_KEY: KEY, ...env },
  });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) break; } catch { /* starting */ }
    await sleep(200);
  }
  return { base, stop: () => server.kill() };
}

// Reads any of the app's IndexedDB databases without creating or changing it.
const DB_HELPERS = `
window.__s = {
  async names() { return (await indexedDB.databases()).map(d => d.name).sort(); },
  async dump(name) {
    if (!(await this.names()).includes(name)) return null;
    const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const out = {};
    for (const s of db.objectStoreNames) out[s] = await new Promise((res, rej) => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    db.close();
    if (out.photoBlobs) out.photoBlobs = out.photoBlobs.map(b => ({ id: b.id, size: b.blob.size, type: b.blob.type }));
    return out;
  },
};`;

// A simulated device: its own browser profile. `requests` collects every request to the stack, across reloads.
export async function newDevice(name, devtoolsPort, setup) {
  // A free DevTools port, so a browser left over from an interrupted run is never mistaken for this one.
  const page = await launch(tempProfile(name), await freePort(devtoolsPort));
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HELPERS });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: DB_HELPERS });
  if (setup) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: setup });
  await page.send("Network.enable");
  page.requests = [];
  page.handlers.add(m => {
    if (m.method === "Network.requestWillBeSent" && m.params.request.url.startsWith(API)) page.requests.push(`${m.params.request.method} ${m.params.request.url.replace(API, "").split("?")[0]}`);
  });
  return page;
}

async function freePort(preferred) {
  const tryPort = port => new Promise(resolve => {
    const srv = net.createServer().once("error", () => resolve(false)).once("listening", () => srv.close(() => resolve(true))).listen(port, "127.0.0.1");
  });
  for (let port = preferred; port < preferred + 200; port++) if (await tryPort(port)) return port;
  throw new Error("no free DevTools port");
}

// Runs named steps; a step fails on any console error it didn't expect.
export function stepper(getPage) {
  const results = [];
  async function step(name, fn, expected) {
    const page = getPage();
    const errorsBefore = page.errors.length;
    try {
      await fn();
      const newErrors = page.errors.slice(errorsBefore).filter(e => !(expected && expected.test(e)));
      if (newErrors.length) throw new Error(`console errors: ${newErrors.join(" | ")}`);
      results.push(["PASS", name]);
      console.log(`PASS  ${name}`);
    } catch (e) {
      results.push(["FAIL", name, e.message]);
      console.log(`FAIL  ${name}\n      ${e.message.split("\n").join("\n      ")}`);
    }
  }
  const finish = () => {
    const failed = results.filter(r => r[0] === "FAIL");
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    return failed.length ? 1 : 0;
  };
  return { step, finish };
}

// Page helpers bound to one device.
export function ui(page) {
  const self = {
    text: () => page.eval(`document.body.innerText`),
    has: s => page.eval(`document.body.innerText.includes(${JSON.stringify(s)})`),
    click: (label, selector = "button") => page.eval(`__t.click(${JSON.stringify(label)}, ${JSON.stringify(selector)})`),
    type: (selector, value) => page.eval(`__t.type(${JSON.stringify(selector)}, ${JSON.stringify(value)})`),
    cloudState: () => page.eval(`import("/src/lib/cloud/session.ts").then(C => C.cloudState())`),
    waitCloud: (status, label = status) => page.waitFor(`import("/src/lib/cloud/session.ts").then(C => C.cloudState().status === ${JSON.stringify(status)})`, 15000, label),
    space: () => page.eval(`import("/src/lib/data/store.ts").then(S => S.activeSpace())`),
    appReady: () => page.waitFor(`document.querySelector(".app-shell") && document.querySelector(".bottom-nav, .page-content, main")`, 15000, "app rendered"),
    welcomeShown: () => page.waitFor(`document.querySelector(".opening") && document.body.innerText.includes("Welcome to RootMap")`, 15000, "Welcome shown"),
    // From any screen: back out of a sub-page (they have no bottom bar), then the Profile tab.
    openProfile: async () => {
      await page.waitFor(`document.querySelector(".bottom-nav") || document.querySelector(".page-header.with-back .icon-button")?.click()`, 5000, "a screen with the bottom bar");
      await page.eval(`[...document.querySelectorAll(".bottom-nav button")].at(-1).click()`);
      await page.waitFor(`document.querySelector(".profile-page")`, 5000, "Profile");
    },
    errorShown: () => page.eval(`document.querySelector("[role=alert]")?.innerText ?? ""`),
    dbNames: () => page.eval(`__s.names()`),
    dump: name => page.eval(`__s.dump(${JSON.stringify(name)})`),
    sessionKeys: () => page.eval(`Object.keys(__t.ls()).filter(k => k.startsWith("rootmap.session:"))`),
    // Waits for the page load that follows signing in or out (the app reloads into the other space).
    reloaded: async (fn) => { const loaded = page.waitEvent("Page.loadEventFired", 20000); await fn(); await loaded; await self.appReady(); },
    // Requests a code through the screens (Welcome → Continue with Email → email → Email me a code).
    requestCode: async (entry, email) => {
      await self.click(entry);
      await page.waitFor(`document.querySelector("input[name=email]")`, 5000, "email step");
      const before = await mailCount(email);
      await self.type("input[name=email]", email);
      await self.click("Email me a code");
      await page.waitFor(`document.querySelector("input[name=code]")`, 10000, "code step");
      return latestCode(email, before);
    },
    // From Welcome (or the sign-in screen): signs in with an emailed code and waits for the account's space. A new
    // account is then asked for its required password, set here to PASSWORD.
    signIn: async (email, entry = "Continue with Email") => {
      const code = await self.requestCode(entry, email);
      await self.reloaded(() => self.type("input[name=code]", code));
      await page.waitFor(`import("/src/lib/cloud/session.ts").then(C => C.cloudState().status === "signed-in" && C.cloudState().account)`, 15000, "signed in, account ready");
      await self.createPasswordIfAsked();
    },
    // The required "Create a password" page, if this account hasn't set one.
    createPasswordIfAsked: async (password = PASSWORD) => {
      const needs = await page.eval(`import("/src/lib/cloud/session.ts").then(C => !C.cloudState().user.hasPassword)`);
      if (!needs) return;
      await page.waitFor(`document.querySelector(".password-form")`, 10000, "Create a password");
      await self.type("input[name=new-password]", password);
      await self.type("input[name=confirm-password]", password);
      await page.eval(`document.querySelector(".password-form button[type=submit]").click(); true`);
      await page.waitFor(`import("/src/lib/cloud/session.ts").then(C => C.cloudState().user.hasPassword) && !document.querySelector(".password-form")`, 15000, "password saved");
    },
    // From Welcome (or the sign-in screen): email and password.
    signInWithPassword: async (email, password = PASSWORD, entry = "Continue with Email") => {
      await self.click(entry);
      await page.waitFor(`document.querySelector("input[name=email]")`, 5000, "email step");
      await self.type("input[name=email]", email);
      await self.type("input[name=password]", password);
      await self.reloaded(() => page.eval(`document.querySelector("form button[type=submit]").click(); true`));
      await page.waitFor(`import("/src/lib/cloud/session.ts").then(C => C.cloudState().status === "signed-in" && C.cloudState().account)`, 15000, "signed in with password");
    },
    // After signing in on a device with guest data, the question about bringing it in (M6) opens; "Not now".
    skipImport: async () => {
      await page.waitFor(`document.querySelector(".guest-import .sheet-buttons button") || (document.querySelector(".guest-import") && document.body.innerText.includes("nothing on this device"))`, 15000, "the guest import question");
      await page.eval(`[...document.querySelectorAll(".guest-import .sheet-buttons button")].find(b => b.textContent === "Not now")?.click(); true`);
      await page.waitFor(`!document.querySelector(".guest-import")`, 5000, "question closed");
    },
    // Profile → RootMap Account → Sign out → confirm; waits for the guest space.
    signOut: async () => {
      await self.openProfile();
      await self.click("RootMap Account");
      await page.waitFor(`document.body.innerText.includes("Sign out")`, 3000, "account page");
      await self.click("Sign out");
      await self.reloaded(() => page.eval(`[...document.querySelectorAll(".sheet-buttons button")].at(-1).click()`));
      await self.waitCloud("signed-out");
    },
  };
  return self;
}

const search = async email => (await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()).messages ?? [];
export const mailCount = async email => (await search(email)).length;
export async function latestCode(email, after = 0) {
  for (let i = 0; i < 150; i++) {
    const messages = await search(email);
    if (messages.length > after) {
      const msg = await (await fetch(`${MAIL}/api/v1/message/${messages[0].ID}`)).json();
      return String(msg.Text).match(/\b(\d{6})\b/)[1];
    }
    await sleep(50);
  }
  throw new Error("no code email");
}

// Moves an address's last code send time back 61 minutes (codes expire after 1 hour). Local stack only.
export async function expireCodes(email) {
  const db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  try {
    await db.query("update auth.users set confirmation_sent_at = confirmation_sent_at - interval '61 minutes', recovery_sent_at = recovery_sent_at - interval '61 minutes' where email = $1", [email]);
  } finally {
    await db.end();
  }
}

// The password the browser suites give every account they create.
export const PASSWORD = "rootmap-test-pass";

export const admin = path => fetch(`${API}${path}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } }).then(r => r.json());
export { sleep };
