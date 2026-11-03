# Shared Child Profiles: Phase 5 (writing together)

Phase 5 is the smallest practical step toward real families using shared profiles day to day. It builds only on what
Phases 1–4 and the release-readiness follow-up already provide. Branch `feature/shared-child-profiles-phase5`, from
`main` after PR #4 (`e35e944`). One new migration, applied to the local stack only. Sharing stays switched off unless
the build sets `VITE_ROOTMAP_SHARED_SYNC=on` (see [the tester rollout](shared-child-profiles-tester-rollout.md)).

## 1. What was already complete (reviewed, not rebuilt)

| Priority | Status before this phase | Where |
|---|---|---|
| 1. Invitations and acceptance | Complete: single-use, 7-day, hashed, rate-limited links; optional email restriction; signed-out deep link; preview before accepting; token out of the address bar before third-party scripts; join notices | `20261101000500_invitations.sql`, `20261102000100_circle_joins.sql`, `InvitePage.tsx`, `ChildCircle.tsx`, `lib/inviteToken.ts` |
| 2. Members and roles | Complete: one Owner (trigger `t50_one_owner`); Owner-only role change, removal, revocation; leave for others; relationship labels; Circle refresh | `child_memberships`, `ChildCircle.tsx`, `lib/childAccess.ts` |
| Child identity | Owner-only, in RLS (`children_update`) and trigger (`require_child_access`); the UI offers Edit Profile only with Manage | `20261101000200_child_access.sql`, `ChildProfilePage.tsx` |
| 3. Editing Moments and Journal | Editors add, edit, delete; viewers read only (server-enforced); concurrent edits merge field by field, the losing version kept and shown on the Moment | `lib/sync/resolver.ts`, `KeptVersions.tsx` |
| 4. Sync across accounts and devices | Complete: per-family scopes and cursors, removal cleanup, archived unsent edits, shared photos | `lib/sync/scopes.ts`, `lib/sync/photos.ts` |
| 5. Mobile and desktop | Phone-sized browser tests (iPhone/Android/WeChat user agents); no physical device yet | `tests/e2e/multiAccount.mjs` |

What was missing for families writing together:

- A Moment never said **who wrote it**. With a grandparent and a co-parent writing in the same Journal, every entry
  looked like the reader's own.
- A parent whose edit **lost a concurrent change** was never told (S4, "a notice at the moment of conflict"); the
  kept version was only visible to someone who happened to open that Moment.
- Where neither Web Share nor the clipboard works (WeChat's and other in-app browsers), the Owner **could not get
  the invitation link** at all (release readiness, "Link sharing fallback").

## 2. What this phase adds

### 2.1 Who wrote a Moment

Migration `20261103000100_entry_authors.sql`:

- `entries.created_by`: set by a trigger (`t91_created_by`) to `auth.uid()` on insert and kept unchanged on every
  update. Clients have no column grant, so sending it is refused, and the trigger overwrites it anyway.
  `updated_by` (set by `stamp_row` since Phase 2) already records who changed it last.
- Existing rows keep `created_by` null. Filling them in would rewrite every row (revision, change number,
  `updated_by`) and make every device download them again. They were written before sharing existed, so the
  Moment page shows no "Added by" line for them.
- `entry_people(family_id, entry_id)`, `SECURITY DEFINER`: for anyone with a role on the Moment's child (the same
  test as `entries_select`), who added it and who last changed it, with display name, relationship and `is_me`.
  It never returns a user id or email (the circle hides member ids from everyone except the Owner, and this keeps
  to that). Someone who has left the circle is returned without a name. An outsider gets `42501`, the same answer
  as for a Moment that doesn't exist.

App (`components/EntryAuthors.tsx`, on the Moment page under the child and date, only where sharing is on):

- "Added by Grandma Wu (Grandma)" / "由Grandma Wu（奶奶）添加", and "Last changed by Ben" when someone else changed it.
- Nothing at all when the reader added and last changed it themselves. A Journal kept by one parent looks exactly
  as before.
- Read again when the Moment changes (`updatedAt`); offline, nothing is shown.

### 2.2 Telling a parent their change was kept, not shown

- `lib/sync/engine.ts`: `RoundResult.keptEdits` lists the Moments whose text or fields changed on this device lost to
  a change that reached the server first (`text_conflict` / `field_conflict`; those reasons always keep this
  device's version). Both places a version is kept report it: the push-side resolution and a version queued by the
  pull. `edited_after_delete` isn't reported: the Moment is gone.
- `lib/sync/runner.ts` adds them (as local ids, scoped per family) to the device-only setting `rootmap-kept-edits`.
- My Children shows "Someone else changed “Ducks” at the same time as you. Their version is shown; yours is kept on
  the Moment." with **View Moment**. Opening the Moment from anywhere clears its note; **Done** clears them all. Only
  where sharing is on, like the kept versions themselves.
- No resolver change: who wins and what is kept are exactly as before.

### 2.3 Invitation link when Copy and Share both fail

- `ChildCircle.tsx`: if copying or sharing fails (not a cancelled share sheet), the link appears in a read-only
  field ("Copying didn’t work here. Press and hold the link to copy it, then send it."). It is shown only after a
  failure, only to the Owner who just created it, and only in this sheet. It is cleared with "Invite Someone Else".
- Nothing else about token handling changes: it is still returned once, never stored or logged, and never in a toast.

## 3. Permission model (unchanged, re-checked)

- Exactly one Owner per child: no change to memberships or `t50_one_owner`.
- Editors edit growth records, never the child's identity: `children_update` and `require_child_access` unchanged.
- Viewers read only: `entry_people` gives them names, and nothing they can write.
- Only the Owner manages members and identity: no new member function.
- No RLS policy was added, dropped or loosened. The one new function re-checks the caller's role on every call.

## 4. Tests (risk-based, extending existing suites)

| Risk | Covered by |
|---|---|
| A client claims or rewrites who added a Moment | `tests/db/entryAuthors.test.ts` (new, 4 tests): insert and update refused, trigger sets and keeps it |
| Names leak to outsiders, or ids/emails to members | `entryAuthors.test.ts`: outsider refused like a missing Moment; no id or email in answers; a member who left isn't named |
| A conflict isn't reported, or a non-Moment is | `tests/db/sync.test.ts`: two existing conflict tests now also check `keptEdits` |
| The whole flow across two accounts | `tests/e2e/multiAccount.mjs`, concurrent-edit step: Ben (whose text lost) gets the note, Ana doesn't; opening the Moment clears it; "Added by Ana" on Ben's view, nothing on Ana's own Moment, "Added by Ben" on Ana's view of his |

No new test infrastructure. The link fallback isn't automated (headless Chrome grants clipboard access). It needs
the WeChat check in the real-device checklist (release readiness, section H, step 11).

### Results (this Mac, local stack only, 2026-11-03)

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | **213 / 213** (unchanged) |
| `npm run test:db` | **263 / 263** (+4, `entryAuthors.test.ts`) |
| `npm run test:e2e` | **all 14 suites passed** |
| `npm run test:e2e:cloud` | **117 / 117** (10 suites; `multiAccount.mjs` 17/17 with the new assertions) |
| `npm run build` | builds (the existing chunk-size warning only) |

Problems found while testing:

- **Fixed (mine):** the Moment page gave the authors line and the kept versions the same React key, so React
  warned about duplicate keys. The authors line now has its own key.
- **Seen once, not reproduced:** in one full `test:e2e:cloud` run, `multiAccount.mjs` failed its "Ana removes Ben"
  step. That step wasn't changed. It passed in five separate runs and in the final full chain. The failure detail
  wasn't captured.
- **Seen once, environmental:** in another full run, `invitations.mjs` stopped making progress after its second step
  (idle, no CPU) and was stopped. Alone it passed 14/14, and the final full chain passed. This looks like the known
  sign-in-code flake (PR readiness 11.9, item 3); the local auth server allows 2 emails per hour
  (`supabase/config.toml`).

`tests/ops/oldSchema.mjs` now also treats `entry_people` and `entries.created_by` as sharing objects the app must not
touch against the pre-sharing database. It wasn't run this session: it needs a disposable stack reset to the
pre-sharing migrations. CI runs it.

## 5. What remains

- **Ownership transfer** (an Owner handing management to a co-parent). Still out of scope. It is the one membership
  change that touches the one-owner rule, so it needs its own design and tests.
- **Authorship on lists** (Journal cards, Moments). Only the Moment page shows it. Lists would need `created_by`
  synced into local records and names for user ids, which the circle hides from members today.
- **Activity records**: no author line and no kept-edit note. Moments only, as in Phase 4's kept versions.
- **Restoring a kept version with one tap.** Today the kept text can be read and copied.
- **Physical devices, real Safari/WebKit, WeChat**: still untested (release readiness, section H). That includes
  this phase's link fallback.

## 6. Rollout

The original staging blockers were written for a public launch. For the existing testers, the shortest path is in
[shared-child-profiles-tester-rollout.md](shared-child-profiles-tester-rollout.md): merge, apply the 7 migrations
after a data dump, then set one repository variable. Both remote steps wait for the owner's approval.
