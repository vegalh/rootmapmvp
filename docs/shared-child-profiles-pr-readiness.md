# Shared Child Profiles: pull request readiness

Date: 2026-11-02 (UTC). Companion to [shared-child-profiles-release-readiness.md](shared-child-profiles-release-readiness.md),
which holds the full security review, test matrix and staging plan. This report covers publishing the branch, the
first Linux CI runs, deployment safety and branch protection. Nothing was merged or deployed, and staging and
production were not touched.

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
