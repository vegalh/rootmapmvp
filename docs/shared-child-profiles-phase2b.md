# Shared Child Profiles: Phase 2b (device integration, shared photos, data safety)

Phase 2b connects the Phase 2a multi-family sync to the real browser database, the runner and photo files, and makes
backup, restore and guest import safe around shared data. Real browsers proved it end to end: 17 multi-user steps
against the local stack.

Shared sync stays **off** in the app. It is switched on only by a development server started with
`VITE_ROOTMAP_SHARED_SYNC=on` (the browser tests). `sharedSyncEnabled` also requires `MODE === "development"`, so a
production or staging build can't enable it, whatever its variables say. No invitation or membership UI exists;
memberships are made by the server.

Branch `feature/shared-child-profiles`, after Phase 2a (`c4b2bd7`). One new migration, local only. Done 2026-11-01.

## 1. Real IndexedDB integration

| Piece | Where | What it does |
|---|---|---|
| Family-scoped ids on write | `store.ts` `withSharedIds` | Screens create a new Moment or activity record with a plain id. If its `childId` is a shared child, the store saves it under that family's scoped id, with `familyId`. Without this, a Moment written for a shared child would look like the user's own and be pushed into the wrong family (found by the browser tests). |
| Scope state and cursors | `store.ts` `commitSync` (Phase 2a) | `SpaceMeta.scopes` and `scopeCursors` persist with each sync commit. |
| Removal | `store.ts` `commitCleanup`, `cleanupRecords` | One IndexedDB transaction over `children`, `entries`, `records`, `photos`, `photoBlobs`, `syncRecords`, `outbox`, `archive` and `meta`. It checks the outbox `seq` on disk first, then deletes, archives and stores the new scope state, all or nothing. Memory and screens are updated only after it commits. |
| Hidden while pending | `store.ts` `publish` / `visibleCollections` | A child whose removal is `pending` is filtered out of what screens get (with its Moments and records) from the moment the removal is decided, including on every start-up. The full cache keeps it, because sync and the removal itself read it. Lists and `useCollection` diffs only see shown records, so screens can't write it back. |
| Other tabs | `store.ts` `refreshFromDisk` | Reloads when another tab advanced any cursor, scope cursor or scope state, not only the user's own cursors. |
| Runner | `runner.ts` | Passes the user's own stored children as `homeChildren` (the guard against an answer that leaves them out). Gives the cleanup the real store. Merges shared results into the backup status (keys are local, so a shared `entries:m-1` can't be confused with the user's own). Runs photo-file sync per family. |
| Engine reporting | `scopes.ts` `syncScopes` | Shared rounds' `notSent` keys are translated to this device's keys. |

**Existing single-family sync is unchanged.** With the flag off the round is the Phase 2a `syncScopes(enabled: false)`,
and every existing suite passes as before. The one change that affects everyone is in `lib/cloud/client.ts`: photo
file requests skip the browser's HTTP cache (section 3).

## 2. Revocation cleanup

The Phase 2a rules are unchanged:

- a membership must be missing from **two successful answers in a row** before anything is removed (kept on purpose:
  one odd answer must never delete data);
- unknown answers (offline, error) never count;
- an answer that leaves out the user's own children is ignored;
- the user's own family is never removed.

Real-device behaviour:

| Situation | Result | Proved by |
|---|---|---|
| Removed while the device was offline, with a change made offline | The change is refused once (marked, never resent). On confirmation the child, its records and their sync state are removed, and the change is archived with its outbox entry. Leo, P's child and the user's own child stay. A photo still shown by Leo's Moment stays; a photo only Mia showed goes. The refused change never reached the owner's family. | browser step 6 |
| Removed while away, then reconnecting | Removed after two answers, nothing archived, the family's cursors dropped | browser step 7 |
| Reload while a removal is pending | Hidden at once and after the reload (My Children, Moments), still on disk. Once the device carries on, it is removed in one transaction, and the photo goes with the last child showing it. | browser step 8 |
| Temporary network failure | Status "offline", nothing marked refused, sent on reconnect | browser step 5; db tests (Phase 2a) |
| Interrupted removal | IndexedDB applies a transaction fully or not at all. The test stops the device before the transaction (a development-only hook, `__rootmapHoldCleanup`), which is the state a crash or reload leaves. The removal stays `pending` and finishes on a later round. | browser step 8; db test (Phase 2a) |
| Archived changes | Kept in the account's own `archive` store. Never loaded into memory, shown or synced. Not visible to another account on the same browser. | browser steps 6 and 9 |

**Recovery policy for archived changes:** they stay on the device until the parent exports or discards them. The
screen for that is Phase 3.

## 3. Photo synchronization

**Database** (migration `20261101000300_shared_photos.sql`):

- `photos.child_id`, set once with the new row, is the child a photo was added for. Anyone who can **write** that
  child (owner or editor) may add the photo, in the child's family, at the usual path `<family_id>/<photo_id>.<ext>`.
- Until a Moment or the child's profile shows it, the photo is readable by that child's members and writable by its
  writers, and by **no one else**, not even family members without a role on that child.
- Once shown, it follows the children that show it (Phase 1b, unchanged). Photos a family adds for itself (no
  `child_id`) behave exactly as before.
- Viewers, outsiders and editors of another child can't add one. `child_id` can't change. An editor's photo for a
  child that doesn't exist is refused.
- The row and storage permissions use the same helper, so they agree: `photo_access(fid, pid, want_write, hint)`. The
  policies pass the row's own `child_id`, because `insert … returning` is checked before the new row can be read back.
- `verify-photo` is unchanged: it reads the row with the caller's token, so RLS decides.

**Client:**

- `sharedPhotoAssignments` (`scopes.ts`): a photo not yet uploaded and shown only by one shared family's records is
  assigned to that family, with the child as `childHint`. `mapping.ts` sends it as `child_id` once, with the new row
  (`INSERT_ONLY`). The user's own photos never send it, so they keep working against a server without the column.
- Photo files sync per family (`familyPhotos`). Each photo is uploaded to and downloaded from its own family's folder.

**Signed URLs:**

- A revoked member can't create a new one (storage policy; tested).
- One created before revocation keeps working until it expires. Supabase signed URLs are self-contained,
  time-limited links that aren't checked against memberships when used (tested with a 60 s link).
- The app itself never creates signed URLs. It downloads files through the session and keeps its own copy in
  IndexedDB.

**HTTP cache: a real finding, fixed.** A browser test first showed account W, signed in after E on the same browser,
"downloading" O's private photo without an error. The browser had served E's earlier download from its HTTP cache,
which is keyed by address, not by account. Photo file requests now use `cache: "no-store"` (`lib/cloud/client.ts`),
and the same test then passes. The app's own per-account IndexedDB copy is unaffected.

## 4. Backup and restore changes

- **Backups** (`backupData`) leave out every shared child, record, photo and draft (`isShared`). Tested: none of the
  shared names, family ids, separator or photo ids appear in the file.
- **Restoring in the guest space: unchanged semantics.** The device's data is replaced, and records not in the file
  are soft-deleted. That space has no shared data and nothing in the cloud.
- **Restoring while signed in: add-only.**
  - Records the account doesn't have are added and backed up.
  - Every record it has stays exactly as it is: not reverted, not soft-deleted, so nothing is deleted on the server.
  - Settings and drafts likewise: only missing ones are added.
  - Shared records are never touched, and are never taken from a file.
  - Before Phase 2b, restoring an older file while signed in soft-deleted, and uploaded the deletion of, everything
    added since (the Phase 0 finding), and reverted newer edits.
  - The Backup page now says so when signed in, in English and Chinese (`restoreWarningAccount`), instead of "replaces
    all data".
- **Not offered:** destructive replacement of an account's data. If ever needed, it should be a separate, deliberate
  action with its own confirmation.
- **Existing backup files** stay readable (same format, version 1). Nothing about exporting changed for the user's own
  data.

## 5. Guest import protections

- The runner gives guest import only the user's own records and photos (`isShared` filtered), and guest import filters
  them again itself (`prepareGuestImport`).
- So a shared child is never offered as "the same child?", guest data is never copied onto or matched with it, and
  shared records can't be overwritten.
- Tested: a guest child with the shared child's name joins the user's own family, without the duplicate question, and
  the shared family is untouched.

## 6. Test results

All on 2026-11-01 against the local stack.

| Command | Result | Before Phase 2b |
|---|---|---|
| `npm run typecheck` | clean | clean |
| `npm test` | 197 / 197 | 197 / 197 |
| `npm run test:db` | **223 / 223** (55 suites), twice | 219 / 219 |
| `npm run test:e2e` | 152 / 152 | 152 / 152 |
| `npm run test:e2e:cloud` | **72 / 72** (6 suites, incl. the new `sharing.mjs` 17 / 17) | 55 / 55 |

`sharing.mjs` also passed 17/17 on two separate standalone runs before the full run.

**New tests:**

- `tests/e2e/sharing.mjs` (added to `test:e2e:cloud`), with real browsers, IndexedDB, runner and sync. It covers the
  15 required cases (numbered as in the request) plus set-up. The refusal checks are in step 4: a viewer's change and
  a viewer's photo refused and not resent (no further `PATCH` requests counted); an update RLS ignored detected as a
  refusal; promotion to editor sends the refused change; a network failure stays retryable (step 5).
- `tests/db/childAccess.test.ts`, 4 more (29): an editor adds a photo for the shared child (row, file, verification,
  path in the child's family); who sees it before a Moment shows it; who can't add one or change its child; signed
  URLs before and after revocation.

**Failures found along the way, and what they were:**

| Failure | Cause | Fix |
|---|---|---|
| Moments for a shared child stuck, leaked into backups | Screens create plain ids (real gap) | `withSharedIds` in the store |
| Another account read a private photo | Browser HTTP cache (real finding) | `cache: "no-store"` for photo files |
| Editor's photo upload refused | `insert … returning` checked before the row exists (my migration) | Policies pass the row's `child_id` |
| A photo added for a child readable by family members without a role (found reviewing my migration) | Fallback to the family | Child-only until shown |
| Offline edit "lost" to V's change | Expected conflict rule (my test) | Test waits for V's change first |
| `spaces.mjs` "guest child is on no server" | My suite used the id `c-guest`, which `spaces.mjs` checks globally | Renamed; deleted my 5 leftover test rows in my test accounts only |
| Phase 2a db tests expected server keys in `notSent` | Intended change to local keys | Tests updated |

**The known intermittent analytics test** (`analytics.test.ts` "ages are completed years …") did not fail in either
full database run this phase. Its cause (a random age colliding with earlier runs' test children in the local
database) is unchanged, so it can still fail occasionally; it was left alone.

**Not run:** the new migration on an empty database (CI's `db-tests.yml` does it), and the Linux CI workflow.

## 7. Remaining risks

- **Screens are not role-aware yet.** With the flag on, a viewer can edit locally. The server refuses it, it is
  marked, and not resent, but the screen doesn't say why. A shared child can be chosen in places that don't support
  it yet: My Week plans are family-scoped, and moving a record to a child in another family makes a copy, because the
  server never moves rows between families. That is Phase 3.
- **A photo used by both the user's own and a shared child's Moment** stays the user's photo, so the shared Moment
  waits for it forever. Phase 3 should copy the photo instead.
- **No UI yet** for archived changes (export or discard), or for refused and removed counts.
- **Members keep read access to a soft-deleted shared child** (product decision still open).
- **Signed URLs** created before revocation work until expiry (inherent to Supabase signed URLs). The app doesn't
  create any.
- **Staging blockers from Phase 0 still stand:** no backups, deployment not gated on tests, no undo migrations.

## 8. Requirements for Phase 3

- [ ] Role-aware screens from `ScopeState.shared`:
  - hide editing for viewers;
  - core profile fields owner-only;
  - choosers offer only writable children;
  - no moving records across families;
  - copy a photo instead of sharing one between families.
- [ ] My Children: shared children with their family and role; a "no longer shared" notice from `ScopeState.revoked`
      (with the number of archived changes); export or discard of archived changes.
- [ ] Status: show refused (`rejected`) changes and photos separately from "waiting".
- [ ] Decide what members see of a soft-deleted shared child.
- [ ] Invitations and membership management (Phase 4) remain server functions; turn `sharedSyncEnabled` on for
      production builds only with them, after the Phase 0 staging blockers are cleared.
