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
  - `books.ts` - Discover > Books, the curated picture-book collection. One record per book; the English and Chinese editions share its id and each has its own cover (`coverEn` / `coverZh`). **Add a book here.**
  - `music.ts` - Interactive music activities and their recordings, listed in Discover > Activities (Art & Creativity) with their own page and audio player. **Add a music activity or connect a recording here.**
  - `thoughts.ts` - The "A Thought for Parents" reflections (English + Chinese) shown on Today, one per day.
  - `collections.ts` - Collections made by RootMap, listed in Discover › Collections (After Work, Nothing to Buy …): title/subtitle in both languages and a `match(activity)` rule, so new activities join automatically; optional `months` for seasonal ones. **Add a collection here** (never change an id: saved collections are stored by id).
- `src/lib/` - Small framework-agnostic helpers:
  - `i18n.ts` - English/Chinese translation strings (`copy`) and the `Copy` type.
  - `data/` - The data access layer. All persistent data goes through it (never call localStorage/IndexedDB from screens). See [docs/data-architecture.md](docs/data-architecture.md).
    - `hooks.ts` - `useCollection(name)` (record lists with soft delete) and `useSetting(key)`.
    - `store.ts` - Start-up load, the single write path, photos, backup export/restore.
    - `schema.ts` - IndexedDB stores, spaces (guest `rootmap`, one `rootmap-account-<userId>` per account), outbox types, legacy key names, id helpers. `device.ts` - the device id. `guestPlan.ts` - read-only guest snapshot and the first-login migration plan (which records are the parent's, untouched demo, or uncertain). `legacy.ts` / `migrate.ts` - One-time migration from localStorage. `records.ts` - Per-record diffing and timestamps.
  - `storage.ts` - localStorage primitives and storage-error reporting (`onStorageError`).
  - `photos.ts` - `addPhoto` (resize + store, returns a photo id) and `photoUrl` (id → image URL to render).
  - `welcome.ts` - Whether this device still shows the Welcome screen (new devices only, cloud builds only).
  - `dates.ts` - Date helpers. Use `localIsoToday()` / `localIsoDate()` for "today" (local calendar date, never UTC); `fmt`, `fmtLong`, `fmtWeekday` format in the current language.
  - `children.ts` - Which child a record is for (`defaultChildId`: the only child, or none so the parent chooses; never a removed child), names that tell same-name children apart, and the initials avatar (`childPhotoSrc`).
  - `routes.ts` - Page addresses in the URL hash (`#/activity/<id>`, `#/book/<id>`, `#/child/<id>` …): browser Back, refresh and shared links. App keeps the URL in sync with `screen`.
  - `collections.ts` - Which collections are shown (in season, at least 3 activities), their activities and card picture.
  - `catalog.ts` - The one activity catalog: Discover activities and music activities share one id space. `findActivity(id)` resolves either (saved, My Week plans, activity records); `catalogItems()` (music spread evenly through the activities), `catalogCategories()` (the six parent-facing categories) and `searchCatalog()` (bilingual search, shared by Discover and Add Activity) list, group and search them. Also age labels/filters, book/music localization, the card's "Builds" line (`buildsDomains`, skipping `DESCRIPTIVE_DOMAINS`), age tag and time bands, and `suitableFirst` (activities that suit the family's children first).
  - `activityRecords.ts` - The single way an activity record is built (`buildActivityRecord`, used by Add Activity and Mark as Tried), how a record reads in a child's history (`recordView`, incl. legacy and custom records) and Recently Used (`recentActivityIds`, derived from records).
  - `bookshelf.ts` - The Family Bookshelf (My Books / Wishlist), stored as the `rootmap-bookshelf` setting; a book is on at most one shelf.
  - `entries.ts` - Helpers for the unified Moments/Journal entry collection: search, month grouping, and the idempotent import of legacy observations and child notes.
  - `journalDrafts.ts` - Autosaved editor drafts (IndexedDB store `drafts`).
  - `cloud/` - Cloud settings. `environment.ts` decides from the Vite mode and `VITE_*` variables whether this build may use Supabase (off by default, always off for the public website); `config.ts` is the app's `cloudConfig`; `client.ts` loads Supabase lazily (never in the public build); `auth.ts` email-code sign-in, session restore, sign-out; `account.ts` idempotent family/profile setup; `session.ts` app-wide sign-in state; `hooks.ts` `useCloudState()` for screens; `space.ts` which local space opens (from the stored session) and when to switch.
  - `sync/` - Record sync for the signed-in account (Phase 2B-2 M4): `mapping.ts` local records ↔ server rows, `resolver.ts` conflict rules, `engine.ts` push/pull rounds, `runner.ts` when sync runs and its status, `status.ts` what "All backed up" means, `photos.ts` photo files (upload, server verification, checked download), `guestImport.ts` bringing guest data into the account (Phase 2B-2 M6: offer, questions, atomic copy into the account space, upload by sync, verified completion with `complete_migration()`).
  - `platform/` - The only code that differs between the website and the future iOS app (session storage, saving a file). Web adapters only so far.
  - `native.ts` - Native touches: `haptic()` and the status bar (iOS app only, via `RootMapNativePlugin` in `ios/App/App/AppDelegate.swift`; no-ops on the web), keyboard tracking (`keyboard-open` class, `--keyboard-inset`) and `prefersReducedMotion()`. Page transitions live in `App.tsx` (`changePage`); motion timings are the `--ease-*` / `--dur-*` tokens in `index.css`.
- `src/components/` - Reusable building blocks shared across pages:
  - `Icon.tsx` - SVG icon set used throughout the app.
  - `TreeLogo.tsx` - RootMap brand logo.
  - `ui.tsx` - Shared UI atoms: `PageHeader`, `BottomNav`, `Shell`, `FilterPill`, `Field`, `Modal`, `ChildPhoto`, `Empty`, and the confirm dialog (`ConfirmProvider` / `useConfirm`).
  - `OpeningExperience.tsx` - Opening animation, Welcome and the email + 6-digit code sign-in screens.
  - `ModalOverlay.tsx` - Central modal dispatcher (quick-add, filters, add child, plan, week-add).
  - `ActivityPicker.tsx` - Add Activity's search-first picker over the shared catalog (search, category chips, Recently Used, Other / Custom Activity).
  - `EntryTimeline.tsx` - Month-grouped entry list plus the shared add/search controls used by Moments and Journal.
  - `CollectionCard.tsx` - A collection card: Discover › Collections (a vertical list) and My Week › Saved › My collections (a row).
  - `DataUnavailable.tsx` - Shown instead of the app when this device's saved data exists but can't be opened. `BetaNotice.tsx` - the beta label and notice (staging builds only).
  - `BooksBrowser.tsx` - The Books tab of Discover. `BookCover.tsx` - the current language edition's cover (or a placeholder titled in that language) and grid tile. `AudioPlayer.tsx` - play/pause/seek player for music recordings; shows "Recording coming soon" without a playable file.
- `src/pages/` - One file per screen, rendered by `App.tsx`:
  - `TodayPage.tsx` (home: Today's Inspiration, Looking Back, A Thought for Parents; read-only), `ChildrenPage.tsx` (Kids tab), `DiscoverPage.tsx` (Activities | Books | Collections; Activities lists activities and music together, Collections lists RootMap's collections one under another), `ActivityDetailPage.tsx`, `BookDetailPage.tsx`, `MusicDetailPage.tsx`, `CollectionPage.tsx` (`#/collection/<id>`: a collection's activities and Save collection), `BookshelfPage.tsx` (Family Bookshelf, from Profile), `MomentsPage.tsx`, `WeeklyRecapPage.tsx` (one week of Moments to revisit), `ChildProfilePage.tsx` (Journal | Activities), `EntryEditorPage.tsx` (the one editor for every memory), `EntryDetailPage.tsx`, `ProfilePage.tsx`, `AccountPage.tsx` (signed-in email, backup status, earlier memories, Sign out), `GuestImportPage.tsx` (the "Bring your memories into your account?" question), `MyWeekPage.tsx` (Saved: My collections and saved activities with Setting/Materials/Time filters), `GoalsPage.tsx`, `SettingsPage.tsx`, `NotificationsPage.tsx`, `BackupPage.tsx` (export and restore a backup file), `DeletedChildrenPage.tsx` (Recently Deleted children, restorable), `RecordFormPage.tsx` (Add Activity: picker, then the record form; activity records only).
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

- **Add a new lesson/activity**: append an entry to the `activities` array in [src/data/activities.ts](src/data/activities.ts). It appears in Discover and in Kids › Add Activity automatically (no other list to update). Optional Chinese search words go in `zh.keywords`. Set `settings` (where it can realistically and safely be done) and `materialType` (`none` / `everyday`; leave it out when it needs specialized or prepared materials) for Discover's Setting and Materials filters. Give it one `category` by what it is for (`practical-life`, `language`, `math`, `art-creativity`, `nature-culture`, `sensory-movement`): Discover's Category filter and Add Activity's chips both use it (`catalogCategories()`). Keep its `area` and `topic` too: activity records snapshot `area`, and older records are labelled by it (`discoverCategoryLabel`).
- **Add a book**: append an entry to `books` in [src/data/books.ts](src/data/books.ts). Covers are per edition: `src/assets/books/<id>-en.jpg` and `<id>-zh.jpg`, imported and set as `coverEn` / `coverZh` (only images you're allowed to use). A missing edition cover shows a placeholder in that language; the other language's cover is never substituted.
- **Add a music activity / connect a recording**: edit [src/data/music.ts](src/data/music.ts); put the MP3/M4A in `src/assets/music/`, import it and set `audioSrc`. Set `settings` and `materialType` for Discover's filters; music is always in Art & Creativity.
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
