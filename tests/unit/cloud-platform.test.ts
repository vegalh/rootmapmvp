import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSafeClientEnv, environmentForMode, isSecretKey, resolveCloudConfig } from "../../src/lib/cloud/environment.ts";
import { readLegacyStorage } from "../../src/lib/data/legacy.ts";
import { detectPlatform } from "../../src/lib/platform/index.ts";
import { SESSION_PREFIX, webSessionStore } from "../../src/lib/platform/web.ts";

const jwt = (payload: object) => `${btoa(JSON.stringify({ alg: "HS256" }))}.${btoa(JSON.stringify(payload)).replace(/=+$/, "")}.sig`;
const PUBLISHABLE = "sb_publishable_abc123";
const local = { MODE: "development", VITE_ROOTMAP_CLOUD: "on", VITE_SUPABASE_URL: "http://127.0.0.1:54321", VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE };
const staging = { MODE: "staging", VITE_ROOTMAP_CLOUD: "on", VITE_SUPABASE_URL: "https://cbgkkeveprftddrobzao.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE };

// ---- Cloud environment ---------------------------------------------------------------------------------------

test("environments follow the Vite mode; unknown modes count as production", () => {
  assert.equal(environmentForMode("development"), "local");
  assert.equal(environmentForMode("staging"), "staging");
  assert.equal(environmentForMode("production"), "production");
  assert.equal(environmentForMode("anything-else"), "production");
  assert.equal(environmentForMode(undefined), "production");
});

test("cloud is off by default, in every environment", () => {
  for (const MODE of ["development", "staging", "production"]) {
    assert.deepEqual(resolveCloudConfig({ MODE }), { enabled: false, environment: environmentForMode(MODE), reason: "not-enabled" });
    assert.equal(resolveCloudConfig({ ...staging, MODE, VITE_ROOTMAP_CLOUD: "true" }).enabled, false, "only the exact value 'on' enables it");
  }
});

test("the public production build never enables the cloud, even when asked", () => {
  assert.deepEqual(resolveCloudConfig({ ...staging, MODE: "production" }), { enabled: false, environment: "production", reason: "production-locked" });
});

test("local and staging enable it with a valid URL and publishable key", () => {
  assert.deepEqual(resolveCloudConfig(local), { enabled: true, environment: "local", supabaseUrl: "http://127.0.0.1:54321", publishableKey: PUBLISHABLE });
  assert.deepEqual(resolveCloudConfig(staging), { enabled: true, environment: "staging", supabaseUrl: "https://cbgkkeveprftddrobzao.supabase.co", publishableKey: PUBLISHABLE });
  assert.equal(resolveCloudConfig({ ...staging, VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon" }) }).enabled, true, "legacy anon key");
});

test("local development can only reach this computer; staging needs https", () => {
  assert.equal(resolveCloudConfig({ ...local, VITE_SUPABASE_URL: "https://cbgkkeveprftddrobzao.supabase.co" }).enabled, false);
  assert.equal(resolveCloudConfig({ ...local, VITE_SUPABASE_URL: "http://localhost:54321" }).enabled, true);
  assert.deepEqual(resolveCloudConfig({ ...staging, VITE_SUPABASE_URL: "http://cbgkkeveprftddrobzao.supabase.co" }).enabled, false);
  assert.equal((resolveCloudConfig({ ...staging, VITE_SUPABASE_URL: "not a url" }) as { reason: string }).reason, "invalid-url");
  assert.equal((resolveCloudConfig({ ...staging, VITE_SUPABASE_URL: "" }) as { reason: string }).reason, "missing-url");
});

test("secret keys are refused; unknown keys are refused", () => {
  for (const key of ["sb_secret_abc123", jwt({ role: "service_role" })]) {
    assert.ok(isSecretKey(key));
    assert.equal((resolveCloudConfig({ ...staging, VITE_SUPABASE_PUBLISHABLE_KEY: key }) as { reason: string }).reason, "secret-key");
  }
  assert.equal((resolveCloudConfig({ ...staging, VITE_SUPABASE_PUBLISHABLE_KEY: "hello" }) as { reason: string }).reason, "invalid-key");
  assert.equal((resolveCloudConfig({ ...staging, VITE_SUPABASE_PUBLISHABLE_KEY: "" }) as { reason: string }).reason, "missing-key");
  assert.ok(!isSecretKey(PUBLISHABLE));
  assert.ok(!isSecretKey(jwt({ role: "anon" })));
});

test("build guard: no secret key in any VITE_ variable, no cloud in the public website or a production build", () => {
  assert.doesNotThrow(() => assertSafeClientEnv({}, { mode: "production", publicSite: true }));
  assert.doesNotThrow(() => assertSafeClientEnv(local, { mode: "development", publicSite: false }));
  assert.doesNotThrow(() => assertSafeClientEnv(staging, { mode: "staging", publicSite: false }));
  assert.throws(() => assertSafeClientEnv({ VITE_ANYTHING: "sb_secret_abc" }, { mode: "development", publicSite: false }), /secret key/);
  assert.throws(() => assertSafeClientEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "service_role" }) }, { mode: "staging", publicSite: false }), /secret key/);
  assert.throws(() => assertSafeClientEnv(staging, { mode: "production", publicSite: false }), /not allowed/);
  assert.throws(() => assertSafeClientEnv(staging, { mode: "staging", publicSite: true }), /not allowed/);
});

// ---- Platform ------------------------------------------------------------------------------------------------

test("platform: 'ios' only inside the native iOS app", () => {
  assert.equal(detectPlatform(undefined), "web");
  assert.equal(detectPlatform({}), "web");
  assert.equal(detectPlatform({ Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" } }), "web");
  assert.equal(detectPlatform({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" } }), "ios");
  assert.equal(detectPlatform({ Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" } }), "web");
  assert.equal(detectPlatform({ Capacitor: { isNativePlatform: () => { throw new Error("x"); } } }), "web");
});

class MemStorage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

test("web session store: stores under its own prefix, which the legacy data reader ignores", async () => {
  const mem = new MemStorage();
  const store = webSessionStore(() => mem);
  assert.equal(await store.getItem("auth-token"), null);
  await store.setItem("auth-token", "{\"session\":1}");
  assert.equal(await store.getItem("auth-token"), "{\"session\":1}");
  assert.deepEqual([...mem.m.keys()], [`${SESSION_PREFIX}auth-token`]);
  assert.ok(!SESSION_PREFIX.startsWith("rootmap-"));
  // The localStorage migration and backups read only "rootmap-…" keys: a session is never archived or exported.
  const legacy = readLegacyStorage(mem as unknown as Storage);
  assert.deepEqual(Object.keys(legacy.values), []);
  assert.deepEqual(legacy.unplaced, []);
  await store.removeItem("auth-token");
  assert.equal(mem.m.size, 0);
});

test("web session store: unreadable storage means no session; a failed save is reported", async () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  const store = webSessionStore(() => broken);
  assert.equal(await store.getItem("k"), null);
  await assert.rejects(store.setItem("k", "v"));
  await store.removeItem("k");
});
