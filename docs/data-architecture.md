# RootMap local data architecture (Phase 1)

RootMap keeps every family's data on the device, in the browser's **IndexedDB**. Nothing is sent anywhere yet.
IndexedDB is local storage, not a backup: if the browser's site data is cleared, or the device is lost, the data
is gone. Phase 2 (Supabase) adds the cloud copy.

## Layers

```
Screens (src/pages, src/components)
   │  plain arrays and values, read synchronously
   ▼
React bindings  src/lib/data/hooks.ts     useCollection(name), useSetting(key), saveSetting()
Drafts          src/lib/journalDrafts.ts  readDraft, latestNewDraft, writeDraft, flushDraft
Photos          src/lib/photos.ts         addPhoto(file) → photo id, photoUrl(ref) → URL to show
   │
   ▼
Store           src/lib/data/store.ts     loads everything once at start (initData), one write path (write)
   │
   ├── IndexedDB backend   (normal)
   └── localStorage backend (only until the one-time migration has succeeded on this device)
```

Screens never call a storage API. Hooks read the store's *published* state (`useSyncExternalStore`), so any
`write`, including one not made by a screen (a restore, the future cloud sync), appears on every mounted screen
without a reload. `set` updates at once and saves in the background (a failure shows a toast).
`commit` resolves only after the write has really been stored, so "Saved" is never shown for data that wasn't kept.

## IndexedDB layout (`rootmap`, version 1)

This is the guest space. Builds with cloud features also keep one database per signed-in account
(`rootmap-account-<userId>`), with the same stores plus `outbox` and `syncRecords`; see
[data-architecture-phase2.md](data-architecture-phase2.md), M3 notes.

| Store | Key | Contents |
|---|---|---|
| `children` | `id` | Child profiles. A profile in **Recently Deleted** is the same record with `deletedAt` set. |
| `records` | `id` (index `childId`) | Activity records, including "Mark as Tried" (`kind: "tried"`). |
| `observations` | `id` (index `childId`) | Legacy observations (already copied into entries; kept). |
| `entries` | `id` (index `childId`) | Moments / Journal entries. `photos` holds photo ids. |
| `plans` | `id` (multi-entry index `childIds`) | My Week plans. |
| `goals` | `id` | My Goals (belong to the parent, not a child). |
| `saved` | `id` (= activity id) | Saved Discover activities. |
| `photos` | `id` | Photo metadata: type, size, dimensions, timestamps, future `storagePath` / `uploadedAt`. |
| `photoBlobs` | `id` | The image bytes (Blob), kept apart from metadata. |
| `drafts` | `key` (`<childId>:<entryId\|new>`) | Unsaved editor state. Device-local by design. |
| `settings` | `key` (the old localStorage key name) | Profile, language, appearance, filters, notes pad, notification toggles, seed tracking. |
| `archive` | `id` | Anything the migration could not place safely, kept verbatim (see below). |
| `meta` | `key` | `migration`: completion marker and report. |

### Sync fields on every record (`SyncMeta` in `src/types.ts`)

| Field | Meaning |
|---|---|
| `id` | Stable and never reused. New ids are `<prefix>-<uuid>` (`m-` entry, `c-` child, `t-` tried, `r-` record, `p-` plan, `g-` goal); migrated ids are kept exactly. |
| `createdAt` | UTC ISO. Kept from legacy data when present; **`null` when the legacy record never had one** (never invented). |
| `updatedAt` | UTC ISO, set on every local change. For migrated records without one, the migration time. |
| `deletedAt` | `null`, or when it was soft-deleted. |
| `origin` | `demo`, `user`, or `unknown` (see Demo data). |
| `migratedAt` | When it was copied out of localStorage. |
| `position` | Display order, so lists look exactly as before. |
| `legacyId` | Only on a record that had to be re-keyed because two different legacy records shared one id. |

User-entered dates (`date` on entries, records, plans) are stored exactly as entered (`YYYY-MM-DD`) and never
shifted by time zone. Timestamps are UTC; screens format dates in the device's local time.

## Soft deletion

Removing a record from any list writes it back with `deletedAt` instead of erasing it, so a future sync can tell
other devices it was deleted (it won't reappear). Soft-deleted records are hidden everywhere, except children,
which appear under Recently Deleted Children exactly as before. Restoring a child clears `deletedAt` on the same
record, so its entries, records and plans (still linked by `childId`) come back. Deleting a child is now one write
(previously two separate writes that could disagree).

Photos are never deleted in Phase 1, even when removed from an entry or draft (see Remaining risks).

## The migration from localStorage

Runs once per device, at start-up, before the first screen renders (`src/lib/data/migrate.ts`).

1. **Read and validate.** Every `rootmap-*` key is parsed with the same rules the old app used. A value that does
   not parse, or has the wrong shape, is treated exactly as the old app treated it (it showed the default), and the
   raw text is copied into `archive`. Unknown `rootmap-*` keys and earlier `.corrupt` copies are archived too.
2. **Build records** (`src/lib/data/legacy.ts`, pure and unit-tested):
   - ids, dates, text, child links and existing timestamps are copied unchanged;
   - inline Base64 images in entries, drafts, child and profile photos become photo records with **the same bytes**
     (no re-encoding); an image used twice (e.g. an entry and its edit draft) is stored once;
   - removed profiles become soft-deleted `children` records; a stale snapshot of a child that is also active, or
     an older duplicate snapshot, goes to `archive` instead of creating a second record;
   - two *different* records sharing one id (possible with old `Date.now()` ids) are both kept; the second gets a
     suffixed id plus `legacyId`. An exact repeat is the same data and is kept once.
3. **Write everything in one IndexedDB transaction.** It either fully commits or leaves nothing.
4. **Verify** by reading everything back: every record compared field by field, every photo by size and type,
   every photo reference resolved.
5. **Mark complete** (`meta.migration`) in a second transaction, and set the localStorage hint `rootmap-data-store`.

Guarantees:

- **localStorage is never modified or cleared.** It stays as the pre-migration recovery copy. (After migration, new
  changes go only to IndexedDB, so this copy ages; it is not kept in sync.)
- **Idempotent and resumable.** Until the completion marker exists the app never writes to IndexedDB, so a rerun
  after an interruption clears the partial copy and starts over. No duplicates.
- **Failure keeps the original.** If any step fails, this session runs on the original localStorage data (the old
  behaviour), and the migration is retried at the next start. Writes made meanwhile are included then.
- **One tab at a time** (Web Locks): a second tab opened during the first start waits and then finds it done.
- If IndexedDB later won't open on a device that has already migrated, the app shows a short message with
  Try Again (English/Chinese) rather than silently showing the older localStorage copy.

The migration report (counts, photo bytes, warnings) is stored in `meta.migration.report`.

## Photos

- Added photos are resized in the browser (journal photos up to 2048 px, JPEG quality 0.85, up from 1280 px / 0.78
  when photos had to fit in localStorage; avatars unchanged at 640 px) and stored immediately in `photoBlobs`.
  Records, drafts and the profile hold only the id (`photo-<uuid>`).
- `photoUrl(ref)` turns an id into a local object URL; any other value (bundled image, remote URL) is used as is.
- Metadata is ready for a private bucket: `storagePath` (e.g. `<familyId>/<photoId>.jpg`) and `uploadedAt` are null
  until uploaded.

## Drafts

Autosaved 600 ms after typing stops and flushed when the page is hidden or closed. A flush also writes a tiny
synchronous copy (`rootmap-draft-rescue` in localStorage, ids only, no images) in case the browser ends the page
before IndexedDB finishes. It is applied at the next start only if newer than the stored draft, and removed as soon
as the IndexedDB write lands. Saving an entry and clearing its draft happen in **one transaction**, so a saved entry
can never be resumed from its draft and saved twice.

## Demo data

The app ships demo children (Maya `emma`, Leo `noah`), demo activity records (`r1`–`r4`), observations (`o1`, `o2`)
and two default saved activities. `origin` records only what is reliably known:

| `origin` | Assigned when |
|---|---|
| `demo` | The id is a bundled seed id, or the collection had never been written (the app was showing defaults). |
| `user` | The id has a format only the app's own create actions produce (`c-`, `r-`, `t-`, `m-`, `p-`, `g-` + timestamp or uuid). |
| `unknown` | Anything else, e.g. a default saved activity the parent kept, or a note imported from a demo child. |

**Rules for the cloud migration (Phase 2):**

1. Never upload `unknown` records automatically and never discard them. Ask once, in plain words, or keep them local.
2. A `demo` record is still not safe to drop: parents may have **renamed a demo child and used it as their own**
   (look for `user` entries/records whose `childId` is a demo child, or a demo child whose name/photo differ from
   the seed). Such children and everything attached must be uploaded as the family's real data.
3. Untouched demo records (seed content unchanged, nothing `user` attached) should not be uploaded; the server can
   provide its own onboarding examples.
4. Archived items (`archive`) are never uploaded; they stay on the device as a safety net.

Found while building M6: the memories the app makes from the demo observations (`obs-o1`, `obs-o2`) are stored with
origin `user`, and older versions stored the demo pictures as photos (SVG data). Neither means the parent changed
anything, so the planner recognises untouched demo content by its content (see the Phase 2 doc, M6 notes).

## Remaining risks

- **Not a backup.** Clearing site data, uninstalling the browser, or losing the device loses everything. Safari can
  also delete script-written storage for a site that hasn't been opened for about 7 days of browser use (unless the
  site is added to the Home Screen). This is the main reason for Phase 2.
- RootMap asks the browser to keep its storage persistent (`navigator.storage.persist()`), except in Firefox,
  where that would show a permission prompt. Browsers may still decline.
- The localStorage copy is frozen at migration time. Rolling the app back to a pre-IndexedDB version would show
  that older copy.
- Photos removed from an entry or draft (and avatars picked but not saved) stay in storage as orphans until a
  cleanup is added together with sync.
- All photo object URLs are created at start-up. Fine for hundreds of photos; for thousands, load them on demand.
- A confirmed save (`commit`) is shown only once stored, but a background `set` that lands during those few
  milliseconds publishes the whole collection, including the pending save, slightly early. If that save then
  fails, it can stay on screen (not stored) until the next reload. Rare and accepted in 2B-2 M0; the sync engine
  must not treat what is on screen as stored (it reads the outbox).
- Two open tabs each keep their own in-memory copy; a change in one tab appears in the other after a reload.
  Writes are per record, so one tab no longer overwrites the other's whole list.

## Phase 2: what Supabase needs

> Superseded by the finalized design in [data-architecture-phase2.md](data-architecture-phase2.md). The notes
> below are the original Phase 1 sketch.

- **Auth:** Supabase Auth with Sign in with Apple and Google (OAuth); **WeChat** needs a custom OIDC/OAuth bridge
  (e.g. an Edge Function issuing Supabase sessions), since it isn't a built-in provider. Google must not be the only
  option: Google services are unavailable in mainland China. Check Supabase reachability and latency from China
  (region choice, possibly a proxy/CDN) before committing.
- **Onboarding:** Opening animation → Welcome/Login → Add Child → RootMap; skip for a returning signed-in user.
  On first sign-in, upload this device's data (applying the demo-data rules above), then mark it as linked.
- **Ownership:** `families` (id, created_at), `family_members` (family_id, user_id, role), and a `family_id` column on
  every table mirroring the stores above (children, records, observations, entries, plans, goals, saved, photos).
  Goals and profile settings belong to a user within the family. Keep the text ids as primary keys so local and
  remote ids match. Multi-parent sharing comes later, but this shape supports it.
- **Row Level Security** on every table: a row is visible and writable only to members of its `family_id`.
- **Storage:** a private bucket, objects at `<family_id>/<photo_id>.jpg`, RLS on the path, signed URLs to display.
  Upload `photoBlobs`, then set `storagePath`/`uploadedAt`.
- **Sync:** push records whose `updatedAt` is newer than the last successful push (an outbox), with retries and
  backoff while offline; pull rows changed since the last pull. Tombstones (`deletedAt`) sync like any change.
  Conflicts: last writer wins by `updatedAt` per record to start with; entries' text may later need a smarter merge.
- **Server timestamps:** keep client `updatedAt` for ordering, but record a server `synced_at` to avoid trusting
  device clocks for pull cursors.
- **Cleanup that sync makes safe:** purge long-deleted tombstones after all devices have seen them, delete orphaned
  photos, and eventually stop reading the legacy localStorage keys.
