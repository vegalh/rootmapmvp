import { test } from "node:test";
import assert from "node:assert/strict";
import { createRefresher, fromRpc, type Fetched } from "../../src/lib/refresher.ts";

// The Circle's refresh rules (components/ChildCircle.tsx; docs/shared-child-profiles-release-readiness.md): one
// request at a time, a change always followed by a fresh read, passive refreshes throttled, stale answers dropped.

// A fetch whose answers the test hands out one by one, in any order.
function controlled<T>() {
  const calls: { resolve: (r: Fetched<T>) => void; reject: (e: unknown) => void }[] = [];
  const fetch = () => new Promise<Fetched<T>>((resolve, reject) => { calls.push({ resolve, reject }); });
  return { fetch, calls };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("one request at a time; asks while one is on its way queue exactly one more", async () => {
  const { fetch, calls } = controlled<string>();
  const applied: Fetched<string>[] = [];
  const r = createRefresher(fetch, res => applied.push(res));
  const first = r.refresh({ force: true });
  const second = r.refresh({ force: true });
  const third = r.refresh({ force: true });
  assert.equal(calls.length, 1, "no second request while the first is on its way");
  assert.equal(second, third, "however many asks arrive meanwhile, one follow-up");
  calls[0].resolve({ ok: true, value: "before the change" });
  await first; await tick();
  assert.equal(calls.length, 2, "the follow-up starts once the first lands");
  calls[1].resolve({ ok: true, value: "after the change" });
  await second;
  assert.deepEqual(applied.map(a => a.ok && a.value), ["before the change", "after the change"]);
});

test("passive refreshes are throttled; forced ones (after the parent's own change) never are", async () => {
  let clock = 0;
  const { fetch, calls } = controlled<number>();
  const r = createRefresher(fetch, () => {}, { minIntervalMs: 5000, now: () => clock });
  void r.refresh({ force: true });
  calls[0].resolve({ ok: true, value: 1 });
  await tick();
  clock = 1000;
  await r.refresh();
  assert.equal(calls.length, 1, "coming back to the page a second later asks nothing");
  void r.refresh({ force: true });
  assert.equal(calls.length, 2, "a change made here always reads again");
  calls[1].resolve({ ok: true, value: 2 });
  await tick();
  clock = 7000;
  void r.refresh();
  assert.equal(calls.length, 3, "after the interval, a passive refresh asks again");
});

test("a passive ask while a request is on its way and recent doesn't queue another", async () => {
  const { fetch, calls } = controlled<number>();
  const r = createRefresher(fetch, () => {}, { now: () => 0 });
  const first = r.refresh({ force: true });
  const passive = r.refresh();
  assert.equal(passive, first, "joins the one on its way");
  calls[0].resolve({ ok: true, value: 1 });
  await first; await tick();
  assert.equal(calls.length, 1);
});

test("nothing is applied after stop (the screen closed or moved to another child)", async () => {
  const { fetch, calls } = controlled<string>();
  const applied: unknown[] = [];
  const r = createRefresher(fetch, res => applied.push(res));
  void r.refresh({ force: true });
  const queued = r.refresh({ force: true });
  r.stop();
  calls[0].resolve({ ok: true, value: "late" });
  await queued;
  assert.deepEqual(applied, [], "a late answer for a closed screen is dropped");
  assert.equal(calls.length, 1, "the queued follow-up never starts");
  await r.refresh({ force: true });
  assert.equal(calls.length, 1, "a stopped refresher asks nothing");
});

test("a thrown fetch is a retryable failure, not a crash, and the next refresh still runs", async () => {
  let n = 0;
  const applied: Fetched<number>[] = [];
  const r = createRefresher(async () => { n++; if (n === 1) throw new TypeError("Failed to fetch"); return { ok: true, value: n } as const; }, res => applied.push(res));
  await r.refresh({ force: true });
  await r.refresh({ force: true });
  assert.deepEqual(applied, [{ ok: false, denied: false }, { ok: true, value: 2 }]);
});

test("RPC answers: 42501 means no longer allowed, anything else can be retried", () => {
  assert.deepEqual(fromRpc({ data: [1], error: null }), { ok: true, value: [1] });
  assert.deepEqual(fromRpc({ data: null, error: { code: "42501" } }), { ok: false, denied: true });
  assert.deepEqual(fromRpc({ data: null, error: { code: "" } }), { ok: false, denied: false }, "offline");
  assert.deepEqual(fromRpc({ data: null, error: { code: "57014" } }), { ok: false, denied: false }, "timeout");
});
