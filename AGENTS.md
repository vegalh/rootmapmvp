# RootMap MVP

React + Vite + Tailwind CSS prototype for RootMap, a Montessori-style classroom tracking app.

## Development Server

A Vite development server is **already running** on `$PORT` (default 8443). You don't need to start it manually.

- Preview URL: The user can access the running app through the preview panel
- Hot reload: Changes to source files are reflected immediately

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css`, loads saved data (`initData`), then mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Composition root: holds all top-level state and renders the active page based on `screen`
- `src/types.ts` - Shared TypeScript types (`Child`, `Activity`, `LessonRecord`, `Observation`, `Screen`, etc.)
- `src/data/` - Seed/mock content, edit these to change what shows up in the app:
  - `children.ts` - The list of children/students. **Add a child or change a photo here.**
  - `progress.ts` - Lesson records, observations, and the lesson options offered per learning area.
  - `activities.ts` - Discover page activities/lessons and category list. **Add a new lesson/activity here.**
  - `thoughts.ts` - The "A Thought for Parents" reflections (English + Chinese) shown on Today, one per day.
- `src/lib/` - Small framework-agnostic helpers:
  - `i18n.ts` - English/Chinese translation strings (`copy`) and the `Copy` type.
  - `data/` - The data access layer. All persistent data goes through it (never call localStorage/IndexedDB from screens). See [docs/data-architecture.md](docs/data-architecture.md).
    - `hooks.ts` - `useCollection(name)` (record lists with soft delete) and `useSetting(key)`.
    - `store.ts` - Start-up load, the single write path, photos, backup export/restore.
    - `schema.ts` - IndexedDB stores, spaces (guest `rootmap`, one `rootmap-account-<userId>` per account), outbox types, legacy key names, id helpers. `device.ts` - the device id. `guestPlan.ts` - read-only guest snapshot and the first-login migration plan (which records are the parent's, untouched demo, or uncertain). `legacy.ts` / `migrate.ts` - One-time migration from localStorage. `records.ts` - Per-record diffing and timestamps.
  - `storage.ts` - localStorage primitives and storage-error reporting (`onStorageError`).
  - `photos.ts` - `addPhoto` (resize + store, returns a photo id) and `photoUrl` (id → image URL to render).
  - `welcome.ts` - Whether this device still shows the Welcome screen (new devices only, cloud builds only).
  - `dates.ts` - Date formatting helpers (`fmt`, `isoToday`).
  - `entries.ts` - Helpers for the unified Moments/Journal entry collection: search, month grouping, and the idempotent import of legacy observations and child notes.
  - `journalDrafts.ts` - Autosaved editor drafts (IndexedDB store `drafts`).
  - `cloud/` - Cloud settings. `environment.ts` decides from the Vite mode and `VITE_*` variables whether this build may use Supabase (off by default, always off for the public website); `config.ts` is the app's `cloudConfig`; `client.ts` loads Supabase lazily (never in the public build); `auth.ts` email-code sign-in, session restore, sign-out; `account.ts` idempotent family/profile setup; `session.ts` app-wide sign-in state; `hooks.ts` `useCloudState()` for screens; `space.ts` which local space opens (from the stored session) and when to switch.
  - `sync/` - Record sync for the signed-in account (Phase 2B-2 M4): `mapping.ts` local records ↔ server rows, `resolver.ts` conflict rules, `engine.ts` push/pull rounds, `runner.ts` when sync runs and its status, `status.ts` what "All backed up" means, `photos.ts` photo files (upload, server verification, checked download), `guestImport.ts` bringing guest data into the account (Phase 2B-2 M6: offer, questions, atomic copy into the account space, upload by sync, verified completion with `complete_migration()`).
  - `platform/` - The only code that differs between the website and the future iOS app (session storage, saving a file). Web adapters only so far.
- `src/components/` - Reusable building blocks shared across pages:
  - `Icon.tsx` - SVG icon set used throughout the app.
  - `TreeLogo.tsx` - RootMap brand logo.
  - `ui.tsx` - Shared UI atoms: `PageHeader`, `BottomNav`, `Shell`, `FilterSelect`, `Field`, `Modal`, `Empty`, `NotificationToggle`.
  - `OpeningExperience.tsx` - Opening animation, Welcome and the email + 6-digit code sign-in screens.
  - `ModalOverlay.tsx` - Central modal dispatcher (quick-add, filters, add child, plan, week-add).
  - `EntryTimeline.tsx` - Month-grouped entry list plus the shared add/search controls used by Moments and Journal.
- `src/pages/` - One file per screen, rendered by `App.tsx`:
  - `TodayPage.tsx` (home: Today's Inspiration, Looking Back, A Thought for Parents; read-only), `ChildrenPage.tsx` (Kids tab), `DiscoverPage.tsx`, `ActivityDetailPage.tsx`, `MomentsPage.tsx`, `ChildProfilePage.tsx` (Journal | Activities), `EntryEditorPage.tsx` (the one editor for every memory), `EntryDetailPage.tsx`, `ProfilePage.tsx`, `AccountPage.tsx` (signed-in email, backup status, earlier memories, Sign out), `GuestImportPage.tsx` (the "Bring your memories into your account?" question), `MyWeekPage.tsx`, `GoalsPage.tsx`, `SettingsPage.tsx`, `NotificationsPage.tsx`, `RecordFormPage.tsx` (activity records only).
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and Figma Make plugins plus the `@` alias for `src`
- `supabase/` - Cloud backend (Phase 2), not yet used by the app. See [docs/data-architecture-phase2.md](docs/data-architecture-phase2.md).
  - `functions/verify-photo/` - Edge Function that checks an uploaded photo file against its SHA-256 before it counts as backed up (runs on the local stack; not deployed to staging yet).
  - `migrations/` - The database schema, RLS, storage policies and triggers as versioned SQL. **Every database change is a new migration file; never edit an applied one or change the database by hand.**
  - `config.toml` - Local Supabase stack settings (`npm run db:start`, needs Docker).
- `tests/db/` - Database tests against the local stack (`npm run test:db`): two-account security, storage, revisions, sync cursor, email-code sign-in and account setup, record sync (`sync.test.ts`), photo files and their privacy (`photos.test.ts`), guest data brought into an account (`guestImport.test.ts`).

## Making common changes

- **Add a new lesson/activity**: append an entry to the `activities` array in [src/data/activities.ts](src/data/activities.ts).
- **Add or edit a child / change a photo**: edit [src/data/children.ts](src/data/children.ts).
- **Add a new page/screen**: create a file in `src/pages/`, add its name to the `Screen` union in [src/types.ts](src/types.ts), and wire it into the `content()` switch in [src/App.tsx](src/App.tsx).
- **Change translation text**: edit `copy.en` / `copy.zh` in [src/lib/i18n.ts](src/lib/i18n.ts).
- **Show a stored photo** (child, profile, entry): `<img src={photoUrl(ref)} />`; photo fields hold ids, not URLs.
- **Cloud settings for development or staging**: copy the relevant block of [.env.example](.env.example) into `.env.development.local` or `.env.staging.local` (git-ignored). Never put a secret key in a `VITE_` variable; the dev server and build refuse it.
- **Add a persisted collection or setting**: add it to [src/lib/data/schema.ts](src/lib/data/schema.ts) (a new object store needs a `DB_VERSION` bump and an upgrade step in `idb.ts`) and read it with `useCollection` / `useSetting`.

## Dependencies

- Runtime: React 19 and React DOM 19
- Styling: Tailwind CSS v4 with the `@tailwindcss/vite` plugin
- Build tooling: Vite 8, TypeScript 5.7, and `@vitejs/plugin-react`
- Formatting: oxfmt 

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. This scaffold does not need a Tailwind config file or PostCSS config.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Keep CSS `@import` statements first, then add any `@font-face` rules and font-family defaults there.

## Code quality

- Use double quotes for strings containing apostrophes (`"We're here to help"`), or escape them in single-quoted strings. An unescaped apostrophe in a single-quoted string breaks the build.
- Ensure JSX tags are closed and braces are balanced.
- Export components as default exports.
