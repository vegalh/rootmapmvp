# Shared Child Profiles: rollout to existing testers

RootMap hasn't launched. The testers use the public website (GitHub Pages), which talks to `rootmap-staging`, the
only Supabase project. This is the shortest safe path to giving them Shared Child Profiles (Phases 1–5).

## 1. Staging today (read-only checks, 2026-11-03)

| Check | Result |
|---|---|
| Applied migrations (`npx supabase migration list --linked`) | the 10 pre-sharing ones, through `20261027000200`; the 7 sharing migrations are pending |
| Data | 6 accounts, 2 families (one member each), 3 children, 1 Moment, 18 activity records, 2 photos (2 files); no kept versions |
| Ownership backfill (`20261101000100`) | **0** families it would refuse: each family with children has exactly one member, its owner |
| `pgcrypto` (used for invitation tokens) | installed, schema `extensions` |
| Edge Function `verify-photo` | deployed (version 1); unchanged in the repo since then, so no redeploy |

**Tester data to preserve:** all of it, and the migrations keep it in place. They add tables, columns, functions and
policies. The only rows they write are one Owner membership per existing child (3 rows). `tests/ops/upgrade.mjs` (in
CI) checks that a pre-sharing database with data upgrades with its content unchanged. Storage files aren't touched.
The one safety step is a data dump just before applying (step B1): a single file, seconds to make.

## 2. Steps

### A. Merge the PR (no approval beyond the merge)

The merge deploys the new client. Sharing stays off because `VITE_ROOTMAP_SHARED_SYNC` is unset, and CI's
pre-sharing-schema step checks that this client works against staging as it is today.

### B. Apply the 7 migrations to rootmap-staging (**needs the owner's approval**)

Run from the repository root (linked to `cbgkkeveprftddrobzao`). Docker must be running for the dump.

1. `npx supabase db dump --linked --data-only -f ~/rootmap-staging-before-sharing.sql`. Keep this file out of the
   repository: it holds tester data.
2. `npx supabase db push --linked --dry-run`. It should list exactly the 7 files `20261101000100` …
   `20261103000100`.
3. `npx supabase db push --linked`. Each file runs in its own transaction. If the backfill refused, it would roll
   back and stop there with nothing changed.
4. Check:
   - `npx supabase migration list --linked`: 17 local = 17 remote.
   - `npx supabase db query --linked "select count(*) filter (where n <> 1) as bad, count(*) as children from (select (select count(*) from public.child_memberships m where m.family_id = c.family_id and m.child_id = c.id and m.role = 'owner') n from public.children c) x"`
     should give `bad = 0` and `children = 3`.

The website keeps working throughout: the deployed client ignores the new objects while sharing is off (tested in CI).

### C. Switch sharing on for testers (**needs the owner's approval**)

1. GitHub › Settings › Secrets and variables › Actions › Variables: add `VITE_ROOTMAP_SHARED_SYNC` = `on`.
2. Actions › "Deploy to GitHub Pages" › Run workflow (main). It runs the CI tests, then deploys.

**To switch it off again:** delete the variable and run the workflow again. The migrations can stay: a client with
sharing off works against them, as in step B.

### D. Verify on the website with two test accounts

Use two test accounts that aren't real testers. A: Owner. B: invited. Then C, a third account, or B again after a
role change.

| # | Step | Expected |
|---|---|---|
| 1 | A: add a child, a Moment | "All backed up" on Account |
| 2 | A: child › Circle › Manage › Invite Someone › Add & Edit › Create link › Copy | link copied (or shown to copy by hand) |
| 3 | B (signed out, other browser or phone): open the link, sign in | preview "Join {child}'s Circle", invited by A |
| 4 | B: Accept | the child's profile with A's Moment |
| 5 | B: add a Moment | A sees it within a minute; its page says "Added by B" |
| 6 | A: Manage › change B to View Only | B: no Add or Edit; "What you can do: View Only" |
| 7 | A: Manage › Remove from Circle | B: the child disappears within a minute, "You no longer have access…" |

The same flow runs automatically in CI on every PR (`tests/e2e/multiAccount.mjs`, against a local stack), so this
step only confirms the real website and project.

## 3. Not done, on purpose

No new backup system, no migration tooling, no staging-only test suite. Before a public launch with real families,
the release-readiness items still apply: scheduled backups (a paid Supabase plan includes them), physical devices
and WeChat, and a separate production project.

After step B, CI's "Browser suites on the pre-sharing schema" step no longer reflects staging and can be removed.
