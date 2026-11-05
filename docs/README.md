# Docs

Design notes for how RootMap stores, syncs and shares data. The files stay at these paths because code, tests and database migrations link to them; this page is the map.

## How data works

Read these first.

1. [data-architecture.md](data-architecture.md): Phase 1, the data kept on the device (IndexedDB, the single write path, photos, backups).
2. [data-architecture-phase2.md](data-architecture-phase2.md): Phase 2, the cloud (Supabase, sign-in, sync, guest import, usage analytics, the public website's settings).

## Shared Child Profiles

A child's profile shared between families (grandparents, co-parents), in the order it was built.

| Phase | Doc | What it covers |
|---|---|---|
| 0 | [shared-child-profiles-phase0.md](shared-child-profiles-phase0.md) | Readiness checks before any database change (tests, migrations, backups) |
| 1a | [shared-child-profiles-phase1a.md](shared-child-profiles-phase1a.md) | Child memberships, the one-owner rule |
| 1b | [shared-child-profiles-phase1b.md](shared-child-profiles-phase1b.md) | Access to a child's records by role |
| 2a | [shared-child-profiles-phase2a.md](shared-child-profiles-phase2a.md) | Syncing children from other families |
| 2b | [shared-child-profiles-phase2b.md](shared-child-profiles-phase2b.md) | On the device: shared photos, data safety |
| 3 | [shared-child-profiles-phase3.md](shared-child-profiles-phase3.md) | Role-aware screens, a child's circle |
| 4 | [shared-child-profiles-phase4.md](shared-child-profiles-phase4.md) | Invitations and managing the circle |
| 5 | [shared-child-profiles-phase5.md](shared-child-profiles-phase5.md) | Writing together, handing over a profile |

Shipping it:

- [shared-child-profiles-pr-readiness.md](shared-child-profiles-pr-readiness.md): the pull request checklist
- [shared-child-profiles-release-readiness.md](shared-child-profiles-release-readiness.md): the release review and operational checks
- [shared-child-profiles-tester-rollout.md](shared-child-profiles-tester-rollout.md): turning it on for existing testers

## Images

- `screenshots/`: the app screenshots shown in the main README
- `logo.svg`: the RootMap logo used in the main README
