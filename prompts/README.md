# Content prompts

The briefs used to add built-in content to RootMap. Each one is kept here as written, so the app's content can be checked against it later.

| Prompt | What it added | Where it lives in the app |
|---|---|---|
| [songs.md](songs.md) | The 50 songs (lyrics, tunes, how to use, sources) | `src/data/songs.json`, turned into music activities by `src/data/music.ts`. A unit test checks `songs.json` still matches this file's JSON block exactly. |
| [0-12-month-activities.md](0-12-month-activities.md) | The 51 activities for babies (0–12 months) | `src/data/infantActivities.ts`. Each activity keeps its picture prompt in `picturePrompt` (never shown in the app). Photos go in `src/assets/activities/infant/`. |

When you add a new prompt, put it in this folder and add a row above.
