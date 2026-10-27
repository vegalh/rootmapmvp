// Usage analytics on the device (src/lib/analytics): the event catalogue against the server's whitelist, one impression
// per page visit, click rates, active time (pause, resume, caps), what a batch can contain, retries, the build
// switch, and what turning sharing off does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FEATURES, clickRate, secondsPerPerson } from "../../src/lib/analytics/catalog.ts";
import { ActiveTimer, DAY_CAP_SECONDS, GUEST_KEY, IDLE_MS, ImpressionGate, PENDING_KEY, SHARING_KEY, UsageQueue, createUsageTracker, type SendResult, type UsageBatch } from "../../src/lib/analytics/usage.ts";
import { assertSafeClientEnv, resolveAnalyticsConfig } from "../../src/lib/cloud/environment.ts";

const memory = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
let n = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const S = 1000;

// ---- Catalogue ---------------------------------------------------------------------------------------------------

test("the app's features are exactly the ones the server accepts", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261027000100_usage_analytics.sql", import.meta.url), "utf8");
  const list = sql.match(/features constant text\[\] := array\[([^\]]+)\]/)![1];
  const server = [...list.matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual([...server].sort(), [...FEATURES].sort());
});

test("click rate = clicks ÷ impressions; none without impressions or with a hidden number", () => {
  assert.equal(clickRate(25, 100), 0.25);
  assert.equal(clickRate(0, 40), 0);
  assert.equal(clickRate(0, 0), null);
  assert.equal(clickRate(null, 100), null, "clicks shown as <3");
  assert.equal(clickRate(10, null), null, "impressions shown as <3");
  assert.equal(secondsPerPerson({ seconds: 3600, personDays: 4 }), 900);
  assert.equal(secondsPerPerson({ seconds: null, personDays: 4 }), null);
  assert.equal(secondsPerPerson({ seconds: 0, personDays: 0 }), null);
});

// ---- Impressions -------------------------------------------------------------------------------------------------

test("an impression counts once per page visit, however often the page re-renders", () => {
  const gate = new ImpressionGate();
  gate.newVisit();
  assert.equal(gate.first("today.inspiration"), true);
  for (let i = 0; i < 5; i++) assert.equal(gate.first("today.inspiration"), false, "re-render / language switch");
  assert.equal(gate.first("today.lookingBack"), true, "another feature on the same page");
  gate.newVisit();
  assert.equal(gate.first("today.inspiration"), true, "a new visit counts again");
});

// ---- Active time -------------------------------------------------------------------------------------------------

function timer(visible = true) {
  const credits: [number, number][] = [];
  const t = new ActiveTimer((ms, at) => credits.push([ms, at]), visible);
  return { t, total: () => credits.reduce((s, [ms]) => s + ms, 0), credits };
}

test("time counts between actions less than a minute apart", () => {
  const { t, total } = timer();
  t.activity(0);
  t.activity(20 * S);
  t.activity(50 * S);
  t.advance(55 * S);
  assert.equal(total(), 55 * S);
});

test("after a minute without an action the timer pauses, and resumes with the next action", () => {
  const { t, total } = timer();
  t.activity(0);
  t.advance(10 * 60 * S); // ten minutes later, nothing done
  assert.equal(total(), IDLE_MS, "only the minute after the last action");
  t.activity(10 * 60 * S);
  t.advance(10 * 60 * S + 30 * S);
  assert.equal(total(), IDLE_MS + 30 * S);
});

test("the background pauses at once; actions there don't count; coming back resumes", () => {
  const { t, total } = timer();
  t.activity(0);
  t.hidden(10 * S);
  t.activity(20 * S); // e.g. a stray event while hidden
  t.advance(5 * 60 * S);
  assert.equal(total(), 10 * S);
  t.shown(5 * 60 * S);
  t.advance(5 * 60 * S + 15 * S);
  assert.equal(total(), 25 * S);
});

test("a sleeping device or a clock jump adds at most a minute; a clock going back adds nothing", () => {
  const { t, total } = timer();
  t.activity(0);
  t.advance(10 * 3600 * S);
  assert.equal(total(), IDLE_MS);
  const back = timer();
  back.t.activity(100 * S);
  back.t.advance(50 * S);
  back.t.activity(60 * S);
  back.t.advance(70 * S);
  assert.equal(back.total(), 10 * S);
});

test("nothing counts while the app starts hidden", () => {
  const { t, total } = timer(false);
  t.activity(0);
  t.advance(30 * S);
  assert.equal(total(), 0);
});

// ---- Queue and batches -------------------------------------------------------------------------------------------

test("a batch holds only v, batch_id, day, events and seconds; events only feature, kind and count", () => {
  const q = new UsageQueue(memory());
  q.add("2026-10-27", "today.inspiration", "impression");
  q.add("2026-10-27", "today.inspiration", "click");
  q.add("2026-10-27", "today.inspiration", "click");
  q.addTime("2026-10-27", 61_500);
  const [b] = q.seal("2026-10-27", nextId);
  assert.deepEqual(Object.keys(b).sort(), ["batch_id", "day", "events", "seconds", "v"]);
  assert.equal(b.seconds, 61);
  for (const e of b.events) assert.deepEqual(Object.keys(e).sort(), ["count", "feature", "kind"]);
  assert.deepEqual(b.events.find(e => e.kind === "click")?.count, 2);
  // The half second waits for the next batch.
  q.done(b.batch_id);
  q.addTime("2026-10-27", 500);
  assert.equal(q.seal("2026-10-27", nextId)[0].seconds, 1);
});

test("a batch not yet accepted keeps its id, so a retry isn't counted twice", () => {
  const q = new UsageQueue(memory());
  q.add("2026-10-27", "moments.add", "click");
  const first = q.seal("2026-10-27", nextId);
  const again = q.seal("2026-10-27", nextId);
  assert.equal(again.length, 1);
  assert.equal(again[0].batch_id, first[0].batch_id);
});

test("counts above the server's per-event limit wait for the next batch; old days are dropped", () => {
  const q = new UsageQueue(memory());
  for (let i = 0; i < 620; i++) q.add("2026-10-27", "discover.activities", "impression");
  q.add("2026-10-01", "discover.books", "click");
  const [b] = q.seal("2026-10-27", nextId);
  assert.equal(b.events[0].count, 500);
  q.done(b.batch_id);
  const [rest, ...none] = q.seal("2026-10-27", nextId);
  assert.equal(rest.events[0].count, 120);
  assert.equal(none.length, 0, "a day more than a week old is not sent");
});

test("a device reports at most 12 hours for one day", () => {
  const q = new UsageQueue(memory());
  q.addTime("2026-10-27", 11 * 3600 * S);
  q.done(q.seal("2026-10-27", nextId)[0].batch_id);
  q.addTime("2026-10-27", 3 * 3600 * S);
  const [b] = q.seal("2026-10-27", nextId);
  assert.equal(b.seconds, DAY_CAP_SECONDS - 11 * 3600);
});

// ---- The tracker -------------------------------------------------------------------------------------------------

function tracker({ enabled = true, result = "sent" as SendResult } = {}) {
  const storage = memory();
  const sent: { batch: UsageBatch; guest: string | null }[] = [];
  let now = Date.parse("2026-10-27T09:00:00");
  let signedIn = false;
  const t = createUsageTracker({
    enabled, storage, now: () => now, dayOf: () => "2026-10-27", newId: nextId,
    send: async (batch, guestId) => { sent.push({ batch, guest: signedIn ? null : guestId() }); return result; },
  });
  return { t, storage, sent, tick: (ms: number) => { now += ms; }, signIn: () => { signedIn = true; } };
}

test("sharing is off by default: nothing is counted, stored or sent", async () => {
  const { t, storage, sent } = tracker();
  assert.equal(t.sharing(), false);
  t.newVisit();
  t.impression("today.inspiration");
  t.click("today.inspiration");
  await t.flush();
  assert.equal(storage.m.size, 0);
  assert.equal(sent.length, 0);
});

test("a build without analytics ignores the setting", () => {
  const { t, storage } = tracker({ enabled: false });
  t.setSharing(true);
  assert.equal(t.sharing(), false);
  assert.equal(storage.m.size, 0);
});

test("a guest's batches carry one random guest id; impressions and time arrive once", async () => {
  const { t, sent, tick } = tracker();
  t.setSharing(true, true);
  t.newVisit();
  t.impression("discover.activities");
  t.impression("discover.activities");
  t.click("discover.activities");
  tick(30 * S);
  t.activity();
  tick(10 * S);
  await t.flush();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].batch.events.sort((a, b) => a.kind.localeCompare(b.kind)), [
    { feature: "discover.activities", kind: "click", count: 1 },
    { feature: "discover.activities", kind: "impression", count: 1 },
  ]);
  assert.equal(sent[0].batch.seconds, 40);
  t.click("moments.add");
  await t.flush();
  assert.equal(sent[1].guest, sent[0].guest, "the same guest id on this device");
  assert.match(sent[0].guest!, /^[0-9a-f-]{36}$/);
});

test("signed in, no guest id is created or sent", async () => {
  const { t, sent, storage, signIn } = tracker();
  signIn();
  t.setSharing(true);
  t.click("activity.save");
  await t.flush();
  assert.equal(sent[0].guest, null);
  assert.equal(storage.m.has(GUEST_KEY), false);
});

test("a batch that must wait is kept; a refused one is dropped", async () => {
  const waiting = tracker({ result: "later" });
  waiting.t.setSharing(true);
  waiting.t.click("activity.save");
  await waiting.t.flush();
  await waiting.t.flush();
  assert.equal(waiting.sent[0].batch.batch_id, waiting.sent[1].batch.batch_id);
  const refused = tracker({ result: "refused" });
  refused.t.setSharing(true);
  refused.t.click("activity.save");
  await refused.t.flush();
  await refused.t.flush();
  assert.equal(refused.sent.length, 1);
});

test("turning sharing off stops counting and deletes the queue and the guest id", async () => {
  const { t, storage, sent, tick } = tracker({ result: "later" });
  t.setSharing(true, true);
  t.click("activity.markTried");
  await t.flush();
  assert.ok(storage.m.has(PENDING_KEY) && storage.m.has(GUEST_KEY) && storage.m.get(SHARING_KEY) === "on");
  t.setSharing(false);
  assert.deepEqual([...storage.m.keys()], []);
  t.newVisit();
  t.impression("today.inspiration");
  t.click("today.inspiration");
  t.activity();
  tick(30 * S);
  await t.flush();
  assert.equal(storage.m.size, 0);
  assert.equal(sent.length, 1, "nothing sent after turning off");
});

// ---- Build switch ------------------------------------------------------------------------------------------------

test("analytics are off unless VITE_ROOTMAP_ANALYTICS=on; the public website may count when configured", () => {
  const local = { MODE: "development", VITE_SUPABASE_URL: "http://127.0.0.1:54321", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc" };
  assert.deepEqual(resolveAnalyticsConfig(local), { enabled: false, reason: "not-enabled" });
  assert.deepEqual(resolveAnalyticsConfig({ ...local, VITE_ROOTMAP_ANALYTICS: "on" }), { enabled: true, supabaseUrl: "http://127.0.0.1:54321", publishableKey: "sb_publishable_abc" });
  assert.equal(resolveAnalyticsConfig({ ...local, VITE_ROOTMAP_ANALYTICS: "on", VITE_ROOTMAP_CLOUD: "off" }).enabled, true, "a guest-only build may count");
  assert.equal(resolveAnalyticsConfig({ ...local, MODE: "production", VITE_ROOTMAP_ANALYTICS: "on", VITE_SUPABASE_URL: "https://rootmap-prod.supabase.co" }).enabled, true);
  assert.deepEqual(resolveAnalyticsConfig({ ...local, VITE_ROOTMAP_ANALYTICS: "on", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_x" }), { enabled: false, reason: "secret-key" });
  const stagingUrl = { VITE_ROOTMAP_ANALYTICS: "on", VITE_SUPABASE_URL: "https://cbgkkeveprftddrobzao.supabase.co" };
  assert.doesNotThrow(() => assertSafeClientEnv(stagingUrl, { mode: "production", publicSite: true }));
  assert.equal(resolveAnalyticsConfig({ ...local, MODE: "production", ...stagingUrl }).enabled, true);
});
