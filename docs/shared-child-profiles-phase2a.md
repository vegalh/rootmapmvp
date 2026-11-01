# Shared Child Profiles: Phase 2a (multi-family sync foundation)

Phase 2a teaches the sync client to hold children from several families at once, safely, and leaves it switched off.
`sharedSyncEnabled` is `false` in `src/lib/sync/scopes.ts`, so the app makes exactly the single-family round it always
made. The new code runs only in tests, where it syncs against the real local server with real memberships and RLS.

Branch `feature/shared-child-profiles`, after Phase 1b (`05e6971`). No migration, no UI change, nothing on staging.
Done 2026-11-01.

## 1. Existing architecture (before Phase 2a)

Verified in code before changing anything:

- **Spaces.** One IndexedDB database per space: `rootmap` (guest, never touched while signed in) and
  `rootmap-account-<userId>`, one per account (`src/lib/data/schema.ts`). Account switching opens another database;
  sign-out keeps it on the device, hidden (`lib/cloud/space.ts`).
- **Local identity.** Every store is keyed by the record's `id` alone. Child-linked records refer to `childId`. Photo
  ids are `photo-<uuid>` (globally unique; the server checks the form). Seed children use fixed ids (`emma`, `noah`).
- **Family identity.** One per account: `SpaceMeta.familyId`, set on the first sync. The engine refuses a space that
  belongs to another family (`SyncStopped`).
- **Sync engine** (`lib/sync/engine.ts`). Push the outbox with conditional writes (insert if absent, or update at the
  known revision), resolving conflicts three-way (`resolver.ts`) and keeping losers in `record_versions`. Then pull
  each table `where family_id = own and change_seq > cursor`, one page per atomic local commit.
- **Cursors.** `SpaceMeta.cursors`: one per table, for the one family.
- **Outbox.** One entry per changed record, written in the same transaction as the record (`store.ts`), removed only
  if its `seq` is unchanged when the server confirms.
- **Refused writes.** A server refusal (`42501`) became a "failed" entry, retried every round, forever.
- **Photos** (`lib/sync/photos.ts`). Files upload to `<familyId>/<photoId>.<ext>` and are verified by `verify-photo`;
  other devices download them by the same path.
- **Runner** (`lib/sync/runner.ts`). Starts one round for `{ userId, familyId }`: records, the parent profile, photo
  files, and the guest import progress.
- **Guest import** (`lib/sync/guestImport.ts`). Copies guest records into the account space with origin checks; the
  ordinary sync uploads them.
- **Backup and restore** (`store.ts`). A file of the current space in the legacy format. Restoring while signed in
  soft-deletes newer records and queues that (Phase 0 finding, unchanged here).

## 2. New local identity model

The server's identity is `(family_id, id)`. The device now uses it too, without renaming anything that exists:

| Record | Local id | Child reference |
|---|---|---|
| The user's own family (all existing data) | `id`, unchanged | `childId`, unchanged |
| A shared family's child, Moment or activity record | `scopedId(familyId, id)` = `familyId` + U+001F + `id` | `scopedId(familyId, childId)` |
| A photo (any family) | `photo-<uuid>`, unchanged (already globally unique) | n/a; a shared photo carries `familyId` |

- **No collisions are possible.** The separator U+001F is a control character, and the server refuses control
  characters in every id (`check (… id !~ '[[:cntrl:]]')` on every table). So a scoped id can't equal any plain id,
  and two families' scoped ids differ in their prefix. The seed `emma` of the user's family, F1's `emma` and F2's
  `emma` are three different records. This is tested, including odd ids such as `a/b`, `x:y`, `名字` and the empty string.
- **Shared records also carry `familyId`**, so their family is known without parsing.
- **Nothing is rewritten.** Every record already on a device belongs to the user's own family and keeps its key.
  Outbox keys (`collection:id`) and sync records follow the local id, so they stay apart in the same way.

## 3. Migration strategy

- **Records:** none needed. See section 2. Existing guest and account data is read exactly as before.
- **Database version:** unchanged. The new fields live in the existing `meta` record and outbox entries, which are
  schemaless object stores.
  - `SpaceMeta.scopeCursors` (per shared family, per table) and `SpaceMeta.scopes` (membership state) are added the
    first time sharing runs. `SpaceMeta.cursors` stays the user's own family's.
  - `OutboxEntry.rejected` marks a refused change.
- **The first enabled round on an existing device is safe** (tested). The user's own family sends nothing, receives
  nothing, and its records and cursors stay byte-identical. Only the shared families are downloaded, into their own
  scopes.
- **Another account's leftover state is never used:** `scopeStateFor` checks the user and family. Its cursors are
  dropped and replaced. Tested.

## 4. Sync scope model

- **Home scope:** the user's own family, synced exactly as today through `homeLocal(base)`. That is the account space
  minus every shared family's entries, so nothing of another family can ever be sent into the user's own family. Same
  tables, cursors (`cursors`) and photo files.
- **Shared scope:** one per other family with children shared with the user, through `scopedLocal(base, familyId)`.
  The engine sees an ordinary single-family space with plain ids and that family's own cursors
  (`scopeCursors[familyId]`). The adapter translates every record, key and cursor it stores. The engine runs with
  `childIds`:
  - it pulls only `children` (by id), `entries` and `activity_records` (by `child_id`) for those children, plus the
    photos RLS lets the user read;
  - never plans, goals or saved items;
  - several children of one family share one scope and one set of cursors; different roles per child are fine,
    because the server enforces them per row (Phase 1b).
- **Cursors are isolated.** Each scope has its own per-table cursors. A change in F1 moves only F1's cursors, and F2's
  and the user's own stay put (tested).
- **`syncScopes()`** (one round): the user's own family; then, when enabled, the memberships, any removals, then each
  shared family. With `enabled: false` it is the old round. The runner now calls it, with the flag off.

## 5. Membership-aware synchronization

Memberships are read directly each round (`fetchMemberships`: the user's own rows of `child_memberships`, ordered).
Record cursors are not used to discover access, because rows that become visible keep their old change numbers. The
answer goes through a pure state machine, `observeMemberships` (`ScopeState`, kept in `SpaceMeta.scopes`):

| Event | Detected as | Action |
|---|---|---|
| New membership | a shared child not in `shared` | confirmed at once; **`fullResync`**: that family's cursors reset to 0, so records older than the cursor are downloaded (tested with a child shared late) |
| Role change | same child, different role | role updated; **`clearRejections`**: refused changes for that family may be sent again (once) |
| Ownership transfer | role changes on both sides | same as a role change; no data moves (tested) |
| Membership removed | a shared child missing from a successful answer | counted in `absent`; after **2 answers in a row**, **`revoke`** (and **`dropScope`** if the family has no shared child left) |
| Child soft-deleted by its owner | an ordinary record change (`deletedAt`) | nothing special: members keep read access (Phase 1b), so the child stays on the device marked deleted (tested) |
| Child removed by a server job | its memberships cascade away | handled as a removal |
| Shared again | back before or after removal | pending removal cancelled; `fullResync` brings removed data back |

What never counts as losing access:

- an unknown answer (offline, error, timeout);
- an answer that leaves out the user's **own** children while some are stored here (`homeChildren`); the user owns
  them, so such an answer can't be right;
- a single missing answer.

The user's own family is never a shared scope and is never removed.

## 6. Revocation cleanup strategy

Removal is an explicit, persisted state per child (`Revocation`: `pending` → `done`), carried out by `runRevocations`.

- **Plan** (`planRevocation`, pure). Removes the child, its Moments and activity records (only that family's), their
  sync state, and the photos they show **that no remaining record on the device shows**. A Moment about two children
  keeps its photo while the other child is still shared; this is tested, as is the photo going with the last child.
  It refuses the user's own family outright.
- **Unsent changes are kept, not destroyed.** Every changed record of that child that is still in the outbox, and every
  kept version waiting to be sent, is copied into the existing local `archive` store first. Each copy keeps the record
  and its outbox entry, with `source: "access-revoked:<family>/<child>"`. They are never synced and never shown in
  lists. Recovery policy: they stay on the device until the parent exports or discards them (UI in Phase 3). The
  removal records how many were archived.
- **Atomic.** The whole removal and its `done` state are one commit (`commitCleanup`). An interrupted device has either
  removed a child completely or not at all, and finishes on the next round, because the plan is recomputed from what
  is stored. Tested with an interruption.
- **Refused writes stop retrying.** A `42501` on push now marks the outbox entry `rejected` for that `seq`, and the
  engine reports it without sending it again. This covers a refused insert, a refused version, and a row that became
  invisible. It also covers an update RLS silently ignored: the server still has the revision the update was made
  against, so it wasn't a conflict. The mark goes away when the record is edited again (new `seq`) or the user's role
  for that family changes. Tested: lowered role → refused once, not resent, then sent after the role is restored.
- **Account switching.** All of this lives in the account's own database, and state from another account is ignored.

## 7. Compatibility with existing data and behaviour

- With the flag off, the runner's round is `syncScopes(…, enabled: false)`, which is `syncRound(homeLocal(local))`.
  `homeLocal` filters nothing while no shared record exists. Every existing suite passes unchanged: unit, database,
  browser, and the cloud browser suites (sync, spaces, guest import, photos).
- **Engine changes that affect today's users.** Only refused writes:
  - a `42501` is now marked and not retried every round;
  - an update RLS hid (previously misreported as "keeps changing on the server" and retried forever) is now a refusal.
  Neither can happen to a parent syncing their own family (they own every child).
- **Store changes** (`store.ts`, `commitSync`), additive: it applies `outboxMark` (only while the entry's `seq` is
  unchanged) and stores `meta.scopeCursors` and `meta.scopes`. `syncMeta()` exposes both.
- **Runner:** the photo-file sync now takes only the user's own family's photos (a shared photo carries `familyId`;
  none exist yet).
- **Unchanged:**
  - UI, My Week, recommendations, guest experience, child creation, guest import;
  - photo paths, authentication, backup and restore;
  - the database (no migration).

## 8. Tests

New:

- `tests/unit/scopes.test.ts`, 11 tests: identity (no collisions, odd ids), membership transitions (new, several per
  family, role change, transfer, unknown answer, the own-children guard, one-off gap, confirmed removal, shared again,
  another account), the removal plan (only that child and family, own family refused, photo preservation, archiving
  unsent changes and versions), and the adapters (own family never sends shared records; per-family cursors).
- `tests/db/multiFamilySync.test.ts`, 11 tests against the local server. Three families each have a child `emma`, and
  two have a Moment `m-1`.

| Required case | Where |
|---|---|
| Same record id in different families | db "existing data stays … the same ids never meet" (`m-1`); unit identity |
| Same child id in different families | same (`emma` × 3) |
| Local migration of existing data | db: first enabled round, own family byte-identical, nothing re-sent or re-received |
| Multi-family cursor isolation | db "each family has its own cursors"; unit adapters |
| Membership addition | db "a newly shared child arrives with all its earlier records" |
| Membership removal | db "losing the network …", "a change made offline …", "when the last child …" |
| Role changes | db "an editor's change … role drops to viewer … restored"; "an ownership transfer …" |
| Account switching | db "another account on the same device …"; unit "another account's state …" |
| Interrupted synchronization | db interrupted removal; existing `sync.test.ts` interruption cases, unchanged |
| Offline edits after revocation | db "a change made offline after access was removed …" (archived, never reached the server) |
| Shared photo reference preservation | db (kept while emma shows it; gone with the last child); unit removal plan |
| Existing single-family synchronization | db "switched off …"; all existing suites unchanged |

Results on 2026-11-01, local stack:

| Command | Result | Before |
|---|---|---|
| `npm run typecheck` | clean | clean |
| `npm test` | **197 / 197** | 186 / 186 |
| `npm run test:db` | **219 / 219** (54 suites) | 208 / 208 |
| `npm run test:e2e` | 152 / 152 | 152 / 152 |
| `npm run test:e2e:cloud` | 55 / 55 | 55 / 55 |

**Two intermittent failures came up during the runs.** Each was investigated, not ignored:

- The new "existing data …" test compared actions in server order, which isn't guaranteed. The membership query is now
  ordered, and the assertion doesn't depend on order. It passed in 7 runs afterwards.
- `analytics.test.ts` "ages are completed years …" failed once in a full run and passed on rerun (19/19). It predates
  this phase: it picks a random age between 200 and 899, and the local database now holds hundreds of earlier test
  children, so a collision with an earlier pick is increasingly likely. It is unrelated to sync and was left unchanged.
  It is worth making that test independent of earlier runs.

## 9. Remaining Phase 2b work

- [ ] **IndexedDB side of cleanup.** `store.ts` implements `all()` and `commitCleanup()`: delete records, photo
      metadata and bytes, sync records and outbox entries, write archive items and the scope state, in one transaction.
      Browser test, including a reload mid-cleanup.
- [ ] **Shared photo files.** Run `syncPhotos` per shared family (download by the photo's family path). Add the
      child-scoped photo upload for editors (Phase 1b known limitation): a server function, or a child hint checked
      against the membership.
- [ ] **Runner wiring behind the flag:** pass `homeChildren` (the user's stored children), hold the state across tabs
      (Web Locks already serialize rounds), and show refused and archived counts in the backup status.
- [ ] **Keep shared records out of** backup export and restore, guest import candidates, and analytics; restoring must
      never write shared records.
- [ ] **Decide** what members see of a soft-deleted shared child (product), and how archived changes are exported or
      discarded (UI, Phase 3).
- [ ] **Turn on** `sharedSyncEnabled` only together with invitations (Phase 4), after the staging blockers from Phase 0
      are cleared.
