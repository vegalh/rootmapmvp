# RootMap MVP

RootMap MVP is a parent-facing Montessori companion that helps families stay connected to their child’s learning journey at home and in the classroom. It gives parents a simple way to follow activities, revisit meaningful moments, and understand how their child is growing through daily work.

## What this app does

- Show each child’s profile, age, enrollment information, and learning snapshot
- Browse Montessori-inspired activities and learning areas for home or classroom exploration
- Save favorite activities and add them to a personal weekly plan
- Follow child progress through recorded lessons, observations, and skills practiced
- Capture life moments that matter and revisit them later with context
- Support both English and simplified Chinese language experiences
- Store demo data locally in the browser for quick prototyping and review

## Why RootMap

RootMap is designed around the idea that parents want to feel close to their child’s early learning, even when they are not in the classroom. Montessori education emphasizes purposeful repetition, independence, and careful observation, and this app brings that philosophy into a parent-friendly digital experience.

The goal is to help parents:

- understand what their child is learning and exploring
- see meaningful moments that are worth celebrating
- revisit activities and ideas at home
- stay connected to the rhythm of the classroom and the child’s growth

## Current product scope

This MVP focuses on the parent experience:

- Child profiles and personal learning snapshots
- A discoverable activity library
- Saved activities and weekly planning
- Lesson history and growth tracking
- Observation capture for special moments and milestones
- Family-facing notifications and updates
- Local browser storage for prototype usage

## Tech stack

- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- Local browser storage for prototype data

## Getting started

1. Install dependencies:
   npm install
2. Start the development server:
   npm run dev
3. Build for production:
   npm run build
4. Preview the production build:
   npm run preview

## Project structure

- `src/App.tsx` — application state and screen flow
- `src/pages/` — screens for children, activity discovery, observations, profile, and weekly planning
- `src/data/` — seed data for children, activities, lessons, and family moments
- `src/lib/` — localization and helper logic
- `src/components/` — shared UI and reusable app elements

## Notes for contributors

This is a prototype intended to explore the parent experience in a Montessori setting. Most data is mock content stored locally in the browser so the product can be reviewed quickly and iterated on without a backend.

If you want to adjust the product content, start in the seed files under `src/data/` to change children, activities, and learning records.

## License

This project is currently a prototype and does not yet include a formal public license.
