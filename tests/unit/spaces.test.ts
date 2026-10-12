import { test } from "node:test";
import assert from "node:assert/strict";
import { DB_NAME, GUEST, databaseName, isUserId, type OutboxEntry } from "../../src/lib/data/schema.ts";
import { outboxEntries } from "../../src/lib/data/records.ts";
import { DEVICE_KEY, deviceId } from "../../src/lib/data/device.ts";
import { planGuestMigration, type GuestSnapshot } from "../../src/lib/data/guestPlan.ts";
import { spaceMatches } from "../../src/lib/cloud/space.ts";
import type { Child } from "../../src/types.ts";

// Local spaces, the outbox and the guest migration plan (Phase 2B-2 M3). The browser behaviour (separate
// databases, switching, interrupted writes) is tested in tests/e2e/spaces.mjs.

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("each space has its own database; the guest space keeps RootMap's original database", () => {
  assert.equal(databaseName(GUEST), DB_NAME);
  assert.equal(DB_NAME, "rootmap");
  assert.equal(databaseName({ kind: "account", userId: A }), `rootmap-account-${A}`);
  assert.notEqual(databaseName({ kind: "account", userId: A }), databaseName({ kind: "account", userId: B }));
  // Only real account ids name a database (no path tricks, no other database's name).
  for (const bad of ["", "x", "../rootmap", "AAAAAAAA-1111-4111-8111-111111111111", `${A} `]) {
    assert.ok(!isUserId(bad), bad);
    assert.throws(() => databaseName({ kind: "account", userId: bad }));
  }
});

test("the open space must match the sign-in state, or the app reloads into the right one", () => {
  const signedIn = (userId: string) => ({ status: "signed-in" as const, user: { userId, email: null }, account: null, offline: false });
  const accountA = { kind: "account" as const, userId: A };
  assert.equal(spaceMatches(GUEST, { status: "signed-out" }), true);
  assert.equal(spaceMatches(accountA, signedIn(A)), true);
  assert.equal(spaceMatches(GUEST, signedIn(A)), false, "signed in while the guest space is open");
  assert.equal(spaceMatches(accountA, { status: "signed-out" }), false, "signed out (or revoked) while A's space is open");
  assert.equal(spaceMatches(accountA, signedIn(B)), false, "another account signed in (e.g. in another tab)");
  // Offline restore is still signed in: the account's space stays open.
  assert.equal(spaceMatches(accountA, { ...signedIn(A), offline: true }), true);
  // Undecided states never switch.
  for (const s of [{ status: "off" as const }, { status: "starting" as const }]) {
    assert.equal(spaceMatches(GUEST, s), true);
    assert.equal(spaceMatches(accountA, s), true);
  }
});

test("outbox: one entry per record, deletions marked, a re-changed record keeps its place in the queue", () => {
  let seq = 0;
  const ctx = (now: string) => ({ now, deviceId: "d-1", nextSeq: () => ++seq });
  const first = outboxEntries("children", [{ id: "c-1" }, { id: "c-2", deletedAt: "2026-10-12T00:00:00Z" }], new Map(), ctx("t1"));
  assert.deepEqual(first.map(e => [e.key, e.op, e.seq, e.queuedAt, e.changedAt, e.deviceId]), [
    ["children:c-1", "put", 1, "t1", "t1", "d-1"],
    ["children:c-2", "delete", 2, "t1", "t1", "d-1"],
  ]);
  const current = new Map<string, OutboxEntry>(first.map(e => [e.key, e]));
  const [again] = outboxEntries("children", [{ id: "c-1", deletedAt: "t2" }], current, ctx("t2"));
  assert.deepEqual([again.op, again.seq, again.queuedAt, again.changedAt], ["delete", 3, "t1", "t2"]);
  // Same id in another collection is a different entry.
  assert.equal(outboxEntries("entries", [{ id: "c-1" }], current, ctx("t3"))[0].key, "entries:c-1");
});

test("the device id is created once and kept; an unusable stored value is replaced", async () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  // Fresh module state for each case.
  const load = async () => (await import(`../../src/lib/data/device.ts?${Math.random()}`)).deviceId as typeof deviceId;
  const id = (await load())(storage);
  assert.match(id, /^d-[0-9a-f-]{36}$/);
  assert.equal(store.get(DEVICE_KEY), id);
  assert.equal((await load())(storage), id);
  store.set(DEVICE_KEY, "garbage");
  const replaced = (await load())(storage);
  assert.notEqual(replaced, id);
  assert.match(replaced, /^d-/);
});

// ---- Guest migration plan ----------------------------------------------------------------------------------

const demo: Child[] = [
  { id: "emma", first: "Maya", last: "Hao", dob: "2023-08-10", enrolled: "", lessons: 0, group: "Primary", photo: "" } as Child,
  { id: "noah", first: "Leo", last: "Hao", dob: "2024-02-10", enrolled: "", lessons: 0, group: "Toddler", photo: "" } as Child,
];
function snapshot(overrides: Partial<GuestSnapshot["collections"]> = {}): GuestSnapshot {
  return {
    collections: {
      children: demo.map(c => ({ ...c, origin: "demo" as const })),
      records: [{ id: "r1", childId: "emma", origin: "demo" } as never],
      observations: [],
      entries: [],
      plans: [],
      goals: [],
      saved: [{ id: "water-pouring", origin: "unknown" }],
      ...overrides,
    },
    photos: [],
    drafts: 2,
    archive: 1,
  };
}
const ids = (list: { collection: string; id: string }[]) => list.map(r => `${r.collection}:${r.id}`).sort();

test("plan: untouched demo stays on the device; unknown origin needs one question; drafts and archive never go", () => {
  const plan = planGuestMigration(snapshot(), demo);
  assert.deepEqual(plan.upload, []);
  assert.deepEqual(ids(plan.keepDemo), ["children:emma", "children:noah", "records:r1"]);
  assert.deepEqual(ids(plan.ask), ["saved:water-pouring"]);
  assert.deepEqual(plan.never, { drafts: 2, archive: 1, orphanPhotos: [] });
  assert.equal(plan.needsConfirmation, true);
});

test("plan: the parent's own records, demo children they made their own, and everything attached to those go", () => {
  const plan = planGuestMigration(snapshot({
    children: [
      { ...demo[0], origin: "demo" as const, first: "Mia" }, // renamed demo child: made own
      { ...demo[1], origin: "demo" as const }, // untouched
      { id: "c-own", first: "Ada", last: "Li", dob: "2022-01-01", origin: "user", photo: "photo-11111111-1111-4111-8111-111111111111" } as Child,
    ],
    records: [{ id: "r1", childId: "emma", origin: "demo" } as never, { id: "r2", childId: "noah", origin: "demo" } as never],
    entries: [
      { id: "m-1", childId: "noah", origin: "user", photos: ["photo-22222222-2222-4222-8222-222222222222"] } as never, // user entry on an untouched demo child
      { id: "m-2", childId: "c-own", origin: "unknown", photos: [] } as never, // attached to an owned child
    ],
    saved: [],
  }), demo);
  // Leo has a user entry, so Leo is the parent's too, with his demo record.
  assert.deepEqual(ids(plan.upload), ["children:c-own", "children:emma", "children:noah", "entries:m-1", "entries:m-2", "records:r1", "records:r2"]);
  assert.deepEqual(plan.keepDemo, []);
  assert.deepEqual(plan.ask, []);
  assert.deepEqual(plan.photos.sort(), ["photo-11111111-1111-4111-8111-111111111111", "photo-22222222-2222-4222-8222-222222222222"]);
  assert.equal(plan.needsConfirmation, false);
});

test("plan: a child matching one already in the account is a question, not an automatic upload decision", () => {
  const own = { id: "c-own", first: "Ada", last: "Li", dob: "2022-01-01", origin: "user" } as Child;
  const plan = planGuestMigration(snapshot({ children: [own], records: [], saved: [] }), demo, [{ ...own, id: "c-cloud", first: " ada " }]);
  assert.deepEqual(plan.possibleDuplicates, [{ localId: "c-own", cloudId: "c-cloud" }]);
  assert.equal(plan.needsConfirmation, true);
});

test("plan: photos nothing refers to are never uploaded", () => {
  const s = snapshot({ saved: [] });
  s.photos = [{ id: "photo-33333333-3333-4333-8333-333333333333" } as never];
  assert.deepEqual(planGuestMigration(s, demo).never.orphanPhotos, ["photo-33333333-3333-4333-8333-333333333333"]);
});
