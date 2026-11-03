# Shared Child Profiles: release readiness review

A review of Shared Child Profiles (Phases 0–4) before controlled testing, with the fixes it needed. This is not
Phase 5: no new product feature was built. Branch `feature/shared-child-profiles`, from `c19f10e` (Phase 4). Done
2026-11-01/02 on one Mac, against local Supabase stacks only. Nothing was pushed, merged or deployed, and staging
was not touched or queried. The code and test changes are in commit `c9bef56` (made on this branch during the
review). This report and the analytics test fix are in the commit after it.

Labels: **Verified** = checked by a command or test in this session, with the result stated. **From the repo** =
read in code or docs, not executed. **Unverified** = not checked (says why).

---

## A. Executive summary

**Recommendation: READY FOR LOCAL CONTROLLED TESTING** (level 2 of 4). Section J explains why it isn't higher.

**Update, 2026-11-02 (section K):** the follow-up fixed S2 (token out of the address before any third-party script
can load), S10 (an owner's own link stays unused) and the visible part of S4 (kept versions shown on the Moment).
It added join notices (S1, with the owner's decision to keep links without an email restriction) and Recently
Deleted for shared records (S5, with the owner's decision that editors may delete). The blockers list below is
updated; the original text is kept where it records what was true at the time.

What holds up (verified):

- Server-side rules: invitations, memberships, roles, removal, soft-deleted children, photo access and ownership.
  Every database test passes, on the long-lived local database and on a database built from empty. The security
  audit found no Critical or High issue.
- Migrations: all 15 apply in order to an empty database. A pre-sharing database with representative data upgrades
  with its content unchanged. The backfill refuses unclear ownership and rolls back completely.
- The full two-account story through real browser profiles: invite, accept on an emulated phone, sync, photo,
  edits, concurrent edits, View Only, removal and cleanup.
- Feature flags: real production and staging builds can't open an invitation or switch on shared sync. With the
  flag unset, a signed-in parent sees exactly the old behaviour.
- A backup-and-restore rehearsal of database and photo files, on disposable data.

Fixed in this review: the Circle now refreshes in place (section 2 of the brief). Declining an invitation no longer
leaves its token in browser history. Record reads are kept out of the browser's HTTP cache. A pre-existing race in
`invitations.mjs` made it fail every time; it is fixed. CI now blocks deployment when tests fail (not pushed).

Blockers before staging, all outside this branch's code:

1. Staging has no database or photo backups (verified in Phase 0; not re-checked, since this session must not
   touch staging).
2. The CI changes are not pushed. The browser workflow has never been confirmed green on Linux, and branch
   protection is not verified.
3. Nothing has been tested on a physical phone, in real Safari/WebKit or in WeChat.
4. ~~A third-party script may see the invitation token (S2).~~ Fixed (section K).
5. Shared sync can't be enabled on staging without a deliberate code change. That is by design, and it still needs
   to be designed.
6. ~~Owner decisions open on S1 and S5.~~ Decided; notices and Recently Deleted built (section K).

## B. Architecture

```
Owner's device                     Supabase (Postgres + Storage)                     Member's device
──────────────                     ─────────────────────────────                     ───────────────
Circle › Manage ── create_invitation ──▶ child_invitations (token_hash only)
  link #/invite/<token> ──(owner shares it: copy / Web Share; never shown as text)──▶ opens link
                                                                                     signed out → sign-in gate,
                                                                                     hash kept through reload
                                     get_invitation_preview ◀── (signed in) ─────────  preview: child first name,
                                     accept_invitation ◀────── Accept ───────────────  family name, role, inviter
                                       locks invitation row, re-validates,
                                       inserts child_memberships (editor/viewer)
                                     RLS: private.child_role(fid, cid) decides every
                                       read/write on children, entries,
                                       activity_records, photos (+ files), versions
                       sync (30 s, on focus/online) ─────────────────────────────── sync: memberships read each
                       home family scope                                             round → shared scope per
                                                                                     family (own cursors,
                                                                                     scoped local ids)
Circle refresh (this review) ◀── child_circle / list_invitations
remove_member / set_member_role ──▶ child_memberships row deleted/updated ─────────▶ refusals (42501) marked, not
                                                                                     resent; 2 successful answers
                                                                                     without the child → removal
                                                                                     (unsent changes archived)
```

- **Invitations** (Phase 4): 192-bit random token, stored only as a SHA-256 hash. Single-use, 7-day expiry,
  revocable, optionally bound to a verified email, rate-limited per account. Acceptance is one locked transaction.
- **Membership and access** (Phases 1a/1b/3): `child_memberships` is the only source of a role. Clients can't write
  it, and every child has exactly one owner (unique index plus deferred trigger). RLS and `t00_access` triggers ask
  `private.child_role`. A soft-deleted child is visible only to its owner.
- **Sync** (Phases 2a/2b): the user's own family syncs as before. Each other family with a shared child is a
  separate scope, with family-scoped local ids (`familyId` U+001F `id`) and its own cursors. Memberships are read on
  every round. A new membership triggers a full re-sync of that scope. Removal needs two successful answers in a
  row. Refused writes are marked and never resent. Unsent changes are archived on removal.
- **Photos** (Phases 1b/2b/3): a photo belongs to one family. It is readable through the children whose Moments or
  profile show it. Editors upload with `photos.child_id`. A Moment about children of two families gets a copy of
  the photo per family. Files are verified by `verify-photo`, and file requests skip the HTTP cache.
- **Concurrency:** eventual synchronization, not real-time collaborative editing (section D, "Concurrent editing").

## C. Security findings

Scope reviewed: the five Shared Child Profiles migrations and the earlier RLS and storage policies, every SECURITY
DEFINER function, function grants, token handling, invitation expiry and email binding, removal, ownership, photos
and signed URLs, account switching, IndexedDB, HTTP caching, backups and archived edits. Cross-family leakage got
particular attention.

**Audit queries (verified, local database, read-only):**

- No SECURITY DEFINER function in `public` or `private` lacks a fixed `search_path` (query returned no rows).
- `anon` can execute exactly one function in those schemas: `public.record_usage` (analytics, by design).
- RLS is on for all 16 public tables. `anon` has no select on any of them.
- `child_memberships` and `child_invitations` have no client insert or delete privilege.
- `private` is not exposed through the API (`[api] schemas = ["public", "graphql_public"]`). `anon` has no usage on
  it.
- The 15 client-callable SECURITY DEFINER functions each check `auth.uid()` and the caller's role themselves (read
  in the migrations).

**Findings.** No Critical or High issue was found.

| # | Severity | Finding | Evidence | Fix / status | Remaining risk |
|---|---|---|---|---|---|
| S1 | Medium | **A forwarded link admits whoever opens it first.** An invitation without an email restriction can be accepted by any signed-in account holding the link, for example after it is reposted in a group chat. The owner is not notified. | `accept_invitation` (by design, Phase 4 §4) | **Mitigated (section K).** Owner decision: links without an email restriction stay, for WeChat and messaging apps. The person managing the profile now gets a "Nina joined Emma's Circle" notice, recorded atomically with the acceptance, and can review and remove. | Someone unintended can still join before the owner notices; they then see the child's shared records until removed. |
| S2 | Medium (unverified) | **A third-party script may see the token.** On the sign-in gate the address bar holds `#/invite/<token>`. Staging builds with `VITE_TURNSTILE_SITE_KEY` load Cloudflare's Turnstile script there, and it can read `location.href`. Whether it sends the fragment anywhere was not verified. | `lib/cloud/captcha.ts`, `App.tsx` invite gate | **Fixed (section K):** the token leaves the address before the app renders, and the CAPTCHA script is only ever added to a page without it. Browser-tested with a stand-in script. | A script running in the page could still read `sessionStorage` (as it could the sign-in session itself). |
| S3 | Medium | **A removed member's device keeps the child's data at rest** until that account next syncs on that device. If they never sign in there again, it stays indefinitely (offline-first by design). | Phase 2a/2b removal design; `multiAccount.mjs` shows cleanup only once the device syncs | Not fixed (inherent). | Tell testers. Removal can't wipe a device that never reconnects. |
| S4 | Medium | **A concurrent edit can be hidden from the people involved.** When two people change the same field, the second to reach the server loses it on every screen. Their text is kept in `record_versions`, readable by the owner and its author, but no screen shows it. Not data loss, but a silent overwrite from the user's point of view. | `resolver.ts`; `multiAccount.mjs` concurrent step | **Partly fixed (section K):** the Moment's page shows "Kept versions" to the person managing the profile and to the version's author. | No notice at the moment of the conflict; activity records' kept versions are not shown. |
| S5 | Medium | **Editors can soft-delete any of the child's records** (decided in Phase 1b), and the owner has no in-app way to restore a deleted Moment or activity record. Tombstones stay on the server. | Phase 1b matrix | **Mitigated (section K).** Owner decision: editors keep this. Recently Deleted now lists a shared child's removed Moments and activity records for the person managing the profile, who can restore them. | Deletions aren't announced; the owner has to look. |
| S6 | Low | **The Circle could show stale or no-longer-permitted names**: it refreshed only on remount and kept names on screen after access ended. | Phase 4 §10 | **Fixed** (section D, Circle refresh). A 42501 answer now removes every name from the screen. | — |
| S7 | Low | **Declining left the unspent token in browser history** (Back returned to it). | `App.tsx` `declined={() => go("today")}` pushed a new entry | **Fixed**: decline replaces the entry, as accept already did. Tested (`invitations.mjs` "Declining"). | — |
| S8 | Low | **Record reads (`/rest/v1/`) were not explicitly kept out of the browser HTTP cache.** Only photo files were. The local stack sends no cache headers (verified with `curl`), so nothing is cached today. Hosted headers were not verified. | `lib/cloud/client.ts` | **Fixed** (defense in depth): `cache: "no-store"` for `/rest/v1/` too. | — |
| S9 | Low | **Signed URLs** created before removal keep working until they expire. | Phase 2b tests | Accepted: the app never creates signed URLs. | Only links someone made by hand. |
| S10 | Low | **An owner who opens their own invitation link and taps Accept spends it** (`accept_invitation` marks it accepted while leaving the owner row alone). | Migration `20261101000500` | **Fixed** in `20261102000100`: the owner gets `already_member` and the invitation stays unused (database-tested). | — |
| S11 | Low | **The upgrade backfill clears `record_versions.updated_by`** on versions kept before the upgrade. The column is a server stamp: a migration has no signed-in user. `created_by`, which decides access, is unchanged. | `tests/ops/upgrade.mjs` (reported column by column) | Accepted, documented. | Loss of a "last touched by" stamp on old versions only. |
| S12 | Low | **Pending invitations of a soft-deleted child come back on restore** (if not yet expired). | `get_invitation_preview` checks `child_is_deleted` only at use | Accepted, documented. | The owner can cancel them in Manage. |
| S13 | Info | `sharedSyncEnabled` checks `MODE === "development"`, so a bundle built with `vite build --mode development` (a Figma preview) and the flag would compute `true`. That build's cloud environment is "local" and accepts only loopback Supabase URLs, so it can't reach a hosted project. | `lib/sync/scopes.ts`, `lib/cloud/environment.ts` | Accepted. Optionally tie the flag to `import.meta.env.DEV` as well. | None found. |
| S14 | Info | IndexedDB isolation between accounts on one browser is logical (one database per account), not encrypted. Anyone using that unlocked browser profile can read them. | `lib/data/schema.ts` | Accepted: device trust model. Another account never loads them (`sharing.mjs` step 9). | — |
| S15 | Info | Personal backup files are plain JSON with children's data, in the parent's own hands. Shared children are excluded (tested). | `backupData` | Accepted. | — |
| S16 | Info | Whether hosted Supabase logs RPC bodies (the token travels in a POST body) was not verified. | — | Check the project's log settings before staging. | — |

**Cross-family leakage, specifically.** None was found. RLS answers through `private.child_role` per child. An
unknown token, a deleted child and a never-shared child all answer `invalid`. `child_circle` returns user ids and
roles only to the owner. Photos are readable only through a shared child that shows them. This is backed by the
`childAccess`, `circle`, `invitations` and `multiFamilySync` database suites and by
`sharing.mjs`/`circle.mjs`/`multiAccount.mjs` in browsers. The upgrade test and the restore rehearsal both
re-checked that an outsider sees nothing.

**Token handling, verified in a browser** (`multiAccount.mjs`, Ben's emulated phone):

- The token was in the POST bodies of exactly two calls to the local stack (`rpc/get_invitation_preview`,
  `rpc/accept_invitation`).
- It was in no request URL, no `Referer` header and no console message.
- No request went to a non-local host.
- After acceptance it was in no browser history entry (`Page.getNavigationHistory`), and not in localStorage,
  sessionStorage or IndexedDB.
- Analytics never sees it: events carry only a feature key, and no invitation code calls the tracker (from the
  repo).
- Sign-in sends no redirect URL, so the email code flow never carries the address (from the repo: no
  `emailRedirectTo`).

## D. Test matrix

All runs: macOS (Darwin 25.6), Node 24.21.0, Google Chrome (headless, via the DevTools protocol), Docker 29.8.2,
Supabase CLI 2.120.0. Local stacks only: **main** (`rootmap`, the long-lived local database) and **disposable**
(`rootmap-migtest`, separate ports and volumes, created for this review).

### Baseline (before any change, commit `c19f10e`)

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | 203 / 203 |
| `npm run test:db` | 252 / 252 (109 s) |
| `npm run test:e2e` | 152 / 152 (14 suites) |
| `npm run test:e2e:cloud` | **92 / 93**: `invitations.mjs` "An Editor cannot invite" **failed** |

The cloud failure was reproduced from a clean worktree at `c19f10e`, so it predates this review. Cause: a race in
the test itself. It grants Nina a membership and opens `#/child/<Mia>` before sync has brought Mia to her device,
and the app correctly redirects an unknown child to My Children. Fixed in the test by waiting for the child first.

The first attempt at that clean-worktree run is discarded and not counted: its symlinked `node_modules` made Vite
refuse font files with 403.

### Final run (after all changes)

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | **209 / 209** (203 + 6 new) |
| `npm run test:db` | **252 / 252** (111 s, main stack) |
| `npm run test:e2e` | **152 / 152** (14 suites) |
| `npm run test:e2e:cloud`, first pass | **stopped at `analytics.mjs` 10/11.** Suites before it passed (cloud 15, spaces 10, sync 12, guestImport 7). The chain stops at the first failing suite, so the later suites didn't run. |
| `npm run test:e2e:cloud`, after the fix below | **111 / 111** (10 suites): cloud 15, spaces 10, sync 12, guestImport 7, analytics 11, sharing 17, circle 9, invitations 14, multiAccount 13, flags 3 |
| `npm run build` | builds (the existing chunk-size warning only) |

**The analytics failure, investigated rather than rerun.** "The request holds only whitelisted fields…" failed with
`0 !== 1`. The server counts a batch under its own `day`, which is the browser's local date (2026-11-01, 19:20 EST).
The test read the server's UTC `current_date` (2026-11-02). It fails whenever the local and UTC dates differ, which
is every evening west of UTC. This is a test bug, not a product bug. The test now uses this computer's local date,
and passed 11/11 at a time when the two dates still differed. Remaining edge: a run that crosses local midnight.
This is a different flake from the known `analytics.test.ts` one (random ages), which didn't fail.

### Targeted runs (this session)

| Suite / check | Where | Result |
|---|---|---|
| `tests/unit/refresher.test.ts` (new) | Node | 6 / 6 |
| `tests/e2e/invitations.mjs` (race fixed; Circle refresh, Decline and Canceled steps added) | main stack | 14 / 14 |
| `tests/e2e/multiAccount.mjs` (new) | main stack | 13 / 13 |
| `tests/e2e/flags.mjs` (new) | real `vite build` (production, staging) + dev server on main stack | 3 / 3 |
| `tests/ops/upgrade.mjs` (new) | disposable stack | 8 / 8 |
| All 15 migrations applied to an **empty** database (`supabase db reset`) | disposable stack | applied, in order |
| `npm run test:db` against that fresh database | disposable stack | **252 / 252** |
| `tests/ops/restoreRehearsal.mjs` (new) | disposable stack | 7 / 7 |

Failures seen while building these, and what they were. All were test issues, except one product finding (S11):

- Re-navigating to an identical URL fires no load event.
- `blob:` and `data:` URLs have no host.
- A refused Circle call logs a 403 to Chrome's console. It is the expected result of S6 and is marked expected in
  the step.
- A PostgREST bulk insert filled a missing key with null.
- My regex didn't match the CLI's error text, and the cleanup after it was skipped.
- `pg_dump` storage-table permissions, and the CLI's `-x` doesn't accept a wildcard.
- A string inside supabase-js matched a too-broad "no real project" assertion.
- S11 (product finding): the backfill clears `updated_by`, now classified and reported.

### Requested scenarios

| Scenario | Status | Where |
|---|---|---|
| Typecheck, unit, database, browser, cloud browser, production build | Passed | final run |
| Empty-database migration | Passed | disposable stack; CI step added |
| Upgrade from pre-sharing schema with data | Passed | `tests/ops/upgrade.mjs`; CI step added |
| Multi-account invitation (A creates child, invites B; B accepts, sees Moment and photo, adds and edits; A receives) | Passed | `multiAccount.mjs`, separate browser profiles |
| Role change to View Only (B reads, can't create or edit; refusal marked, not resent) | Passed | `multiAccount.mjs` |
| Revocation (A removes B; cleanup after confirmed checks; unsent edit archived apart; A's records unchanged) | Passed | `multiAccount.mjs`; also `sharing.mjs`, `circle.mjs`, `invitations.mjs` |
| Concurrent editing (same Moment, both offline) | Passed (behaviour documented below) | `multiAccount.mjs`; `sync.mjs` (same account) |
| Circle refresh (accept, role, removal, leave, relationship, revoke, page active again) | Passed | `invitations.mjs`, `multiAccount.mjs`, `refresher.test.ts` |
| Feature flags on and off | Passed | `flags.mjs`; every suite with the flag on |
| Backup excludes shared data; signed-in restore add-only; guest import never matches a shared child; account switching hides archive | Passed (existing tests re-run) | `sharing.mjs` steps 9, 13–15; `tests/unit` |
| Backup and restore rehearsal (database plus files) | Passed (disposable data) | `tests/ops/restoreRehearsal.mjs` |
| Mobile viewport and user agents (iPhone Safari, Android Chrome, WeChat) | **Emulated only** | `multiAccount.mjs` (Chrome with mobile metrics, touch and UA) |
| Real iOS Safari, real Android Chrome, real WeChat in-app browser | **Not tested** | no devices or WebKit in this environment; section H |
| Physical devices | **Not tested** | section H |
| GitHub Actions on Linux | **Not tested** | not pushed; `gh` not installed |
| Staging | **Not tested** (by rule) | — |

### Circle refresh (brief §2): what changed

`components/ChildCircle.tsx` uses `lib/refresher.ts` (pure, unit-tested). It refreshes:

| Trigger | How |
|---|---|
| The person's own change (relationship, role, removal, revoke) | read again at once; one follow-up if a request is already on its way |
| Someone joining by link | while Manage is open, the page is visible and an invitation is pending, `list_invitations` every 15 s; an invitation newly "Joined" reloads the people |
| A member leaving, or changes made elsewhere | when the page becomes visible again, the window regains focus, or the network returns (throttled: at most once per 5 s) |
| The person's own role changed (sync noticed) | read again when the `access` prop changes |
| Opening Manage | read again |

It asks for one request at a time and never applies a stale answer, including after the child changes or the
screen closes. A network failure keeps the last list. A 42501 (no longer in the circle) clears every name and
closes Manage.

### Concurrent editing: exactly what happens

RootMap provides **eventual synchronization**, not real-time collaborative editing. Each device syncs every 30 s
while open, when it comes back online and when the page becomes visible (`runner.ts`). From the repo, confirmed by
`multiAccount.mjs` and `sync.mjs`:

1. A device sends an update only "at the revision it last saw" (`rev`).
2. If the server's copy moved on, the device does a three-way merge of base, its own version and the server's
   (`resolver.ts`):
   - **Different fields** on each side: both kept (tested: Ana's title plus Ben's text).
   - **Same field, different values:** the **server's value stays**, which means the first edit to arrive wins (not
     the latest clock time). The losing version is stored in `record_versions` (`text_conflict` or
     `field_conflict`), readable by the child's owner and the version's author. No screen shows it: S4.
   - **Deleted on one side, edited on the other:** it stays deleted, and the edited version is kept as
     `edited_after_delete`.
   - **Photos on a Moment:** the union, in this device's order.
3. Ids are fixed per record, so a retry or reconnect never duplicates a record (tested: exactly two Moments after
   both reconnect). Kept versions are upserted by id (`ignoreDuplicates`).
4. Offline edits wait in the outbox and are sent on reconnection. A network failure is never treated as a refusal
   (`sharing.mjs` step 5).
5. Cursors are per family, so a shared family's changes never move the user's own cursors (`multiFamilySync`
   tests).
6. Account switching opens another database. Another account never sees this account's records, cursors or
   archive (`sharing.mjs` step 9).

**Smallest safe improvement for S4:** after a sync round that stored a losing version for this device, show a note
on that Moment: "Someone else changed this at the same time. Their version is shown; yours is kept." Add a way to
view the kept text. That needs only a read of `record_versions` by the author, which RLS already allows. No sync
engine change.

## E. Migration readiness

| Check | Status |
|---|---|
| Ordering | Verified: the 15 files apply in timestamp order. `upgrade.mjs` asserts the applied versions equal the files, in order. |
| Empty database | **Verified** (disposable stack): `supabase db reset` applied all 15 to an empty database (0 users, 0 children), then `npm run test:db` passed 252/252 against it. |
| Upgrade from the pre-sharing schema | **Verified** (disposable stack, `tests/ops/upgrade.mjs` 8/8). The starting database had the 10 pre-sharing migrations and was filled by each parent through the API: `create_family`; children including a soft-deleted one; the seed id `emma` in two families; Moments with photos and files; activity records; plans; goals; kept versions. Then `supabase migration up`. |
| Content unchanged | Verified: every row of 13 tables identical on its pre-upgrade columns, except server bookkeeping on `record_versions` (`rev`, `change_seq`, `server_updated_at`, `updated_by` → null: S11) and `families.change_seq`. Devices never pull `record_versions`, so nothing is downloaded again. |
| Backfill refusal | Verified: a family with a child and no member makes `migration up` fail ("child ownership is unclear in 1 famil(ies)", SQLSTATE P0001) with no later migration recorded and no `child_memberships` table. After that family is removed, the same command succeeds. |
| Functions, RLS, invitations, removal, soft-deleted children, photos, ownership | Verified on the upgraded data (`upgrade.mjs`): owner-only membership, removal ends access at once (rows and files), soft-deleted child invisible to a member, owner's membership can't be removed or demoted even by the server. Also verified on the fresh database by the full `tests/db` suite. |
| Staging | **Unverified.** Per Phase 0 (2026-11-01), staging has the 10 pre-sharing migrations. None of the five sharing migrations is applied there, and this review didn't look. |

**Not proven by these tests:** an upgrade of staging's actual data. The representative data covers the shapes
the app writes, but not anything an operator may have written by hand. Before applying to staging, the owner
should:

1. Take and verify backups (section F).
2. Run the Phase 1a read-only check
   ([shared-child-profiles-phase1a.md](shared-child-profiles-phase1a.md) §3). An empty result means the backfill
   will succeed.
3. Restore the staging dump into a disposable local stack. Then run `npx supabase migration up --local --workdir
   <that stack>` and the integrity checks in Phase 0 §5 step 4.
4. Write the undo migrations Phase 0 asked for (still missing).

CI now runs the empty-database and upgrade checks on every pull request and before every deploy (section G).

## F. Backup and recovery

| Question | Answer |
|---|---|
| Database backups configured on staging? | **No**, as verified in Phase 0 (2026-11-01: `backups: null`, `pitr_enabled: false`, Free plan). **Not re-checked** in this session: the brief forbids touching real infrastructure. Do not assume this has changed. |
| Point-in-time recovery? | Not on the Free plan. On Pro it is a paid add-on. |
| Storage objects (photos)? | **Not covered by Supabase database backups on any plan.** They must be copied separately. |
| Complete restore possible? | Locally, yes: **rehearsed** (below). For staging, only once both a database backup and a file copy exist. |
| Restore tested? | **Yes, on disposable local data only** (`tests/ops/restoreRehearsal.mjs`, 7/7). Never on staging data. |
| Sensitive data in backups? | Yes. Database dumps hold children's names, birthdays, notes, Moment text, auth emails and password hashes, and invitation hashes. The file copy holds children's photos. Personal backup files hold one family's data. |
| Access restriction | Supabase backups: anyone in the Supabase organization with project access. Keep membership to the owner, with MFA on. Manual dumps and file copies must live only on an encrypted volume or vault outside the repository and outside synced folders, and be deleted when superseded. |

**Rehearsal (verified, disposable stack).** The data was two families, a child shared by invitation, Moments, three
photos with distinct bytes and a pending invitation.

1. Backup: `supabase db dump --data-only --use-copy`, excluding every `storage.*` table (the bucket comes from the
   migrations, object rows from re-upload), plus a download of every file in `family-photos` with a SHA-256
   manifest, checked against `photos.sha256`.
2. Disaster: every file deleted, then `supabase db reset` (empty schema from the migrations).
3. Restore: `psql --single-transaction -v ON_ERROR_STOP=1`, with `SET session_replication_role = replica` and the
   dump, then every file uploaded back to its path.
4. Verify:
   - every row of `auth.users`, `auth.identities`, `families`, `family_members`, `profiles`, `children`, `entries`,
     `photos`, `record_versions`, `child_memberships` and `child_invitations` identical;
   - every file's hash identical;
   - both parents sign in with their old passwords;
   - the shared editor sees exactly the shared child and its photo, never the unshared sibling or its photo;
   - an outsider sees nothing;
   - the owner writes after the restore, and an outsider's write is refused.

What the rehearsal found:

- The `postgres` role can't restore newer Storage tables (`storage.buckets_vectors`: permission denied). Storage
  rows must not be in the data dump.
- The CLI's `-x` needs each table named.

**Procedure for staging.** For the owner to run. Commands are read-only against staging except the plan change.

1. Decide: upgrade `rootmap-staging` to Pro (daily backups, 7 days) and consider the PITR add-on. Or stay on Free
   and rely on manual dumps.
2. Before every migration or flag change, and on a schedule:
   ```sh
   npx supabase db dump --linked --role-only -f <secure>/roles.sql
   npx supabase db dump --linked -f <secure>/schema.sql
   npx supabase db dump --linked --data-only --use-copy $(for t in <every storage.* base table>; do printf -- "-x storage.%s " $t; done) -f <secure>/data.sql
   # photo files, with a hash list (service key in the shell only, never in a VITE_ variable or the repo):
   npx supabase storage cp -r ss:///family-photos <secure>/family-photos --experimental --linked
   (cd <secure>/family-photos && find . -type f -exec shasum -a 256 {} \; > ../family-photos.sha256)
   ```
3. Verify each backup by restoring it into a **disposable** local stack (as `restoreRehearsal.mjs` does). Compare
   row counts per table with `supabase inspect db table-stats --linked`, and file hashes with `photos.sha256`.
4. Restore for real only into a new project or after an explicit owner decision: roles, then schema, then data
   (as in step 3 of the rehearsal), then files uploaded back. Then verify as in step 4 of the rehearsal.

## G. CI and deployment

**Before this review (from the repo):** `deploy-pages.yml` built and deployed on every push to `main` without
running any test. `db-tests.yml` ran on push and pull requests but gated nothing. `e2e-tests.yml` ran only on pull
requests. A failing test could not stop a deployment.

**Changes (made, not pushed, so not yet run on GitHub):**

| File | Change |
|---|---|
| `db-tests.yml` | Callable (`workflow_call`), and its own push trigger dropped (pushes run it from the deploy workflow). New steps: list the migrations applied to the empty database; `supabase db reset --local --version 20261027000200` then `node tests/ops/upgrade.mjs .`; then the database tests (on the upgraded database), unit tests, typecheck and `npm run build`. |
| `e2e-tests.yml` | Callable (`workflow_call`). The cloud suite now includes `multiAccount.mjs` and `flags.mjs` (`package.json`). |
| `deploy-pages.yml` | New jobs `db-tests` and `browser-tests` call the two workflows. `build` now `needs: [db-tests, browser-tests]`, so a failed or cancelled test job stops the deploy. Build and deploy steps are unchanged, so GitHub Pages behaviour is preserved. |

Effects to know about:

- A deploy now takes the time of both test workflows (the browser workflow has a 40-minute limit).
- A manual `workflow_dispatch` deploy runs the tests too. There is no bypass, on purpose.
- If the browser workflow fails on Linux (never confirmed green there), deploys stop until it is fixed.

**Repository settings to set by hand.** Not verified: `gh` isn't installed, and nothing was pushed.

- Branch protection on `main`:
  - require a pull request;
  - require status checks `db-tests` and `browser` (the job names, shown as "Database tests / db-tests" and
    "Browser tests / browser"), with "require branches to be up to date";
  - include administrators;
  - block force pushes and deletion.
- Environment `github-pages`: deployment branches limited to `main`.
- Confirm one green run of each workflow on a pull request before merging this branch.

## H. Real-device testing checklist

Two physical phones (one iPhone with Safari, one Android with Chrome), two real accounts (A, B). Ideally WeChat
installed on one. Use a build where sharing is on: today only a development server (`VITE_ROOTMAP_SHARED_SYNC=on`,
local stack), reached from the phones over the LAN. That needs `VITE_SUPABASE_URL` reachable from the phones, and
the "local" environment accepts only loopback, so in practice this needs an HTTPS tunnel or a deliberate test
build. Plan that first.

1. **A (iPhone):** sign in, create a child, add a Moment with a photo from the camera roll. Wait for "All backed up".
2. **A:** child › Circle › Manage › Invite Someone › Add & Edit › Create Invitation Link › **Share Link**. The iOS
   share sheet opens. Send it to B by Messages or email. Repeat with **Copy Link** and paste it into Notes. Check
   the link is complete.
3. **B (Android, signed out):** tap the link in the messaging app.
   - Which browser opens it: in-app or Chrome?
   - The sign-in screen shows no child name.
   - Sign in with an emailed code: switch to the mail app and back. Does the page keep `#/invite/…` after the
     switch, and after the browser reloads the tab?
4. **B:** the preview shows "Join {child}'s Circle" and "Invited by {A's name}". Accept is fully on screen. Tap
   Accept. The child's profile opens with A's Moment and photo (allow up to ~30 s).
5. **A:** with Manage open, B appears without any tap (within ~15 s), and the invitation shows "Joined". Close
   Manage, lock the phone, unlock it: the circle is current.
6. **B:** add a Moment with a photo and edit A's Moment. **A:** both appear within a minute, photo included.
7. **Concurrent:** put both phones in airplane mode, edit the same Moment's text differently, reconnect A first,
   then B. Expected: A's text on both phones (B's kept server-side, not shown: S4).
8. **A:** Manage › change B to View Only. **B:** within a minute, no Add Entry or Add Activity, and "What you can
   do: View Only". Try editing an existing Moment (it shouldn't be offered).
9. **A:** Manage › Remove from Circle. **B:** keep the app open. Within about a minute the child disappears, with
   "You no longer have access to this child's profile". B's own children remain.
10. **Background and lifecycle:** repeat step 9 with B's app in the background or the phone locked, then reopen.
    Repeat with B signed out, then signed back in. Cleanup should happen only after sign-in.
11. **WeChat (where available):** send the link in a WeChat chat and open it in WeChat's browser.
    - Does the page load at all? WeChat may warn about or block some domains.
    - Does sign-in work, and do storage and session survive closing and reopening the chat?
    - On the owner side in WeChat: does Share or Copy Link work? If not, the owner has no way to get the link
      (section I).
12. **Language and appearance:** repeat the preview in Chinese and in dark mode.
13. Record the device model, OS version, browser and version, and pass or fail per step. Note anything that needed
    a reload.

## I. Remaining risks

**Blockers before staging** (not blockers for local controlled testing):

1. No database or photo backups on staging (F).
2. CI changes not pushed. Linux browser workflow unconfirmed. Branch protection not set or verified (G).
3. No physical-device, real-Safari/WebKit or WeChat testing (H).
4. ~~S2~~ (fixed, section K).
5. No way to enable shared sync on staging: `sharedSyncEnabled` requires a development server. A deliberate,
   reviewed staging switch is needed (with S13 in mind).
6. Staging-data migration rehearsal and undo migrations (E).
7. ~~Owner decisions on S1 and S5~~ (decided; built, section K).
8. Migration `20261102000100_circle_joins.sql` is local only, like the five before it.

**Should fix soon, not blocking local tests:**

- S4 (rest): a notice when a conflict happens, and kept versions of activity records.
- **Link sharing fallback:** the link is never shown as text. Where neither Web Share nor the clipboard works (some
  in-app browsers, older WebViews), the owner can't get it. Consider a read-only, selectable field after a copy
  failure.
- `tests/e2e/analytics.mjs` read the server's UTC date. That is fixed (section D); a run crossing local midnight
  could still trip it.
- `analytics.test.ts` "ages are completed years…" can still fail intermittently on a long-lived local database. The
  cause is known from Phase 2a: random ages collide with earlier runs' children. It did not fail in any run this
  session, including on the fresh database, and was left unchanged.

**Optional:**

- S13: tie the flag to `import.meta.env.DEV`.
- Show who removed or joined in the Circle.
- Universal Links / App Links (explicitly out of scope).

## J. Release recommendation

**2. READY FOR LOCAL CONTROLLED TESTING.**

Evidence for it:

- Every server rule is enforced in Postgres and tested on both a long-lived and a fresh database.
- The two-account lifecycle works end to end in separate browser profiles, including concurrent edits, View Only,
  removal and cleanup.
- Migrations apply from empty and upgrade representative data with content unchanged.
- Production and staging builds can't reach any sharing path.
- The security review found no Critical or High issue, and its Low fixes are in.
- Local controlled testing (a development server with the flag, the local stack, trusted testers) uses only what
  was verified here.

Why not higher:

- **Staging after prerequisites (3)** needs the prerequisites to be at least scheduled with owners. Today the
  essential ones (backups, CI on Linux and branch protection, a staging switch, S2) are all unmet, and no physical
  device has been used.
- **Limited production (4)** would additionally need real-device results, decided S1/S5 and a verified restore of
  staging data.
- Passing automated tests alone doesn't justify either.

**Next step:** open a pull request from this branch (or run the workflows by hand) to get the first Linux CI run.
Then, in parallel, have the owner decide on staging backups and S1/S5.

## K. Follow-up: safety and recovery improvements (2026-11-02)

Done after `8c84c71`, on the same branch, against local stacks only. Nothing pushed, merged or deployed; staging
untouched. No staging or physical-device testing happened.

### K.1 Audit of the unexpected commit `c9bef56`

`c9bef56` (author `vegalh`, 2026-11-01 19:16 -0500) was made on this branch while the review was in progress, by
neither this review's tooling nor an explicit request. Inspected with `git show --stat c9bef56` and `git show
c9bef56` against `c19f10e`:

| Question | Finding |
|---|---|
| Files changed | 16: the three workflows, `AGENTS.md`, `package.json`, `src/App.tsx`, `src/components/ChildCircle.tsx`, `src/lib/cloud/client.ts`, `src/lib/refresher.ts`, `tests/README.md`, `tests/e2e/flags.mjs`, `tests/e2e/invitations.mjs`, `tests/e2e/multiAccount.mjs`, `tests/ops/restoreRehearsal.mjs`, `tests/ops/upgrade.mjs`, `tests/unit/refresher.test.ts`. |
| Unrelated changes | None. It is exactly the review's working tree at that moment (the working tree was clean against it straight afterwards). Its message mentions only the tests; the commit also holds the Circle refresh, the CI gate and the cache change. |
| Security-sensitive files | `deploy-pages.yml`, `db-tests.yml`, `e2e-tests.yml` (deploy now gated on tests, section G), `client.ts` (`no-store` widened to record reads), `App.tsx` (decline forgets the address). All reviewed as part of the review itself. |
| Tests removed or weakened | None. Removed lines are the replaced Circle loading code, a fixed `sleep(400)`, and the navigate-away workaround in `invitations.mjs`, replaced by stricter assertions. No `skip`, `only` or `todo` added. |
| Credentials or secrets | None. The ops scripts and suites read the local stack's development keys from `supabase status` at run time and refuse any non-local stack. No `sb_secret_`, JWT or project URL in the diff. |
| Overlap with `8c84c71` | None: `8c84c71` changes only the report and `tests/e2e/analytics.mjs`. |

Not reverted and history not rewritten. No serious security issue.

### K.2 Invitation token security (S2)

**How it was exposed.** A link is `#/invite/<token>`. The app kept the token in the address while signed out. The
sign-in CAPTCHA (Cloudflare Turnstile, `lib/cloud/captcha.ts`) is added to the page only when the sign-in form is
submitted (`lib/cloud/session.ts`), and it can read `location.href`, as any script in the page can. A URL fragment
is not private from JavaScript.

**Now (`lib/inviteToken.ts`):**

- `main.tsx` calls `captureInviteToken()` before anything else. The token moves into memory and `sessionStorage`
  (this tab only, ending with it; never `localStorage`), and the address is replaced with `#/invite`
  (`history.replaceState`, so no history entry keeps it).
- The same happens when a link is opened in a tab where the app is already running (App's popstate handler), and
  once more right before the CAPTCHA script is added (`loadTurnstile`). So the script never loads into a page
  whose address holds a token.
- It survives the sign-in reload and a refresh (same tab). A new tab at `#/invite` without a held token opens
  Today.
- It is forgotten when the invitation is accepted or declined, or is invalid, expired, revoked or already used. It
  is also forgotten on an ordinary sign-out (kept only for "Sign In With a Different Account") and after 24 hours.
- **Wrong account:** the preview now says "Signed in as {email}." with "Not you?" (switch account, keeping the
  invitation). Acceptance still needs an explicit Accept, and the server checks the signed-in account (and the
  email restriction) itself.
- Not in analytics, logs or error messages (unchanged; no invitation code calls them). The only requests carrying
  it are the two invitation calls to the project, in POST bodies.

**Isolation, honestly stated.** Any script running in the page can read `sessionStorage`, just as it can read the
sign-in session in `localStorage`, which is worth more. A same-page script that actively wants the token can't be
stopped by a static site. The fix removes every passive path: the address, `document.URL`, the Referer, page-URL
telemetry, history and logs. A stronger boundary would need the CAPTCHA in a separate origin, which Turnstile's
domain check doesn't allow from an opaque iframe (not attempted).

**Tests:**

- `tests/unit/inviteToken.test.ts` (4): capture, reload, expiry, forgetting, never localStorage.
- `multiAccount.mjs`:
  - the address is `#/invite` at once under three phone user agents, held in sessionStorage only, and restored
    after the sign-in reload;
  - "Signed in as";
  - **CAPTCHA isolation:** a dev server with a site key, and Chrome serving a stand-in for Turnstile's script
    (nothing leaves the computer). The address recorded when the script element was added holds no token, and
    neither does the script's request or its Referer. Acceptance then works and the held token is gone.
- `invitations.mjs`: switch account keeps the invitation in sessionStorage, not the address.
- `flags.mjs`: production and staging builds still open nothing.

### K.3 Invitation acceptance notices (S1)

- **Server** (migration `20261102000100_circle_joins.sql`): no new notification system. The invitation row gains
  `joined_new` (set by `accept_invitation`, in its locked transaction, when the acceptance made a new member) and
  `join_seen_at`.
  - `circle_joins()` returns the caller's unseen joins only for children whose profile they manage (not deleted,
    member still in the circle): child first name, member display name, time. No email, no user id.
  - `dismiss_circle_joins(ids)`: only the person managing the profile; idempotent.
  - One acceptance means one notice. An invitation is accepted once, and retries and concurrent attempts answer
    `accepted` and change nothing.
  - Someone already in the circle accepting a second link (an access change) is not announced.
- **Screen:** My Children shows "Nina joined Emma's Circle." (or "Someone joined…" without a display name), with
  View Circle (opens the child's page, where the circle is) and Done. It refreshes on returning to the page. No
  email or push.
- **Tests:**
  - `tests/db/circleJoins.test.ts` (7): success; repeated and concurrent acceptance; several invitations and an
    access change; visible to the person managing the profile only (members, outsiders and anonymous callers get
    nothing; the table stays unreadable); dismissal by others has no effect; removed members and deleted children;
    S10.
  - `multiAccount.mjs`: the notice, View, dismissed for good across a reload, none for members, and following the
    account across browsers (Cy sees none; Ana signed in on Cy's browser sees Cy's notice; dismissing it there
    clears it on Ana's other browser).

### K.4 Recently Deleted for shared growth records (S5)

- **Reuses what exists.** Moments, Journal entries (the same `entries` records) and activity records were already
  soft-deleted (`deleted_at`), synced and kept with their photos. Soft deletion never touched photo rows, files or
  device copies (verified: the photo row stays, and the bytes stay on the editor's device).
- **What's new:** the existing Recently Deleted page gains a section, "Moments and activities from shared
  profiles", for the person managing a profile that someone else helps with.
  - Which children count: from the server's membership rows, which that person may read; asked when Profile or
    Recently Deleted opens. Offline, the section isn't shown.
  - Restore clears `deleted_at` on the same record (same id, text, photos, `created_at`). It syncs to everyone in
    the circle like any edit; the server records who restored it in `updated_by`.
  - No migration and no new deletion system.
- **Unchanged:** children nobody else helps with (their Moments aren't listed, and their deletion behaves as
  before), the guest space, deleting and restoring children, no automatic permanent deletion.
- **Permissions:**
  - View Only can't delete; the server refuses it, it is marked, and it's never resent (tested).
  - Add & Edit can delete but has no restore list (tested). The server would still let an editor clear
    `deleted_at`, the same right they have to edit.
  - Others never receive the records at all.
- **Tested** (`multiAccount.mjs`): Ben (Add & Edit) deletes Ana's Moment while offline and her activity record
  online. Ana sees both listed, plus none of her unshared child's. She restores both, and the server rows are back
  with the same photo and `created_at`. Ben's device shows them again, with the photo still there. A viewer's
  deletion is refused.

### K.5 Concurrent editing

Behaviour unchanged (section D, "Concurrent editing: exactly what happens"): eventual synchronization; different
fields merge; for the same field the first to reach the server wins; the other version goes to `record_versions`.
Nothing deletes kept versions (no client delete grant; no purge job exists).

**New:** a Moment's page shows "Kept versions" (`components/KeptVersions.tsx`): the kept text and date, read-only.

- Who sees them: RLS (Phase 1b) shows a version only to the person managing the child's profile and to its author.
- Tested: Ana and Ben see Ben's losing text under the Moment, which itself shows Ana's; Cy (View Only) sees
  nothing.
- Only where sharing is on.

Not done (scope): a notice at the moment of conflict, restoring a kept version with one tap, and versions of
activity records.

### K.6 Test results

All on this Mac (macOS, Node 24.21.0, headless Chrome, Supabase CLI 2.120.0), local stacks only, 2026-11-02.

| Command / check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | **213 / 213** (+4 `inviteToken.test.ts`) |
| `npm run test:db` (main stack) | **259 / 259** (+7 `circleJoins.test.ts`) |
| `npm run test:e2e` | **152 / 152** (14 suites) |
| `npm run test:e2e:cloud` | **115 / 115** (10 suites): cloud 15, spaces 10, sync 12, guestImport 7, analytics 11, sharing 17, circle 9, invitations 14, multiAccount 17, flags 3 |
| `npm run build` | builds (the existing chunk-size warning only) |
| Disposable stack: `tests/ops/upgrade.mjs` (now 16 migrations) | 8 / 8 |
| Disposable stack: all 16 migrations from empty, then `tests/db` | applied in order; **259 / 259** |

Requested security and regression checks, by where they are covered:

1. Token handling and 2. CAPTCHA isolation: `inviteToken.test.ts`, `multiAccount.mjs`.
3. Acceptance: `invitations.mjs`, `multiAccount.mjs`, `invitations.test.ts`.
4. Notification and 5. its authorization: `circleJoins.test.ts`, `multiAccount.mjs`.
6. Removal and 7. role changes: `invitations.mjs`, `multiAccount.mjs`, db suites.
8. Shared deletion, 9. restoration, 10. photo preservation and 13. offline deletion: `multiAccount.mjs`.
11. Cross-family isolation: `childAccess`, `multiFamilySync`, `sharing.mjs`, `upgrade.mjs`.
12. Account switching: `multiAccount.mjs`, `sharing.mjs`.
14. Guest behaviour: `circle.mjs`, `test:e2e`.
15. Production sharing disabled: `flags.mjs`.

**Failures while building this follow-up** (all mine, all fixed, none in the final run):

- My edit script truncated `multiAccount.mjs`; it was restored from `HEAD` and the edits re-applied.
- Test assertions that didn't yet know about a new Moment, a page left open by an earlier step, and the Circle
  loading asynchronously.
- A probe observing `documentElement` before it exists, whose result was then lost in the sign-in reload.

No flaky failure appeared in the final run. The known `analytics.test.ts` flake did not fail.

### K.7 Remaining staging blockers

Unchanged except S2, S1, S5 and S10 (section I):

- staging backups (database and photo files);
- CI pushed and green on Linux, plus branch protection;
- physical-device, real Safari/WebKit and WeChat testing;
- a deliberate staging switch for sharing;
- a staging-data migration rehearsal and undo migrations;
- all six sharing migrations are local only.
