# RootMap MVP

React + Vite + Tailwind CSS prototype for RootMap, a Montessori-style classroom tracking app.

## Development Server

A Vite development server is **already running** on `$PORT` (default 8443). You don't need to start it manually.

- Preview URL: The user can access the running app through the preview panel
- Hot reload: Changes to source files are reflected immediately

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Composition root: holds all top-level state and renders the active page based on `screen`
- `src/types.ts` - Shared TypeScript types (`Child`, `Activity`, `LessonRecord`, `Observation`, `Screen`, etc.)
- `src/data/` - Seed/mock content, edit these to change what shows up in the app:
  - `children.ts` - The list of children/students. **Add a child or change a photo here.**
  - `progress.ts` - Lesson records, observations, and the lesson options offered per learning area.
  - `activities.ts` - Discover page activities/lessons and category list. **Add a new lesson/activity here.**
- `src/lib/` - Small framework-agnostic helpers:
  - `i18n.ts` - English/Chinese translation strings (`copy`) and the `Copy` type.
  - `storage.ts` - `useStored` hook (localStorage-backed `useState`).
  - `dates.ts` - Date formatting helpers (`fmt`, `isoToday`).
- `src/components/` - Reusable building blocks shared across pages:
  - `Icon.tsx` - SVG icon set used throughout the app.
  - `TreeLogo.tsx` - RootMap brand logo.
  - `ui.tsx` - Shared UI atoms: `PageHeader`, `BottomNav`, `Shell`, `FilterSelect`, `Field`, `Modal`, `Empty`, `NotificationToggle`.
  - `ModalOverlay.tsx` - Central modal dispatcher (quick-add, filters, add child, plan, observation, week-add).
- `src/pages/` - One file per screen, rendered by `App.tsx`:
  - `ChildrenPage.tsx`, `DiscoverPage.tsx`, `ActivityDetailPage.tsx`, `ObservationsPage.tsx`, `ChildProfilePage.tsx`, `ProfilePage.tsx`, `MyWeekPage.tsx`, `SettingsPage.tsx`, `NotificationsPage.tsx`, `RecordFormPage.tsx`.
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and Figma Make plugins plus the `@` alias for `src`

## Making common changes

- **Add a new lesson/activity**: append an entry to the `activities` array in [src/data/activities.ts](src/data/activities.ts).
- **Add or edit a child / change a photo**: edit [src/data/children.ts](src/data/children.ts).
- **Add a new page/screen**: create a file in `src/pages/`, add its name to the `Screen` union in [src/types.ts](src/types.ts), and wire it into the `content()` switch in [src/App.tsx](src/App.tsx).
- **Change translation text**: edit `copy.en` / `copy.zh` in [src/lib/i18n.ts](src/lib/i18n.ts).

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
