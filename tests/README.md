# RootMap tests

No test dependencies: unit tests use Node's built-in runner (Node 24 runs TypeScript directly), and browser tests
drive headless Chrome over the DevTools protocol with Node's built-in WebSocket.

| Command | What it checks | Needs |
|---|---|---|
| `npm test` | Data layer logic: legacy → IndexedDB record building, photo extraction, duplicate/corrupt data, demo labels, soft-delete diffing; store change notifications; record ids; cloud environment rules and platform adapters; sign-in rules; spaces, outbox entries, device id, the guest migration plan and building the guest copy (`tests/unit/`) | Node 24+ |
| `npm run test:e2e` | The real app in a browser (`tests/e2e/`), each suite on a fresh browser profile | Node 24+, Google Chrome |
| `npm run test:db` | Database schema, RLS, storage, sync cursor, and email-code sign-in with account setup, and record sync with the app's engine: two devices, two accounts, offline, interrupted uploads and downloads, conflicts, held and waiting records, photos; photo files with verify-photo: upload, download, offline, resumable and interrupted uploads, corrupted uploads and downloads, duplicates, privacy between families, Try again; bringing guest data into an account (`guestImport.test.ts`): demo data, unknown origin, duplicate children, id clashes, existing cloud data, repeats, interruptions, offline, missing photos, `complete_migration()`, two accounts and two families (`tests/db/`), against the local stack only | Docker, `npm run db:start` (Mailpit and the Edge runtime must be running) |
| `npm run test:e2e:cloud` | The app in a browser with cloud features on, against the local stack (`tests/e2e/cloud.mjs`, `spaces.mjs`, `sync.mjs`, `guestImport.mjs`; shared set-up in `cloudkit.mjs`) | Docker, the local stack, Google Chrome |
| `npm run typecheck` / `npm run build` | TypeScript and the production build | |

`test:e2e` starts its own Vite dev server on a spare port. To use one that's already running:
`RM_BASE=http://localhost:8443 npm run test:e2e`. Set `CHROME_PATH` if Chrome isn't in the default macOS location.

## Browser suites

- `app.mjs`: one simulated family device. It seeds localStorage in the pre-IndexedDB format (`fixture.mjs`: Unicode names, several inline photos, drafts, deleted children, a corrupt key), then checks:
  - **Migration:** every collection migrates exactly; localStorage is left untouched; refreshes, re-runs and interrupted runs create no duplicates; a failed migration keeps the original data.
  - **Everyday use:** new and edited Moments, including large photos; drafts; Mark as Tried; deleting and restoring a child; soft deletes; English/Chinese; dark mode; photo uploads; the `?opening` preview.
  - **Persistence and failures:** data survives a browser restart; storage failures show the right messages; backup export works.
- `resilience.mjs`: three storage-problem cases:
  - IndexedDB missing entirely (the app falls back to localStorage, then migrates later).
  - IndexedDB that won't open after migration (the app shows the bilingual Try Again message).
  - Restoring from a backup.
- `tabs.mjs`: two tabs starting the app for the first time at the same moment.
- `cloud.mjs` (separate: `npm run test:e2e:cloud`, needs the local Supabase stack): the app with cloud features on, through its screens. Welcome on a new device (English and Chinese; no password, phone or social buttons); invalid email; offline; wrong and expired codes; new-account sign-in creates the family and profile and uploads nothing; a reload restores the session; Sign out from Profile; returning sign-in reaches the same family; "Continue as Guest"; a device with RootMap data skips Welcome. Local data identical throughout.
- `spaces.mjs` (with `cloud.mjs`): guest data preserved; accounts A and B in separate databases; switching between them and back to guest shows only that space's data; every account change has its outbox entry; a failed or interrupted write stores neither record nor outbox entry; nothing uploaded.
- `sync.mjs` (with `cloud.mjs`): two browsers on one account sync both ways, including after being offline; concurrent edits merge and keep the losing version; a photo added offline is uploaded and verified once back online, then downloaded and shown on the other device; a guest photo is never uploaded; guest data never uploaded; another account receives nothing.
- `guestImport.mjs` (with `cloud.mjs`): a guest device signs in; one question; "Add to my account" uploads the parent's own child, memory, photo, plan and goal (verified, completed on the server) while demo content stays and the guest database is unchanged; not asked again after a reload; a second account is asked separately and "Not now" sends nothing; offline; an upload interrupted by a reload resumes and completes.
- `activities.mjs`: one activity catalog, two ways to record. Kids › child › Add Activity opens the search-first picker (English/Chinese/keyword/partial search, category filters with search, Music category, Recently Used without duplicates, no results); choosing an activity opens the form prefilled (today's local date, optional stage/notes/skills left empty) and stores a record with the catalog id; custom activities need a name and a learning area and never appear in Discover; Mark as Tried from Discover keeps its record shape; older records, new records and tried records all show in the history; refresh, delete, Chinese, dark mode, 390px.
- `reactive.mjs`: changes written to the store outside any screen (children, a soft delete, the language setting, a plan) appear without a reload; a confirmed save is shown only once stored; new goals and repeated plans get `<prefix>-<uuid>` ids.

Every step also fails on any console error, uncaught exception or failed network request.

## After changing the database

- Keep `fixture.mjs` in the **old localStorage format**. It represents devices that haven't migrated yet, and those devices must keep migrating correctly.
- If you add or rename an object store, `__t.dump()` (in `cdp.mjs`) picks it up automatically. Add assertions for it in `app.mjs`.
- If you bump `DB_VERSION`, add a test that starts from a database created by the previous version. Seed it the way `app.mjs` seeds localStorage, then check that the upgrade keeps every record.
