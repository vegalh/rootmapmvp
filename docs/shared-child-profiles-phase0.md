# Shared Child Profiles: Phase 0

Phase 0 checks the environment, tests, migration state, CI and recovery readiness before any database change for
Shared Child Profiles V1. Branch `feature/shared-child-profiles`, from `main` at `80cae2e`. Done 2026-11-01.

**Result:** every existing test passes locally (typecheck, 186 unit, 161 database, 152 browser, 55 cloud browser).
All 10 migrations are applied to `rootmap-staging`. **Staging has no backups**, and it serves the public website
with a small amount of live data. That is the main blocker before Phase 1 touches the remote database.

Labels used below: **Verified** = checked by a command in this session, with the result stated. **From the repo** =
read in code or docs, not executed. **Assumption** = not checked.

---

## 1. Verified environment status

| Item | Status | How |
|---|---|---|
| Git | Verified: `main` clean at `80cae2e`; branch `feature/shared-child-profiles` created from it | `git status`, `git switch -c` |
| Node | Verified: v24.21.0 (CI uses 24 for tests, 22 for the Pages build) | `node -v` |
| Docker | Verified: running, server 29.8.2 | `docker info` |
| Supabase CLI | Verified: 2.120.0 through `npx` (2.122.0 available) | `npx supabase --version` |
| Local stack | Verified: running, all 10 migrations applied; realtime, imgproxy, analytics, vector and pooler stopped (not needed by tests) | `supabase status`, `supabase migration list --local` |
| Linked project | Verified: `rootmap-staging` (`cbgkkeveprftddrobzao`), us-east-2, `ACTIVE_HEALTHY`, Postgres 17 | `supabase projects list` |
| Google Chrome | Verified: installed at the default macOS path | file check |

The local stack was **not** reset before the database tests, so they ran on top of earlier local test data. CI starts
from an empty stack on every run, so a clean apply of all migrations is covered there (from the repo; CI results were
not viewable in this session, see section 4).

## 2. Test results

All run on this Mac on 2026-11-01 against the local stack only. No application code was changed.

| Command | Suites | Passed | Failed | Notes |
|---|---|---|---|---|
| `npm run typecheck` | — | clean | 0 | |
| `npm test` (unit) | — | 186 | 0 | |
| `npm run test:db` | 39 | 161 | 0 | 84 s; includes Mailpit sign-in codes and the local `verify-photo` |
| `npm run test:e2e` | 14 | 152 | 0 | app 25, resilience 3, tabs 3, reactive 9, navigation 17, discover 16, activities 10, fresh 10, memories 9, siblings 8, collections 8, profile 14, journey 9, windowing 11 |
| `npm run test:e2e:cloud` | 5 | 55 | 0 | cloud 15, spaces 10, sync 12, guestImport 7, analytics 11 |

- Existing failures: none.
- Environment limitations: none blocked a suite. The GitHub CLI (`gh`) is not installed, so CI run history could not
  be read.
- `npm run build` was not run. It is not a test, and the Pages workflow runs it on every push to `main`.

## 3. Migration status

**Verified** with read-only `npx supabase migration list --linked` (no apply, repair or reset):

| Migration | Local | Staging |
|---|---|---|
| `20261012000100_ownership` | applied | applied |
| `20261012000200_family_tables` | applied | applied |
| `20261012000300_revision_triggers` | applied | applied |
| `20261012000400_rls` | applied | applied |
| `20261012000500_storage` | applied | applied |
| `20261012000600_grants` | applied | applied |
| `20261012000700_complete_migration` | applied | applied |
| `20261020000100_saved_collections` | applied | **applied** |
| `20261027000100_usage_analytics` | applied | applied |
| `20261027000200_admin_grants` | applied | applied |

- The architecture review's concern about `20261020000100_saved_collections` was a documentation gap, not a missing
  migration. `docs/data-architecture-phase2.md` section 19 now says so.
- **Verified** (`supabase functions list`): `verify-photo` is deployed to staging, version 1, `ACTIVE`, with
  `verify_jwt: false`. The function checks the caller's token itself and reads the photo row with it, so RLS decides
  (from the repo: `supabase/functions/verify-photo/index.ts`).
- **Verified** (`supabase inspect db table-stats --linked`, planner estimates, no row contents read): about 2
  families, 2 family members, 2 profiles, 3 children, 1 entry, 18 activity records, 1 plan, 3 saved activities, 2
  photos, 0 record versions, 1 admin. **Assumption:** some of this belongs to real users of the public website, so it
  is treated as real data. The estimates suggest one member per family, which the Phase 1 backfill relies on. The
  backfill must check this itself and not trust the estimate.

## 4. CI coverage

| Workflow | Trigger | Runs | Gates deploy? |
|---|---|---|---|
| `db-tests.yml` (existing) | push to `main`, pull requests, manual | fresh local stack, `test:db`, `npm test`, `typecheck` | No |
| `deploy-pages.yml` (existing) | push to `main`, manual | `npm ci`, `npm run build`, deploy to GitHub Pages | — (runs no tests) |
| `e2e-tests.yml` (**new**) | pull requests, manual | `test:e2e`, then a fresh local stack and `test:e2e:cloud` | No |

- Before Phase 0, no browser suite ran in CI, and neither did the cloud browser suites.
- **Deployment does not require passing tests.** A push to `main` deploys even if `db-tests` fails. Recommendation
  (not done, it changes the release process): make deploy depend on the test jobs, or protect `main` with required
  checks. Do one before Phase 1 code reaches `main`.
- **The new workflow is isolated.** It starts its own throwaway Supabase stack on the runner with the CLI's built-in
  development keys, takes no secrets, and `tests/e2e/cloudkit.mjs` refuses any stack not on `localhost`. It never
  reaches staging.
- **Not yet verified on Linux.** The suites pass on macOS. The workflow sets `CHROME_PATH=/usr/bin/google-chrome` and
  lifts Ubuntu 24.04's AppArmor block on Chrome's sandbox. Its first run (open a PR, or run it by hand) is the check.
  It is not on push to `main`, so a Linux-only problem cannot block anything.

## 5. Backup and recovery readiness

### What exists today (verified)

| Layer | Backup today |
|---|---|
| Supabase database | **None.** `supabase backups list`: `backups: null`, `pitr_enabled: false`. Free plan, so no daily backups. |
| Photo storage (`family-photos`) | **None.** Not covered by database backups on any plan in any case. |
| IndexedDB on devices | In-app backup file (Profile › Backup, `backupData()` / `restoreData()` in `src/lib/data/store.ts`): live and deleted children, records, entries with photos inline as data URLs, plans, goals, saved items, drafts, settings. |
| Migrations | Forward-only. No down migrations; an applied migration is never edited (`AGENTS.md`). |

Each device also keeps its own full copy, and nothing deletes it automatically (docs section 10). For data that
reached the server, that copy is the only recovery path today.

**Existing risk found (from the repo):** `restoreData()` soft-deletes every record not in the backup file. In an
account space it also queues those deletions for upload (`store.ts`, restore path). Restoring an old file while signed
in therefore deletes, on the server and every device, anything added since that file was made. Deleted records remain
recoverable as tombstones, but this must be fixed before shared children exist: a collaborator restoring a file could
soft-delete records belonging to a child shared with them. It is listed under Phase 1 prerequisites.

### Plan

All dumps contain children's data. They go to an encrypted location outside the repository (for example an encrypted
disk image or a password manager's file vault), never into git, and are deleted when no longer needed.

1. **Before any Phase 1 migration reaches staging (required):**
   - Upgrade `rootmap-staging` to Pro, which gives daily backups (7 days; PITR is an add-on). This is the only way to
     get managed backups. It is the owner's decision because it costs money.
   - In addition, or if staying on Free, take a manual logical dump with read-only commands, kept outside the repo:
     ```sh
     npx supabase db dump --linked -f <secure-dir>/rootmap-schema.sql
     npx supabase db dump --linked --role-only -f <secure-dir>/rootmap-roles.sql
     npx supabase db dump --linked --data-only -f <secure-dir>/rootmap-data.sql
     ```
     The data dump must include the `auth` schema, so families and memberships still point at real users after a
     restore. Check the flags of the installed CLI version before relying on this.
   - Photos: copy the bucket, for example
     `npx supabase storage cp -r ss:///family-photos <secure-dir>/family-photos --experimental --linked`, and record a
     SHA-256 list of the files.
2. **Verify each backup** by restoring it into the local stack (`supabase db reset`, then `psql` the dumps), never into
   staging. Then compare row counts per table and per family against the remote `table-stats`, and photo hashes against
   `photos.sha256`.
3. **Migration recovery is forward-only.** Every Phase 1 migration ships with a written "undo" migration that is
   tested locally but not applied. For example: drop the new policies and restore the old family policies, then drop
   `child_memberships`. Because Phase 1 adds tables and policies and moves no rows, rolling forward with that undo
   migration restores the old behaviour without data loss. Restoring the dump is the last resort: it loses every
   write made since the dump.
4. **Integrity check after each migration** (read-only SQL, run on staging right after applying, counts only):
   - row counts per table unchanged;
   - every child has exactly one owner membership;
   - no orphaned `entries` or `activity_records`;
   - `families.change_seq` not lower than before.

   Write these as a script and run it locally first.
5. **Local data (IndexedDB):** account databases are never touched by a server migration. The Phase 2 IndexedDB
   upgrade needs the upgrade test described in `tests/README.md` ("If you bump DB_VERSION…"). Ask testers to export a
   backup file before installing a build with a new database version.

## 6. Existing architectural risks

From the architecture review, confirmed against the code in this session.

| Risk | Where | Affects |
|---|---|---|
| Access is family-wide: any family member can read and write every child, record, photo and record version in the family | `20261012000400_rls.sql`, `t00_member`, `photo_object_allowed()` | Phase 1 |
| Child id is unique only per family; seed ids `emma` and `noah` exist in every family that kept the demo | `children` primary key `(family_id, id)`, `src/data/children.ts` | Phase 1, 2 |
| Local stores are keyed by `id` only, with no family; a shared child with the same id would overwrite a local one | `src/lib/data/schema.ts`, `idb.ts` | Phase 2 |
| The client syncs exactly one family; push writes `family_id = own family`; `SyncStopped` on any other family | `src/lib/sync/engine.ts`, `account.ts` (`limit(1)`), `App.tsx:281` | Phase 2 |
| The cursor is per table, not per scope; a visibility change needs a full re-sync (invariant 5) | `SpaceMeta.cursors`, docs section 5.4 | Phase 2 |
| Nothing removes cached rows or photos when access ends | sync pull sees only visible rows | Phase 2 |
| `record_versions` has no `child_id`, so a version is readable by the whole family | `20261012000200_family_tables.sql` | Phase 1 |
| A photo is linked to children only through `entries.photo_ids` and `children.photo_ref`; one photo can serve several children | same | Phase 1 |
| `plans.child_ids[]` would reveal sibling ids to a collaborator | `plans` | Shared Planned Activities (later) |
| Restoring a backup while signed in soft-deletes newer records on the server | `restoreData()` | Phase 1 prerequisite |
| Deploy is not gated by tests; staging is the production database with no backups | workflows, section 5 | Phase 0 / owner |
| Account deletion is not built; `auth.users` deletes cascade to `family_members` | `account-deletion.test.ts` | Phase 1 design (memberships must not cascade) |

## 7. Phase 1 implementation checklist

Phase 1 is server-only and changes no behaviour: after it, every existing test still passes unchanged, and old app
versions keep working. It is split so that the step that changes access (1b) is small and reviewed on its own.

### Prerequisites

- [ ] Managed backups (Pro) or a verified manual dump of database and photos (section 5).
- [ ] Deploy gated on tests, or required checks on `main` (section 4).
- [ ] First green run of `e2e-tests.yml` on Linux.
- [ ] `restoreData()` in an account space no longer pushes soft-deletes for records missing from the file (or restore
      is limited to the guest space). Small, separate, tested change.
- [ ] Owner answers to the product questions that change RLS. Already decided: Editors may edit and soft-delete
      others' records. Still open: Editors editing child `notes` / `interests`; what members see after the Owner
      deletes a child; member list visibility; invite email binding; what happens to owned children on account deletion.

### 1a. Memberships, no access change

- [ ] New migration: `child_memberships (family_id, child_id, user_id, role)`.
  - primary key `(family_id, child_id, user_id)`;
  - FK to `children (family_id, id)`;
  - `user_id` references `auth.users` **without** cascade;
  - `role in ('owner','editor','viewer')`;
  - partial unique index for one owner per child;
  - RLS on, select only (a user's own rows, plus all members of children they own), no client insert, update or delete.
- [ ] Backfill: first raise an error if any family has more than one member. Then give every child, deleted ones too,
      an owner membership for its family's single member.
- [ ] After-insert trigger on `children`: the inserting user becomes owner (with the service role, the family's owner).
      The existing client insert path keeps working, so no app change is needed.
- [ ] Deferred constraint trigger: at commit, every touched child has exactly one owner.
- [ ] Helpers: `private.child_role(family_id, child_id)` and `private.my_children()`, both security definer with a fixed
      `search_path`, granted like `my_family_ids()`.
- [ ] `record_versions.child_id` (nullable), filled from `version->>'child_id'` (or the id itself for `children`), and
      set by the client mapping from then on.
- [ ] `photo_children (family_id, photo_id, child_id)`, maintained by triggers on `entries.photo_ids` and
      `children.photo_ref`, backfilled.
- [ ] Tests in `tests/db/`:
  - backfill gives exactly one owner per child;
  - a direct second owner is refused;
  - a child insert creates an owner;
  - clients cannot write memberships;
  - concurrent inserts and deletes keep exactly one owner;
  - every existing suite passes unchanged.
- [ ] Undo migration written and tested locally (not applied).

### 1b. Child-role access (still no visible change: every member is an owner)

- [ ] Child tables (`children`, `entries`, `activity_records`): select needs any role; insert and update need owner or
      editor, checked on the old and the new row. `t00_member` becomes a child-role check on these tables.
- [ ] `children` identity columns (`first`, `last`, `dob`, `photo_ref`, `deleted_at`, plus whatever else is decided)
      change only for the owner, enforced by a `t10` trigger.
- [ ] `photos` and `photo_object_allowed()`: any role on a linked child; unlinked photos only for the uploader and the
      home family. `verify-photo` needs no change (it uses RLS).
- [ ] `record_versions`: readable by the child's owner and the version's creator.
- [ ] Family tables (`plans`, `saved_*`, `goals`, `cloud_migrations`) unchanged.
- [ ] `complete_migration()` counts only records the caller can access.
- [ ] Three-role test matrix with raw clients. Memberships for editor, viewer and outsider are inserted with the
      service role, because invitations come in a later phase. Also: an unshared sibling stays invisible, including
      its photos and versions.
- [ ] Re-run the staging privilege audit from docs section 19 after applying.

### Deliberately not in Phase 1

- Client changes: composite local keys, multi-scope sync, per-family cursors, revocation cleanup (Phase 2).
- UI roles (Phase 3), invitations and transfer (Phase 4), Shared Planned Activities (later feature).

## 8. Unresolved blockers

| # | Blocker | Blocks | Who |
|---|---|---|---|
| 1 | No database or photo backups on `rootmap-staging`, which serves live users | applying any Phase 1 migration remotely | Owner: Pro plan or approve the manual dump procedure |
| 2 | Deploy is not gated on tests | merging Phase 1 to `main` | Owner: approve gating or branch protection |
| 3 | `e2e-tests.yml` not yet run on Linux | relying on it as a gate | Needs a PR or a manual run (nothing pushed in Phase 0) |
| 4 | Backup restore in an account space pushes soft-deletes | Phase 2 and sharing (prerequisite before 1b ships) | Small fix, separate change |
| 5 | Open product questions that shape RLS (section 7) | 1b | Owner |
| 6 | No environment separate from production for migration rehearsal | safe rehearsal of 1a and 1b | Owner: a second Supabase project, or accept local-only rehearsal plus backups |

Local Phase 1 development (migrations and tests on the local stack) is **not** blocked.
