# Shared Child Profiles: rollout to existing testers

RootMap hasn't launched. The testers use the public website (GitHub Pages), which talks to `rootmap-staging`, the
only Supabase project. This is the shortest safe path to giving them Shared Child Profiles (Phases 1–5).

## 1. Staging today (read-only checks, 2026-11-03, re-run after ownership transfer was added)

| Check | Result |
|---|---|
| Applied migrations (`npx supabase migration list --linked`) | the 10 pre-sharing ones, through `20261027000200`; the 8 sharing migrations are pending |
| Data | 6 accounts, 2 families (one member each), 3 children, 1 Moment, 18 activity records, 2 photos (2 files); no kept versions |
| Ownership backfill (`20261101000100`) | **0** families it would refuse: each family with children has exactly one member, its owner |
| `pgcrypto` (used for invitation tokens) | installed, schema `extensions` |
| Edge Function `verify-photo` | deployed (version 1); unchanged in the repo since then, so no redeploy |

**Pending migrations, in order:**

| File | Adds |
|---|---|
| `20261101000100_child_memberships.sql` | per-child memberships; one Owner per existing child (backfill) |
| `20261101000200_child_access.sql` | RLS and triggers by child role |
| `20261101000300_shared_photos.sql` | photos added for a shared child |
| `20261101000400_circle.sql` | relationships, the circle |
| `20261101000500_invitations.sql` | invitations, role change, removal, leaving |
| `20261102000100_circle_joins.sql` | join notices |
| `20261103000100_entry_authors.sql` | who added a Moment |
| `20261103000200_ownership_transfer.sql` | handing a profile to an Add & Edit member |

**Tester data to preserve:** all of it, and the migrations keep it in place. They add tables, columns, functions and
policies. The only rows they write are one Owner membership per existing child (3 rows). `tests/ops/upgrade.mjs` (in
CI) checks that a pre-sharing database with data upgrades with its content unchanged. Storage files aren't touched.
The one safety step is a data dump just before applying (step B1): a single file, seconds to make.

## 2. Steps

### A. Merge the PR (no approval beyond the merge)

The merge deploys the new client. Sharing stays off because `VITE_ROOTMAP_SHARED_SYNC` is unset, and CI's
pre-sharing-schema step checks that this client works against staging as it is today.

### B. Apply the 8 migrations to rootmap-staging (**needs the owner's approval**)

Run from the repository root (linked to `cbgkkeveprftddrobzao`). Docker must be running for the dump.

1. `npx supabase db dump --linked --data-only -f ~/rootmap-staging-before-sharing.sql`. Keep this file out of the
   repository: it holds tester data.
2. `npx supabase db push --linked --dry-run`. It should list exactly the 8 files `20261101000100` …
   `20261103000200`.
3. `npx supabase db push --linked`. Each file runs in its own transaction. If the backfill refused, it would roll
   back and stop there with nothing changed.
4. Check:
   - `npx supabase migration list --linked`: 18 local = 18 remote.
   - `npx supabase db query --linked "select count(*) filter (where n <> 1) as bad, count(*) as children from (select (select count(*) from public.child_memberships m where m.family_id = c.family_id and m.child_id = c.id and m.role = 'owner') n from public.children c) x"`
     should give `bad = 0` and `children = 3`.

The website keeps working throughout: the deployed client ignores the new objects while sharing is off (tested in CI).
5. Sign in on the website as one existing tester account you control. Its children, Moments and photos should be
   there as before, and Account should say "All backed up".

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
| 7 | A: Manage › change B back to Add & Edit › **Hand Over Profile** next to B › Send Request | A: "Waiting for B to accept"; A still manages |
| 8 | B: My Children › Accept › Accept | B: Manage on the child's page. A: "What you can do: Add & Edit"; no Edit Profile, Delete or Manage |
| 9 | B: Manage › Hand Over Profile next to A; A accepts on the child's page | A manages again |
| 10 | A: Manage › Remove from Circle (B) | B: the child disappears within a minute, "You no longer have access…" |
| 11 | A: add a second child, invite B, hand it to B (steps 7–8); B: Manage › Remove from Circle (A) | A: that child disappears within a minute, "You no longer have access…"; A's other children stay |

The same flow runs automatically in CI on every PR (`tests/e2e/multiAccount.mjs`, against a local stack), so this
step only confirms the real website and project.

### E. Real-device checks (essential only, about 15 minutes)

Browser tests use Chrome with phone emulation, so these are the only things they can't show. Use real phones with
the two test accounts from D.

| Device | Check |
|---|---|
| iPhone, Safari | open an invitation link signed out, sign in with the email code, Accept; add a Moment with a photo from the camera roll |
| iPhone or Android, inside WeChat | open the link from a WeChat chat; as Owner, Copy Link (if copying fails, the link field appears and can be long-pressed) |
| Android, Chrome | Accept and Decline a handed-over profile (D, steps 7–8); the confirm sheet fits the screen, nothing scrolls sideways |

If one fails, switch sharing off (step C) while it is fixed. The data stays.

## 3. Not done, on purpose

No new backup system, no migration tooling, no staging-only test suite. Before a public launch with real families,
the release-readiness items still apply: scheduled backups (a paid Supabase plan includes them), physical devices
and WeChat, and a separate production project.

After step B, CI's "Browser suites on the pre-sharing schema" step no longer reflects staging and can be removed.
