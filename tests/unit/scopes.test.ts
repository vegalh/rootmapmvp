import { test } from "node:test";
import assert from "node:assert/strict";
import { outboxKey, type OutboxEntry } from "../../src/lib/data/schema.ts";
import { childAccess } from "../../src/lib/childAccess.ts";
import {
  CONFIRM_REMOVAL_AFTER, homeLocal, initialScopeState, isScopedId, observeMemberships, planRevocation, scopeStateFor, scopedId, scopedLocal, sharedScopes, unscope,
  type Membership, type ScopeBase, type ScopeState,
} from "../../src/lib/sync/scopes.ts";

// Shared-children sync, pure parts (Phase 2a; docs/shared-child-profiles-phase2a.md). Against a real server:
// tests/db/multiFamilySync.test.ts.

const U = "11111111-1111-4111-8111-111111111111";
const HOME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const F1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const F2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const now = "2026-11-01T10:00:00.000Z";
const ok = (memberships: Membership[]) => ({ ok: true as const, memberships });
const own: Membership = { familyId: HOME, childId: "emma", role: "owner" };
const observe = (s: ScopeState, a: Parameters<typeof observeMemberships>[1], homeChildren = ["emma"]) => observeMemberships(s, a, { userId: U, now, homeChildren });

test("identity: the same id in two families never makes the same local id, nor one of the user's own", () => {
  const ids = [scopedId(F1, "emma"), scopedId(F2, "emma"), "emma"];
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(unscope(scopedId(F1, "emma")), { familyId: F1, id: "emma" });
  assert.equal(unscope("emma"), null);
  assert.ok(isScopedId(ids[0]) && !isScopedId("emma"));
  // Any id the server accepts (no control characters), however odd, round-trips and stays apart.
  for (const id of ["a/b", "c-11111111-1111-4111-8111-111111111111", "名字", "x:y", ""]) {
    assert.deepEqual(unscope(scopedId(F1, id)), { familyId: F1, id });
    assert.notEqual(scopedId(F1, id), id);
  }
});

test("memberships: a new shared child is confirmed at once and its family is downloaded again from the start", () => {
  const { state, actions } = observe(initialScopeState(U, HOME), ok([own, { familyId: F1, childId: "emma", role: "editor" }]));
  assert.deepEqual(state.shared, { [scopedId(F1, "emma")]: "editor" });
  assert.deepEqual(actions, [{ kind: "fullResync", familyId: F1 }]);
  // The user's own family is never a shared scope.
  assert.deepEqual(sharedScopes(state), [{ familyId: F1, childIds: ["emma"] }]);
});

test("memberships: several children of one family make one scope; another family its own", () => {
  const { state, actions } = observe(initialScopeState(U, HOME), ok([own, { familyId: F1, childId: "b", role: "viewer" }, { familyId: F1, childId: "a", role: "editor" }, { familyId: F2, childId: "a", role: "editor" }]));
  assert.deepEqual(sharedScopes(state), [{ familyId: F1, childIds: ["a", "b"] }, { familyId: F2, childIds: ["a"] }]);
  assert.deepEqual(actions, [{ kind: "fullResync", familyId: F1 }, { kind: "fullResync", familyId: F2 }]);
});

test("memberships: a role change (also an ownership transfer) updates the role and frees refused changes; nothing is downloaded again", () => {
  const s1 = observe(initialScopeState(U, HOME), ok([own, { familyId: F1, childId: "emma", role: "editor" }])).state;
  const { state, actions } = observe(s1, ok([own, { familyId: F1, childId: "emma", role: "owner" }]));
  assert.equal(state.shared[scopedId(F1, "emma")], "owner");
  assert.deepEqual(actions, [{ kind: "clearRejections", familyId: F1 }]);
});

test("memberships: a child of the user's own family handed to someone else shows the user's new role, and is handed back", () => {
  const handed = observe(initialScopeState(U, HOME), ok([{ ...own, role: "editor" }]));
  assert.deepEqual(handed.state.home, { emma: "editor" });
  assert.deepEqual(handed.state.shared, {}, "never a shared scope");
  assert.deepEqual(handed.actions, [{ kind: "clearRejections", familyId: HOME }]);
  assert.equal(childAccess("emma", handed.state), "edit");
  const back = observe(handed.state, ok([own]));
  assert.equal(back.state.home, undefined);
  assert.equal(childAccess("emma", back.state), "manage");
});

test("memberships: once access to a handed-over child ends (left, removed, profile deleted), it is removed after answers in a row; a child the user manages never is", () => {
  const leo: Membership = { familyId: HOME, childId: "leo", role: "owner" };
  const handed = observe(initialScopeState(U, HOME), ok([{ ...own, role: "editor" }, leo]), ["emma", "leo"]).state;
  const once = observe(handed, ok([leo]), ["emma", "leo"]);
  assert.deepEqual(once.actions, [], "one answer is never enough");
  assert.equal(childAccess("emma", once.state), "edit");
  const twice = observe(once.state, ok([leo]), ["emma", "leo"]);
  assert.deepEqual(twice.actions, [{ kind: "revoke", familyId: HOME, childId: "emma" }, { kind: "clearRejections", familyId: HOME }]);
  assert.equal(twice.state.revoked.emma.state, "pending");
  // Its only child gone: the answer has no own-family membership at all, and is still believed.
  const alone = observe(observe(handed, ok([]), ["emma"]).state, ok([]), ["emma"]);
  assert.ok(alone.actions.some(a => a.kind === "revoke"));
  // A child the user manages that goes missing: nothing (no role is kept for it, so nothing to remove).
  let s = observe(initialScopeState(U, HOME), ok([own, leo]), ["emma", "leo"]).state;
  for (let i = 0; i < 4; i++) { const r = observe(s, ok([leo]), ["emma", "leo"]); assert.deepEqual(r.actions, []); s = r.state; }
  assert.deepEqual(s.revoked, {});
  // Access back (the profile restored): the user's own family is downloaded again.
  const restored = observe(twice.state, ok([{ ...own, role: "editor" }, leo]), ["leo"]);
  assert.equal(restored.state.revoked.emma, undefined);
  assert.ok(restored.actions.some(a => a.kind === "fullResync" && a.familyId === HOME));
});

test("memberships: removal needs answers in a row; an unknown answer or a one-off gap removes nothing", () => {
  const shared = observe(initialScopeState(U, HOME), ok([own, { familyId: F1, childId: "emma", role: "editor" }])).state;
  // Offline, or an error: nothing changes, however often.
  let s = shared;
  for (let i = 0; i < 5; i++) {
    const r = observe(s, { ok: false, reason: "Failed to fetch" });
    assert.deepEqual(r.actions, []);
    s = r.state;
  }
  assert.deepEqual(s, shared);
  // An answer without the user's own children can't be right: ignored.
  assert.deepEqual(observe(shared, ok([])).actions, []);
  assert.deepEqual(observe(shared, ok([])).state, shared);
  // Missing once, then back: nothing removed, the count is forgotten.
  const once = observe(shared, ok([own]));
  assert.equal(CONFIRM_REMOVAL_AFTER, 2);
  assert.deepEqual(once.actions, []);
  assert.equal(once.state.absent[scopedId(F1, "emma")], 1);
  const back = observe(once.state, ok([own, { familyId: F1, childId: "emma", role: "editor" }]));
  assert.deepEqual(back.actions, []);
  assert.deepEqual(back.state.absent, {});
  // Missing twice in a row: removed, and the family's scope with it.
  const gone = observe(observe(back.state, ok([own])).state, ok([own]));
  assert.deepEqual(gone.actions, [{ kind: "revoke", familyId: F1, childId: "emma" }, { kind: "dropScope", familyId: F1 }]);
  assert.equal(gone.state.revoked[scopedId(F1, "emma")].state, "pending");
  assert.deepEqual(sharedScopes(gone.state), []);
});

test("memberships: shared again before or after removal cancels it and downloads the child again", () => {
  const shared = observe(initialScopeState(U, HOME), ok([own, { familyId: F1, childId: "emma", role: "viewer" }])).state;
  const revoked = observe(observe(shared, ok([own])).state, ok([own])).state;
  const again = observe(revoked, ok([own, { familyId: F1, childId: "emma", role: "viewer" }]));
  assert.deepEqual(again.state.revoked, {});
  assert.deepEqual(again.actions, [{ kind: "fullResync", familyId: F1 }]);
});

test("memberships: another account's state is never used or changed", () => {
  const mine = observe(initialScopeState(U, HOME), ok([own, { familyId: F1, childId: "emma", role: "editor" }])).state;
  const other = "22222222-2222-4222-8222-222222222222";
  assert.throws(() => observeMemberships(mine, ok([]), { userId: other, now }));
  assert.deepEqual(scopeStateFor(mine, other, HOME), initialScopeState(other, HOME));
  assert.deepEqual(scopeStateFor(mine, U, HOME), mine);
});

// A small account space for the planner.
function space(records: Record<string, Record<string, unknown>[]>, outbox: OutboxEntry[] = []) {
  return { all: (c: string) => records[c] ?? [], outbox: () => outbox };
}
const entry = (collection: OutboxEntry["collection"], id: string, seq: number, extra: Partial<OutboxEntry> = {}): OutboxEntry =>
  ({ key: outboxKey(collection, id), collection, id, op: "put", seq, queuedAt: now, changedAt: now, deviceId: "d", ...extra });
const P1 = "photo-11111111-1111-4111-8111-111111111111", P2 = "photo-22222222-2222-4222-8222-222222222222", P3 = "photo-33333333-3333-4333-8333-333333333333";

test("removal plan: only that child of that family; the user's own family and other children are never touched", () => {
  const state = initialScopeState(U, HOME);
  const s = space({
    children: [{ id: "emma" }, { id: scopedId(F1, "emma"), familyId: F1 }, { id: scopedId(F1, "noah"), familyId: F1 }, { id: scopedId(F2, "emma"), familyId: F2 }],
    entries: [
      { id: "m-1", childId: "emma", photos: [] },
      { id: scopedId(F1, "m-1"), childId: scopedId(F1, "emma"), photos: [] },
      { id: scopedId(F1, "m-2"), childId: scopedId(F1, "noah"), photos: [] },
      { id: scopedId(F2, "m-1"), childId: scopedId(F2, "emma"), photos: [] },
    ],
    records: [{ id: scopedId(F1, "r-1"), childId: scopedId(F1, "emma") }, { id: "r-1", childId: "emma" }],
  });
  const plan = planRevocation(s, state, F1, "emma", now);
  assert.deepEqual(plan.deleteRecords, [
    { collection: "children", id: scopedId(F1, "emma") },
    { collection: "entries", id: scopedId(F1, "m-1") },
    { collection: "records", id: scopedId(F1, "r-1") },
  ]);
  assert.deepEqual(plan.archive, []);
  assert.throws(() => planRevocation(s, state, HOME, "emma", now), /never removed/, "a child of the user's own family they manage");
});

test("removal plan: a handed-over child of the user's own family takes only its own records and photos", () => {
  const state: ScopeState = { ...initialScopeState(U, HOME), revoked: { emma: { familyId: HOME, childId: "emma", since: now, state: "pending" } } };
  const edit = entry("entries", "m-1", 4);
  const s = space({
    children: [{ id: "emma", photo: P3 }, { id: "leo" }, { id: scopedId(F1, "emma"), familyId: F1 }],
    entries: [
      { id: "m-1", childId: "emma", text: "offline", photos: [P1, P2] },
      { id: "m-2", childId: "leo", photos: [P1] }, // the same Moment about leo keeps the shared photo
      { id: scopedId(F1, "m-1"), childId: scopedId(F1, "emma"), photos: [] },
    ],
    records: [{ id: "r-1", childId: "emma" }, { id: "r-2", childId: "leo" }],
    photos: [{ id: P1 }, { id: P2 }, { id: P3 }],
  }, [edit]);
  const plan = planRevocation(s, state, HOME, "emma", now);
  assert.deepEqual(plan.deleteRecords, [{ collection: "children", id: "emma" }, { collection: "entries", id: "m-1" }, { collection: "records", id: "r-1" }]);
  assert.deepEqual(plan.deletePhotos.sort(), [P2, P3].sort());
  assert.deepEqual(plan.outboxRemove, [{ key: edit.key, seq: 4 }]);
  assert.equal(plan.archive.length, 1, "the unsent edit is kept apart");
});

test("removal plan: a photo another remaining record shows is kept; one only the removed child shows goes", () => {
  const state = initialScopeState(U, HOME);
  const s = space({
    children: [{ id: scopedId(F1, "emma"), photo: P3 }, { id: scopedId(F1, "noah") }],
    entries: [
      // A Moment about both children: two copies, one photo.
      { id: scopedId(F1, "m-a"), childId: scopedId(F1, "emma"), photos: [P1, P2] },
      { id: scopedId(F1, "m-b"), childId: scopedId(F1, "noah"), photos: [P1] },
    ],
    photos: [{ id: P1, familyId: F1 }, { id: P2, familyId: F1 }, { id: P3, familyId: F1 }],
  });
  const plan = planRevocation(s, state, F1, "emma", now);
  assert.deepEqual(plan.deletePhotos.sort(), [P2, P3].sort());
  // Then noah too: now the shared photo goes.
  const after = space({ children: [{ id: scopedId(F1, "noah") }], entries: [{ id: scopedId(F1, "m-b"), childId: scopedId(F1, "noah"), photos: [P1] }], photos: [{ id: P1, familyId: F1 }] });
  assert.deepEqual(planRevocation(after, state, F1, "noah", now).deletePhotos, [P1]);
});

test("removal plan: unsent changes (and their kept versions) are archived first, never just dropped", () => {
  const state = initialScopeState(U, HOME);
  const e1 = entry("entries", scopedId(F1, "m-1"), 7);
  const v1 = entry("versions", scopedId(F1, "entries:m-1:3:text_conflict"), 8, { payload: { table: "entries", recordId: "m-1", version: { text: "lost" }, baseRev: 3, reason: "text_conflict" } });
  const homeEdit = entry("entries", "m-1", 9);
  const s = space({ children: [{ id: scopedId(F1, "emma") }], entries: [{ id: scopedId(F1, "m-1"), childId: scopedId(F1, "emma"), text: "offline edit", photos: [] }, { id: "m-1", childId: "emma", photos: [] }] }, [e1, v1, homeEdit]);
  const plan = planRevocation(s, state, F1, "emma", now);
  assert.deepEqual(plan.outboxRemove, [{ key: e1.key, seq: 7 }, { key: v1.key, seq: 8 }]);
  assert.equal(plan.archive.length, 2);
  assert.equal((plan.archive[0].value as { record: { text: string } }).record.text, "offline edit");
  assert.match(plan.archive[0].source, /^access-revoked:/);
});

test("adapters: the user's own family never sends a shared record; a shared scope sees only its own, with plain ids", () => {
  const out = [entry("entries", "m-1", 1), entry("entries", scopedId(F1, "m-1"), 2), entry("entries", scopedId(F2, "m-1"), 3), entry("photos", P1, 4), entry("photos", P2, 5)];
  const base = {
    outbox: () => out, syncRecord: () => undefined, record: async () => undefined, photoChecksum: async () => null,
    meta: () => ({ familyId: HOME, cursors: { entries: 10 }, deviceId: "d", scopeCursors: { [F1]: { entries: 4 } } }),
    commit: async () => "ok" as const, refresh: async () => {},
    photoFamily: (id: string) => (id === P2 ? F1 : undefined),
  } satisfies ScopeBase;
  assert.deepEqual(homeLocal(base).outbox().map(e => e.key), ["entries:m-1", `photos:${P1}`]);
  const f1 = scopedLocal(base, F1);
  assert.deepEqual(f1.outbox().map(e => e.key), ["entries:m-1", `photos:${P2}`]);
  assert.deepEqual(f1.meta().cursors, { entries: 4 }, "each family has its own cursors");
  assert.deepEqual(scopedLocal(base, F2).meta().cursors, {});
  assert.deepEqual(homeLocal(base).meta().cursors, { entries: 10 });
});
