import { test } from "node:test";
import assert from "node:assert/strict";

// An invitation link's token is taken out of the address and held for this tab only (lib/inviteToken.ts;
// docs/shared-child-profiles-release-readiness.md, finding S2). Browser globals are stood in for here.

function browser(hash: string) {
  const session = new Map<string, string>();
  const local = new Map<string, string>();
  const replaced: string[] = [];
  const g = globalThis as Record<string, unknown>;
  g.window = {
    location: { hash, pathname: "/app/", search: "?x=1" },
    history: { state: { rmIdx: 3 }, replaceState: (_s: unknown, _t: string, url: string) => { replaced.push(url); (g.window as { location: { hash: string } }).location.hash = url.slice(url.indexOf("#")); } },
  };
  const storage = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
  g.sessionStorage = storage(session);
  g.localStorage = storage(local);
  return { session, local, replaced, location: (g.window as { location: { hash: string } }).location };
}
// A fresh copy of the module each time (its in-memory token is per page load).
let n = 0;
const load = async () => import(`../../src/lib/inviteToken.ts?${++n}`) as Promise<typeof import("../../src/lib/inviteToken.ts")>;

test("a link's token leaves the address at once, kept in sessionStorage only; the address keeps its path and query", async () => {
  const b = browser("#/invite/abc123def456");
  const m = await load();
  assert.equal(m.captureInviteToken(), true);
  assert.deepEqual(b.replaced, ["/app/?x=1#/invite"]);
  assert.equal(b.location.hash, "#/invite");
  assert.equal(m.pendingInviteToken(), "abc123def456");
  assert.ok(b.session.get("rootmap.pending-invite")?.includes("abc123def456"));
  assert.equal(b.local.size, 0, "never localStorage");
});

test("after a reload (sign-in, refresh) the same tab still has it; another address has none", async () => {
  const b = browser("#/invite/tok-1");
  (await load()).captureInviteToken();
  b.location.hash = "#/invite";
  const reloaded = await load();
  assert.equal(reloaded.captureInviteToken(), false, "nothing left in the address");
  assert.equal(reloaded.pendingInviteToken(), "tok-1");
  browser("#/today");
  const other = await load();
  assert.equal(other.captureInviteToken(), false);
  assert.equal(other.pendingInviteToken(), null);
});

test("forgotten when spent, and after a day in any case", async () => {
  const b = browser("#/invite/tok-2");
  const m = await load();
  m.captureInviteToken();
  m.forgetInviteToken();
  assert.equal(m.pendingInviteToken(), null);
  assert.equal(b.session.size, 0);
  b.session.set("rootmap.pending-invite", JSON.stringify({ token: "old", at: Date.now() - 25 * 60 * 60 * 1000 }));
  assert.equal((await load()).pendingInviteToken(), null, "older than a day");
  assert.equal(b.session.size, 0, "and removed");
});

test("an encoded token is decoded; an address without one changes nothing", async () => {
  const b = browser("#/invite/a%2Db");
  const m = await load();
  m.captureInviteToken();
  assert.equal(m.pendingInviteToken(), "a-b");
  const c = browser("#/child/emma");
  const m2 = await load();
  assert.equal(m2.captureInviteToken(), false);
  assert.deepEqual(c.replaced, []);
  void b;
});
