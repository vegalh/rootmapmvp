# Shared Child Profiles: pull request readiness

Date: 2026-11-02 (UTC). Companion to [shared-child-profiles-release-readiness.md](shared-child-profiles-release-readiness.md),
which holds the full security review, test matrix and staging plan. This report covers publishing the branch, the
first Linux CI runs, deployment safety and branch protection. Nothing was merged or deployed, and staging and
production were not touched.

**Update 2026-11-03:** section 11 (Final Pre-Merge Verification) closes blocker 2 of section 9 and replaces the merge
recommendation in section 10.

## 1. Pull request

| | |
|---|---|
| PR | [#4](https://github.com/vegalh/rootmapmvp/pull/4): Add Shared Child Profiles with secure invitations and multi-family sync |
| Repository | `vegalh/rootmapmvp` (public) |
| Source → target | `feature/shared-child-profiles` → `main` |
| `main` at the time | `80cae2e` (the branch is 0 commits behind) |

## 2. Commits

The branch was clean at `52b82fc` and was pushed without force. Ten commits, Phase 0 (`9278965`) to "Improve shared
profile safety and recovery" (`52b82fc`). Then one CI fix (section 4):

- `40d7445` Browser test: measure the desktop phone frame against the page's real width

**Tested head: `40d7445`.** The commit that adds this report is documentation only. Its CI run is recorded in the PR
description, not here.

## 3. CI workflow runs

Both workflows run on `pull_request`. Runner: `ubuntu-latest` (Ubuntu 26.04 image 20261025.179).

| Commit | Workflow / job (check name) | Run | Result |
|---|---|---|---|
| `52b82fc` | Database tests / `db-tests` | [41370882914](https://github.com/vegalh/rootmapmvp/actions/runs/41370882914) | success |
| `52b82fc` | Browser tests / `browser` | [41370883046](https://github.com/vegalh/rootmapmvp/actions/runs/41370883046) | **failure**: cloud-off suite failed, cloud-on suite skipped |
| `40d7445` | Database tests / `db-tests` | [41371628003](https://github.com/vegalh/rootmapmvp/actions/runs/41371628003) | success |
| `40d7445` | Browser tests / `browser` | [41371628001](https://github.com/vegalh/rootmapmvp/actions/runs/41371628001) | success |

No run was cancelled. On `40d7445` no step was skipped, and no test was skipped or cancelled. `Deploy to GitHub Pages`
did not run for either commit.

## 4. The Linux failure and its fix

`memories.mjs`, step "Chinese and dark mode on a phone, and the desktop frame", failed with `inside the phone frame:
511.5–913.5`. The step expected the recap at 519–921 px in a 1440 px window. That holds with macOS overlay
scrollbars. On Linux, Chrome shows a classic 15 px scrollbar, the page is 1425 px wide, and the centered 402 px frame
moves 7.5 px left. The app is correct, and a Windows or Linux desktop user sees the same thing. The test came from
`main`, and this was the first time the browser suites ran on Linux.

Fix: the step now checks that `.app-shell` is 402 px wide and centered in the page's `clientWidth`, and that the
recap is inside it. The check is just as strict, and only the hard-coded geometry is gone. Locally, `npm run
test:e2e` passed 14/14 suites (152 tests). On Linux it passed too (below).

## 5. Test results on Linux (`40d7445`)

| Check | Linux CI | Local (macOS, `52b82fc`) |
|---|---|---|
| Migrations applied to an empty disposable database | 16 / 16, in order | 16 / 16 |
| Upgrade from the pre-sharing schema with data (`tests/ops/upgrade.mjs`) | 8 / 8 | 8 / 8 |
| Database tests (`npm run test:db`, on the upgraded database) | 259 / 259 (0 skipped, 0 cancelled) | 259 / 259 |
| Unit tests (`npm test`) | 213 / 213 (0 skipped, 0 cancelled) | 213 / 213 |
| Typecheck (`tsc --noEmit`) | clean | clean |
| Production build (`vite build`) | succeeded | succeeded |
| Browser, cloud off (`test:e2e`, headless Google Chrome) | 152 / 152, 14 / 14 suites | 152 / 152 |
| Browser, cloud on, local stack (`test:e2e:cloud`) | 115 / 115, 10 / 10 suites | 115 / 115 |

The database is the local Supabase stack started on the runner, with its built-in development keys. Nothing remote
is touched, and the stack is deleted at the end of the job (`supabase stop --no-backup`). The cloud browser suites
refuse any stack that isn't on localhost.

## 6. Security review (before pushing)

| Check | Result |
|---|---|
| Production sharing disabled | Yes. `sharedSyncEnabled` needs `VITE_ROOTMAP_SHARED_SYNC === "on"` **and** Vite mode `development` (`src/lib/sync/scopes.ts`). `npm run build` runs in production mode. |
| Env vars alone can't enable it in production | Yes, for the same reason. `flags.mjs` builds production and staging bundles with every switch on and checks that no invitation opens. Repository variables set only `VITE_ROOTMAP_CLOUD`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. |
| Invitation route closed when sharing is off | Yes. `allowedRoute` in `src/App.tsx` refuses `#/invite` unless cloud **and** `sharedSyncEnabled` are on, and forgets any held token. The token leaves the address bar before render (`src/lib/inviteToken.ts`). |
| No secrets or service-role keys in the diff | Yes. A scan for `sb_secret_`, JWTs, private keys and cloud tokens matched only a sentence in the release-readiness doc. No `.env` file is included. The build refuses a secret key in any `VITE_` variable. |
| No real child data or personal information | Yes. The only email addresses are `name@example.com` placeholders. Tests create generated accounts on the disposable stack. `src/data` is unchanged. |
| No automatic staging or production migrations | Yes. No workflow has Supabase credentials or runs `db push` or `migration up` against a remote. Migrations run only on the runner's local stack. |
| Production works without the six new migrations while sharing is off | Code review: yes. Every client use of a new table, column or function (`child_memberships`, the Circle and invitation RPCs, `photos.child_id`) is behind `sharedSyncEnabled` or only reached for a shared family's scope. Home-family sync uses the same tables and columns as before. `flags.mjs` checks that a signed-in parent with sharing off makes no Circle or invitation call. **Not tested end to end against a pre-sharing database** (section 9). |
| The deploy workflow can't deploy the feature branch | Yes (section 7). |

## 7. Deployment safety

| Condition | Verified by |
|---|---|
| Opening the PR doesn't deploy | `deploy-pages.yml` has no `pull_request` trigger. No Pages run or deployment exists for either commit. The latest deployment is `main@80cae2e` (2026-10-30). |
| Pushing the feature branch doesn't deploy | Its only triggers are `push: branches: [main]` and `workflow_dispatch`. |
| Deploys only from `main` | Besides the trigger, the `github-pages` environment allows deployments only from `main` (custom branch policy). A manual dispatch on another branch would be refused at the `deploy` job. Pages source: `build_type: workflow`. |
| Failed tests block deployment | On `main` the `build` job `needs: [db-tests, browser-tests]` (the two workflows, reused), and `deploy` needs `build`. A failure or cancellation stops the deploy. |
| Production sharing stays off | Production build mode, as in section 6. |
| No production database migration | No workflow touches a remote database. |

Note: **merging this PR deploys the new client to the public website** (`vegalh.github.io/rootmapmvp`, cloud on,
the rootmap-staging project, which doesn't have the six sharing migrations). That is the intended `main`-branch
behavior, and sharing stays off there. It is why the risk in section 9 matters before merging.

`can_admins_bypass` is `true` on the `github-pages` environment. That is acceptable for a one-owner repository.

## 8. Branch protection (read on 2026-11-02, not changed)

| Setting | State |
|---|---|
| Classic branch protection on `main` | **None** ("Branch not protected"). |
| Rulesets | One, `rootmapmvp`: **disabled**, targets no branch. If enabled it would block deletion and force push (`deletion`, `non_fast_forward`). |
| Rules in effect for `main` | **None**. |
| Pull request review required | No. |
| Passing status checks required | No. |
| Up-to-date branch required | No. |
| Force pushes blocked | No. |

Recommended settings for `main` (owner's decision; nothing was changed):

- Require a pull request before merging. With one maintainer, required approvals = 0, or the owner reviews and merges.
- Require status checks to pass, with these exact check names (from the PR runs):
  - `db-tests` (workflow "Database tests")
  - `browser` (workflow "Browser tests")
- Require branches to be up to date before merging.
- Block force pushes and deletion. Enabling the existing `rootmapmvp` ruleset with `~DEFAULT_BRANCH` as its target
  does both.

## 9. Remaining blockers and risks

Not done, and not claimed:

1. **Branch protection** is not enabled (section 8).
2. **The new client has not been tested against a pre-sharing database.** Merging deploys it against rootmap-staging,
   which has the 10 pre-sharing migrations. The code review and `flags.mjs` found no dependency on the new objects
   while sharing is off, but no test runs the signed-in app (sign-in, sync, photos, guest import, Recently Deleted)
   against that schema. Suggestion before merging: run `cloud.mjs`, `sync.mjs` and `guestImport.mjs` against a
   disposable stack reset to `20261027000200`.
3. Staging database and photo backups.
4. Real-device testing: physical phones, Safari/WebKit, WeChat.
5. A migration rehearsal on a copy of staging data, and the undo migrations.
6. A controlled staging rollout. Shared sync can't be turned on outside a development server without a deliberate
   code change, and that change still needs to be designed.
7. Residual risks accepted in the release review (S1, S3, S4, S5 and others): see its section C.

Smaller notes: the deploy `build` job uses Node 22 while the test jobs use Node 24. The Supabase CLI on the runner
is 2.120.0 (2.122.0 is available).

## 10. Merge recommendation

**Not ready to merge yet.** CI is green on Linux for every check, and the deploy pipeline is gated correctly.
Before merging:

1. Enable branch protection with the `db-tests` and `browser` required checks (section 8).
2. Close blocker 2 (the client on a pre-sharing database), or the owner explicitly accepts that risk, since merging
   deploys to the public website.

Items 3–6 block **enabling sharing on staging**, not merging this switched-off code. Phase 5 has not started.

## 11. Final Pre-Merge Verification

Date: 2026-11-03. Branch `feature/shared-child-profiles` at `8b8fa59` (= `origin`), working tree clean before this
work. `main` is still `80cae2e`, the branch's merge base, so the branch is 0 commits behind and needs no update. PR #4
is open, mergeable (`clean`), and both checks passed on `8b8fa59` (`db-tests` run 41372531422, `browser` run
41372531402). Nothing was merged or deployed. Staging, production and the repository's own local stack were not
touched, and Phase 5 has not started.

### 11.1 Old-schema migration boundary

Checked against git, not assumed. `origin/main` has exactly 10 migrations, `20261012000100_ownership` …
`20261027000200_admin_grants`. The branch adds 6 files (`20261101000100` … `20261102000100`) and modifies none of the
10 (`git diff origin/main..HEAD -- supabase/migrations`: 6 added files, 0 modified). Outside `migrations/`,
`supabase/` (config, `verify-photo`) is identical on both. **The boundary is `20261027000200`.**

The disposable stack was a separate git worktree of `8b8fa59` with `main`'s `supabase/migrations`, its own
`project_id` (`rootmap-oldschema`) and its own ports (55321…). It ran next to the repository's `rootmap` stack without
touching it. `supabase start` applied the 10 migrations. A database check found 10 rows in `schema_migrations` (last
`20261027000200`), no `child_memberships` or `child_invitations` table, none of the 12 sharing functions, and no
`photos.child_id` or `record_versions.child_id` column. The CI step (11.2) reaches the same schema by `supabase db
reset --local --version 20261027000200`, which was rehearsed here too.

### 11.2 Tests executed

The current app code (`8b8fa59` plus this section's test-only changes) against the old schema, sharing off (dev
servers without `VITE_ROOTMAP_SHARED_SYNC`; the app reached only `127.0.0.1:55321`).

**Added: `tests/ops/oldSchema.mjs`.** It refuses a stack that is not local or that has any sharing migration, table,
function or column. It runs `cloud.mjs`, `spaces.mjs`, `sync.mjs`, `guestImport.mjs`, `analytics.mjs` and `flags.mjs`
with every request a test browser sends to the stack logged (`RM_REQUEST_LOG`, new in `cloudkit.mjs`: method, path,
response status, and the *names* of the fields in table writes, never values). It then checks the log. The CI
`browser` job now runs it after the cloud suites, on the same throwaway stack reset to `20261027000200`. The check name
`browser` is unchanged.

**Added to `sync.mjs`** (gaps found while mapping coverage, below): restoring a backup while signed in (new on this
branch, not behind the sharing switch, and before this only tested with sharing on), and restoring a child from
Recently Deleted, both checked on the server and on the second device.

| Run (local, macOS) | Result |
|---|---|
| `oldSchema.mjs` #1 (stack started with the 10 migrations) | 58/58 steps (cloud 15, spaces 10, sync 12, guestImport 7, analytics 11, flags 3); 4/4 log checks; 2,700 requests |
| `oldSchema.mjs` #2 (after reset to 16 and back to `20261027000200`, as in CI) | analytics.mjs stopped at sign-in ("no code email", see 11.9); every other suite passed; 3/4 log checks (the failed one is "every suite passed") |
| `analytics.mjs` alone, same stack | 11/11 |
| `oldSchema.mjs` #3, same stack | 58/58 steps; 4/4 log checks; 1,865 requests |
| CI rehearsal of the edited `browser` job: reset to all 16 migrations → `npm run test:e2e:cloud` → reset to `20261027000200` → `oldSchema.mjs` | `test:e2e:cloud` 117/117 steps in 10/10 suites (the earlier 115 plus the 2 new `sync.mjs` steps); then 60/60 steps (`sync.mjs` now 14) and 4/4 log checks; 2,934 requests |
| `oldSchema.mjs` #4, final logger (a line when a request is sent, so one cut off by a reload or a closed browser is counted too) | 60/60 steps; 4/4 log checks; 2,940 requests |
| `sync.mjs` with the two new steps, old schema (before #4) | 14/14 |
| Database tests on the old schema, the 12 files that test pre-sharing behaviour (`auth`, `profile`, `storage`, `revisions`, `security`, `sync-cursor`, `sync`, `sync-full-audit`, `photos`, `guestImport`, `analytics`, `account-deletion`) | 160/163. The 3 failures are all in `account-deletion.test.ts`, which this branch rewrote to assert a rule the sharing migrations add (an account that owns a child can't be deleted). `main`'s version of that file on the same stack: 5/5 |
| Unit tests / typecheck | 213/213 / clean |

`sync.test.ts`, `sync-full-audit.test.ts` and `photos.test.ts` drive the branch's own sync engine (`syncDevice.ts`,
changed on this branch). So they test the new client code against the old server, not only the old server.

Requested scenarios and what covers them on the old schema:

| Scenario | Covered by |
|---|---|
| Email authentication | `cloud.mjs` (codes, wrong/expired code, offline, required password, password sign-in, Forgot password), `auth.test.ts` |
| Existing child profiles | `cloud`, `spaces`, `sync` (add, edit, merge conflicts, two devices), `sync-full-audit` |
| Moments / Journal | `sync.mjs` (Moment with photo shown on device 2's Moments), `guestImport.mjs`, `sync.test.ts`, `sync-full-audit`. A Journal is one child's Moments, the same `entries` rows. The Journal *screen* isn't opened in a cloud suite; it reads only local data |
| Activities | `sync-full-audit` (activity_records, every collection); the browser suites read but don't write activity records |
| My Week | `guestImport.mjs` (plan uploaded), `sync-full-audit` (plans, saved activities, saved collections: conflicts, deletions, convergence) |
| Photo upload and retrieval | `sync.mjs` (offline upload, `verify-photo`, download and display, Try Again), `guestImport.mjs`, `photos.test.ts` |
| Account switching | `spaces.mjs`, `sync.mjs` (A → guest → B → A) |
| Local IndexedDB persistence | `spaces.mjs`, `cloud.mjs` (database dumps identical across sign-in, sign-out, reload) |
| Cloud synchronization | `sync.mjs`, `sync.test.ts`, `sync-cursor`, `sync-full-audit` |
| Guest data import | `guestImport.mjs` (offer, upload, `complete_migration`, Not now, offline, interrupted), `guestImport.test.ts` |
| Sign-out and sign-in | `cloud.mjs`, `sync.mjs`, `spaces.mjs` |
| Existing data restoration | a returning sign-in and a new device receiving everything (`cloud`, `sync`, `sync-full-audit` third device); **new:** signed-in backup restore, and Recently Deleted (`sync.mjs`) |

### 11.3 Results

The new app works on the pre-sharing database: every suite and database test passed except the expected
account-deletion rule (11.2), and the one-off sign-in flake (11.9). No fix to app code was needed.

### 11.4 Missing coverage

- Real staging was not used, by design. The old schema is rebuilt from the repository's migrations, so it matches
  staging only if staging has never been changed by hand (AGENTS.md forbids it). Before merging, the owner can confirm
  `supabase migration list` for rootmap-staging ends at `20261027000200`; that's a read, but it wasn't run here.
- The Journal, Activities and My Week *screens* aren't driven in a cloud browser suite. Their data paths are covered
  (above), and they read only local data.
- An operator deleting an owner's auth account behaves as it does on `main` today (allowed, the family orphaned), not
  as the new rule. This is an operator action with no app path.
- Real phones, Safari/WebKit and WeChat (unchanged from section 9).

### 11.5 Evidence that sharing endpoints aren't called

**Tested (network).** Across runs #1, #3, #4 and the CI rehearsal (10,439 requests from 6 suites), no request went to `child_memberships`,
`child_invitations` or any of `create_invitation`, `list_invitations`, `revoke_invitation`, `get_invitation_preview`,
`accept_invitation`, `set_member_role`, `remove_member`, `leave_circle`, `child_circle`, `set_circle_relationship`,
`circle_joins`, `dismiss_circle_joins`. No write to `photos` or `record_versions` sent `child_id`. The fields sent to
`photos` were the original columns only. The app called 59 distinct endpoints, all of them pre-sharing tables, the RPCs
`create_family`, `complete_migration`, `record_usage`, `am_i_admin`, `admin_usage_summary`, `verify-photo`, storage and
auth. Every refused or unanswered request was one the suites expect: wrong or expired codes, a wrong password, a parent
refused the admin summary, offline attempts, and requests cancelled by a reload or sign-out. `flags.mjs` also checks, through the UI, that
there's no circle on a child's page and no invitation page.

**Code review.** Every client use of a sharing table, function or column is behind `sharedSyncEnabled` or needs a child
of another family, which can't exist while it's off:

| Use | Gate |
|---|---|
| Membership read for Recently Deleted (`App.tsx`) | `sharedSyncEnabled` |
| Circle, circle-joins notice, kept versions (`App.tsx` → `ChildCircle`, `CircleJoins`, `KeptVersions`) | `sharedSyncEnabled` |
| `#/invite` route and `InvitePage` RPCs | `cloudConfig.enabled && sharedSyncEnabled` (`allowedRoute`) |
| Membership fetch, removals, other families' scopes, shared photo assignments (`sync/scopes.ts`) | `syncScopes(..., { enabled: sharedSyncEnabled })`; off, it is exactly the old single-family round |
| `photos.child_id` (`mapping.ts`) | sent only with `childHint`, which is set only by shared photo assignments (gated) and `copyPhotoForFamily` for a child of another family |
| `complete_migration` | same signature `(uuid, text, jsonb)` on both schemas |

### 11.6 Production feature isolation

| Condition | How verified | Result |
|---|---|---|
| Sharing disabled in production | Code + bundle. `sharedSyncEnabled = VITE_ROOTMAP_SHARED_SYNC === "on" && MODE === "development"`. A production build with every switch on (`GITHUB_PAGES=true`, cloud, analytics and shared sync on) compiles it to `Hu?.VITE_ROOTMAP_SHARED_SYNC==="on"&&Hu?.MODE==="development"`, where `Hu.MODE` is the literal `production` | off |
| Environment variables alone can't enable it | Mode comes from `--mode`, not a variable, and the deploy runs plain `npm run build`. Tested by `flags.mjs` (production and staging builds with every switch on: no invitation opens, the token is sent nowhere). The only `--mode development` build (the Figma preview) can reach only a loopback stack (`urlAllowed`) | yes |
| Invitation routes inaccessible | `allowedRoute` (code), `flags.mjs` (tested, also on the old schema) | yes |
| Circle management inaccessible | gated in `App.tsx` (code), `flags.mjs` "no circle" (tested) | yes |
| Sharing background sync doesn't run | `syncScopes` with `enabled: false` (code); no membership request in 10,439 (tested) | yes |
| Existing family sync works | 11.2 | yes |
| Production doesn't need the new migrations | 11.2, 11.5 | yes |
| No migration runs during deployment | No workflow has a Supabase token, project ref, `link`, `db push`, `migration up` or `functions deploy`. Every Supabase command is `--local` on the runner (`db-tests.yml`, `e2e-tests.yml`) | yes |

Note: the sharing code ships in the production bundle (the strings are present). It's switched off at run time, not
compiled out.

### 11.7 Branch protection status (read 2026-11-03, nothing changed)

Unchanged from section 8. `main`: `protected: false`, no rules in effect (`GET /rules/branches/main` → `[]`). One
ruleset, `rootmapmvp` (id 24846951): `enforcement: disabled`, empty `include`, rules `deletion` and `non_fast_forward`,
no bypass actors. Required Linux checks on the PR: `db-tests` and `browser`, both GitHub Actions, both green on
`8b8fa59`. The latest Pages deployment is still `main@80cae2e` (2026-10-30), and no workflow ran for the feature branch
except the two PR workflows.

**Permission:** not established. `gh` isn't installed, and reading the stored GitHub credential was declined, so only
public, unauthenticated reads were possible. Those can't show the account's role. As the repository owner,
`vegalh` has admin rights and can configure rulesets.

### 11.8 Recommended ruleset (owner's approval needed; not applied)

Edit the existing `rootmapmvp` ruleset rather than adding a second one: Settings → Rules → Rulesets → `rootmapmvp`.

| Setting | Value |
|---|---|
| Enforcement status | Active |
| Bypass list | Empty (for an emergency the owner can set the ruleset to Disabled for a moment; that change is logged) |
| Target branches | Include default branch (`~DEFAULT_BRANCH` = `main`) |
| Restrict deletions | On |
| Block force pushes | On |
| Require a pull request before merging | On. Required approvals **0** (one maintainer: a required approval would make every merge impossible, since an author can't approve their own PR). Other review options off. Allowed merge methods: merge, squash, rebase |
| Require status checks to pass | On. "Require branches to be up to date before merging" on. Checks: `db-tests` and `browser`, source GitHub Actions |
| Others (linear history, signed commits, deployments, code scanning) | Off: `main` has merge commits, and nothing signs commits today |

The same as a ruleset body (for `PUT /repos/vegalh/rootmapmvp/rulesets/24846951`):

```json
{
  "name": "rootmapmvp",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false,
      "require_code_owner_review": false, "require_last_push_approval": false, "required_review_thread_resolution": false,
      "allowed_merge_methods": ["merge", "squash", "rebase"] } },
    { "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": true, "do_not_enforce_on_create": false,
      "required_status_checks": [ { "context": "db-tests", "integration_id": 15368 }, { "context": "browser", "integration_id": 15368 } ] } }
  ]
}
```

Things to know before approving:

- **Direct pushes to `main` stop.** Until now every commit on `main` was pushed directly. With this ruleset, every
  change, documentation included, needs a PR and both checks (about 15–20 minutes of CI). Both workflows run on every
  `pull_request` with no path filter, so a required check never waits forever.
- "Up to date" means a PR opened before another merge must be updated (the "Update branch" button) and re-run.
- The deploy on `main` still re-runs both workflows before deploying (section 7). The ruleset doesn't change that.

### 11.9 Remaining risks

1. **Merging deploys the new client to the public website** against rootmap-staging. Compatibility with that schema is
   now tested (11.2), and the `browser` check keeps testing it on every PR and before every deploy, until staging has
   the sharing migrations. After that, the old-schema step can be removed.
2. Staging is assumed to match the repository's 10 migrations (11.4).
3. One cloud sign-in flake. In 1 of 3 full runs, `analytics.mjs` found no code email: the code request never reached
   the stack. No request was logged from that browser, and the auth server's last code request belonged to the
   previous suite. The suite passed alone and in the next full run. This was not seen in CI before. In CI it would fail
   the `browser` check and block a merge until re-run; it can't deploy anything wrong.
4. The sharing code is in the production bundle, gated at run time (11.6).
5. From section 9: staging backups, real devices, a migration rehearsal on a copy of staging data, and the staging
   rollout design. These block enabling sharing, not merging.

### 11.10 Merge recommendation

**B. READY AFTER REPOSITORY SETTINGS.**

- Old-schema compatibility: verified by tests (11.2, 11.3), and now checked by the required `browser` check.
- Production sharing: off, by tests and code review (11.6).
- Linux CI: green on `8b8fa59`. The commit with these test changes needs its own green `db-tests` and `browser` runs;
  those are recorded on the PR, not here.
- No unresolved critical or high-severity issue. The risks in 11.9 are known and either covered by CI or block only
  enabling sharing.
- Remaining: the owner approves and applies the ruleset in 11.8, then merges. Optionally, first confirm staging's
  migration list (11.4).
