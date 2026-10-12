# RootMap data architecture — Phase 2 (cloud)

This is the finalized Phase 2A architecture, approved on 2026-10-11. It is the reference for every Phase 2B step.
It extends [data-architecture.md](data-architecture.md), which describes the Phase 1 local data layer and remains
accurate for everything on the device.

## Current status (start here)

As of 2026-10-12:

- **Phase 2B-1 (cloud foundation) is complete and approved.**
  - The schema, RLS, storage policies, and revision / `change_seq` triggers are in `supabase/migrations/`.
  - They are tested locally (`npm run test:db`, 48 tests).
  - They are deployed to the **staging** project `rootmap-staging` (`cbgkkeveprftddrobzao`). See section 19.
- **The app does not use Supabase yet.**
  - Nothing in `src/` talks to the cloud.
  - Local data (IndexedDB, Phase 1) works exactly as before.
- **Phase 2B-2 (accounts and sync) is in progress**, in milestones M0–M7 (section 18).
  - **M0 (groundwork) is implemented and awaiting review.** Cloud settings (off by default, locked off for the
    public website), platform adapters, screens that follow store changes, and uuid ids for goals and repeated
    plans. Still no Supabase calls from the app.
  - Each later milestone starts only after explicit approval.
- **Not yet in place:** no production project exists; Capacitor, WeChat, and the first-login migration are not
  started.

**Working with the database locally**

- Docker Desktop must be running.
- If the `docker` command is missing, add `export PATH="$HOME/.docker/bin:$PATH"` to your shell profile.
- Commands:
  - `npm run db:start` starts the local stack and applies the migrations.
  - `npm run test:db` runs the database tests.
  - `npm run db:reset` re-applies all migrations from an empty database.
- The tests refuse to run against anything except the local stack.

**Changing the database**

1. Add a new file in `supabase/migrations/`. Never edit a migration that has already been applied.
2. Add or extend tests in `tests/db/`.
3. Run `npm run db:reset && npm run test:db`.
4. Only with the owner's approval, apply the change to staging with `npx supabase db push --linked`.

The CLI login is stored in the macOS Keychain. The project link lives in `supabase/.temp/`, which is git-ignored,
so a fresh clone must run `npx supabase link --project-ref cbgkkeveprftddrobzao` again.

---

## 1. Final decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Product | Primarily an **iOS app**, built from the existing React + TypeScript + Vite code with **Capacitor**. The GitHub Pages website keeps working. The app is not rewritten. |
| 2 | Cloud | **Supabase**: Postgres with Row Level Security, private Storage, Auth, and Edge Functions. No custom API server. |
| 3 | Environments | **One staging project first.** No production resources until the region has been chosen from connectivity tests (section 15). Production will run on the Pro plan and staging on the Free plan. |
| 4 | Schema changes | Version-controlled SQL migrations only (`supabase/migrations/`). Nothing is changed by hand in the dashboard. |
| 5 | Domain | A custom domain is used for the website, OAuth redirects, Universal Links, and the WeChat callback later. |
| 6 | Sign-in | Apple, Google, and a typed email code first. "Continue without an account" keeps today's local-only mode. **WeChat is research only.** No bridge is built until the business entity and the session method have both been verified (section 13). |
| 7 | Ownership | Every data row belongs to a **family** and uses the key `(family_id, id)`. Saved activities belong to the family. Goals belong to one parent. Sharing between parents is designed for but not built. |
| 8 | Revision control | The server assigns `rev` (per row) and `change_seq` (per family). The client never chooses either. |
| 9 | Sync cursor | A per-family `change_seq`, assigned while the family row is locked, so numbers follow commit order. **No separate change_log is needed** under the invariants in section 5.4. |
| 10 | Conflicts | Conditional writes, then a field-level merge. Every losing version is kept in `record_versions`. **A deletion is never undone automatically.** |
| 11 | Photos | Private bucket. A SHA-256 hash is recorded when the photo is created and cannot change. The server checks the hash after upload, and each device checks it after download. No public URLs. |
| 12 | Local retention | Local data is **never deleted automatically**. It is removed only when the parent asks, when the account is deleted, or when a verified security requirement demands it. **Unsynced records are never deleted.** |
| 13 | Sign-out | iOS: by default the local copy is kept and hidden until the same parent signs in again. Website: the app recommends removing the local copy on shared devices. Hiding the data is not encryption. |
| 14 | First-login migration | Automatic when ownership is clear. The parent is asked only about ambiguous ownership, possible duplicate children, or a conflict that cannot be resolved safely. |
| 15 | iOS storage | Native SQLite plus photo files is the expected iOS backend, **but only after a Capacitor proof of concept succeeds** (section 12). Until then, IndexedDB stays the only backend. |
| 16 | Legal | Legal and privacy review (US and China) must be complete before any real family uses the cloud. |

---

## 2. System overview

```
  Website (GitHub Pages, custom domain)        iOS app (Capacitor, WKWebView)
  ┌───────────────────────────────┐            ┌───────────────────────────────┐
  │ React screens (unchanged)     │            │ React screens (unchanged)     │
  │ Data layer: store.ts write()  │            │ Data layer: store.ts write()  │
  │ Local backend: IndexedDB      │            │ Local backend: SQLite + files │  ← after the PoC
  │ Session: localStorage         │            │ Session: iOS Keychain         │
  │ Sync engine (Phase 2B-2)      │            │ Sync engine (same code)       │
  └──────────────┬────────────────┘            └──────────────┬────────────────┘
                 │ HTTPS (publishable key + user JWT)          │
                 ▼                                             ▼
  ┌──────────────────────────── Supabase project ─────────────────────────────┐
  │ Auth           Apple, Google, email code (WeChat: later, after checks)     │
  │ Postgres       family tables, RLS, rev + change_seq triggers               │
  │ Storage        private bucket family-photos, membership-checked policies   │
  │ Edge Functions verify-photo, account deletion, purge (later phases)        │
  └────────────────────────────────────────────────────────────────────────────┘
```

Screens never talk to Supabase. The data layer remains the only write path. Sync reads the local outbox and writes
to the local store through that same path.

**Platform adapters.** `src/lib/platform/` (created in 2B-2 M0, web adapters only so far) holds the only code that differs
by platform:

| Adapter | Website | iOS |
|---|---|---|
| Sign-in | Supabase redirect sign-in (PKCE) | Native Apple / Google SDK, then `signInWithIdToken` |
| Session storage | `localStorage` | Keychain, accessible after first unlock, this device only |
| Local backend | IndexedDB | SQLite + Application Support files (after the PoC) |
| Photo picking | `<input type="file">` | The same input, which opens the iOS photo picker |
| Backup export | Download link | Share sheet |

---

## 3. Data model

### 3.1 Tables

The schema has 13 application tables, all in `public`. Every family-data table uses the primary key `(family_id, id)`.

| Table | Key | Purpose | Phase 1 source |
|---|---|---|---|
| `families` | `id uuid` | One per household. Holds `change_seq` and `purged_through_seq`. | none |
| `family_members` | `(family_id, user_id)` | Membership and `role` (`owner` / `parent`) | none |
| `profiles` | `user_id` | Display name, photo, contact, locale, time zone | setting `rootmap-profile` |
| `user_settings` | `(user_id, key)` | Settings that follow the parent across devices | `settings` (selected keys) |
| `children` | `(family_id, id)` | Child profiles | `children` |
| `entries` | `(family_id, id)` | Moments / Journal entries | `entries` (plus folded `observations`) |
| `activity_records` | `(family_id, id)` | Activity records, including Mark as Tried (`kind = 'tried'`) | `records` |
| `plans` | `(family_id, id)` | My Week plans | `plans` |
| `goals` | `(family_id, id)` | A single parent's goals (`owner_user_id`) | `goals` |
| `saved_activities` | `(family_id, id)` | Saved Discover activities (id = activity id) | `saved` |
| `photos` | `(family_id, id)` | Photo metadata and integrity state | `photos` (+ `photoBlobs` → Storage) |
| `record_versions` | `(family_id, id)` | Versions that lost a conflict, kept for recovery | none |
| `cloud_migrations` | `(family_id, id)` | First-login upload attempts and their manifest | none |

These stay on the device and are never uploaded: `drafts`, `archive`, `meta`, and the device-only settings (child
view, filters, seed ids, migration markers, last backup).

The Discover activity catalog stays bundled in `src/data/activities.ts`.

`observations` gets no table. Every observation is already copied into an entry, with the original kept in
`legacyObservation`. That copy moves to `entries.legacy jsonb`.

### 3.2 Columns

**Common columns on every family-data table**

| Column | Type | Set by | Notes |
|---|---|---|---|
| `family_id` | uuid, FK → families | client (checked) | Can never change after insert |
| `id` | text | client | The Phase 1 id, kept exactly. Check: 1–128 characters, no control characters. Legacy forms such as `r1`, `c-1712345678901`, and `entry~2` must all be accepted. |
| `created_at` | timestamptz, nullable | client | `null` means the record predates timestamps (Phase 1 rule) |
| `updated_at` | timestamptz | client | Display only. Never used for ordering or conflicts. |
| `deleted_at` | timestamptz, nullable | client | Soft deletion |
| `origin` | text check (`demo`,`user`,`unknown`) | client | From `SyncMeta` |
| `position` | double precision, nullable | client | Display order |
| `legacy_id` | text, nullable | client | From `SyncMeta` |
| `migrated_at` | timestamptz, nullable | client | From `SyncMeta` |
| `rev` | bigint | **server** | 1 on insert, +1 on every update |
| `change_seq` | bigint | **server** | The family's change number at this write (section 5) |
| `server_updated_at` | timestamptz | **server** | `now()`. Diagnostic only; never used as a cursor. |
| `updated_by` | uuid | **server** | `auth.uid()`, or null for service jobs |

**Columns specific to each table**

| Table | Columns |
|---|---|
| `children` | first, last, dob date, enrolled, enrolled_zh, lessons int, group_name, photo_ref, notes, interests text[] |
| `entries` | child_id, date date, title, text, text_zh, photo_ids text[], from_notes bool, legacy jsonb |
| `activity_records` | child_id, kind (`record`/`tried`), activity_id, lesson, area, stage, date date, notes, next_steps, skills text[], notes_zh |
| `plans` | activity_id, date date, child_ids text[], note, completed bool, completed_date date, observation |
| `goals` | owner_user_id uuid, title, description, completed bool, completed_at timestamptz |
| `saved_activities` | (id = activity id; no extra columns) |
| `photos` | mime_type, byte_size bigint, width, height, sha256 char(64), storage_path, uploaded_at, server_sha256, verified_at |
| `record_versions` | table_name, record_id, version jsonb, base_rev bigint, reason, created_by, resolved_at |
| `cloud_migrations` | device_id, manifest jsonb, status (`started`/`complete`), completed_at |

**Relationships**

| From | To | How |
|---|---|---|
| `entries` and `activity_records` | children | Foreign key `(family_id, child_id)` → `children(family_id, id)` |
| `plans.child_ids` | children | Trigger check (array): each id must exist in the same family |
| `entries.photo_ids` and `children.photo_ref` | photos | Trigger check: a photo id must exist in the same family |

`children.photo_ref` and `profiles.photo_ref` hold either a photo id (`photo-<uuid>`) or a stable bundled-avatar key
(`bundled:<name>`). They never hold a build-specific asset URL or a data URL. Converting legacy values is the
migration planner's job (Phase 2B-3).

**Types**

- Entered dates are `date` and never shift with time zones.
- Timestamps are `timestamptz` (UTC).
- Text is stored exactly as given. There is no Unicode normalisation, and no assumption about name order (`last` may
  be empty).

### 3.3 Indexes

- `(family_id, change_seq)` on every family-data table, used by pulls.
- `(family_id, child_id)` on `entries` and `activity_records`.
- `family_members (user_id)`, used by the membership check.

---

## 4. Server-side revision control and integrity

A `before insert or update` trigger on every family-data table does the following:

1. **Rejects** any change to `family_id` or `id` on update.
2. **Assigns server columns**, overwriting whatever the client sent:
   - `rev`: 1 on insert, `old.rev + 1` on update
   - `change_seq`: the next value of the family's change number (section 5.2)
   - `server_updated_at = now()`
   - `updated_by = auth.uid()`
3. **Checks references** that a foreign key cannot express: `plans.child_ids`, `entries.photo_ids` and
   `children.photo_ref` must point to rows in the same family.
4. **Protects photo integrity:**
   - `photos.sha256` is set on insert and can never change.
   - `server_sha256` and `verified_at` can be written only by the service role.

Column privileges add a second layer: the `authenticated` role has no `update` privilege on `rev`, `change_seq`,
`server_updated_at`, `updated_by`, `server_sha256`, or `verified_at`.

**Conditional writes.** The sync client (Phase 2B-2) uses only these two forms:

- **Insert:** `insert … on conflict do nothing` (PostgREST `Prefer: resolution=ignore-duplicates`). No row returned
  means the id already exists in this family. The client treats that as a conflict and never overwrites.
- **Update:** `update … where family_id = $f and id = $id and rev = $base_rev`. No row returned means another
  device wrote first: a conflict.

A blocked RLS update and a lost race both return zero rows. The client tells them apart with a follow-up select.

---

## 5. Synchronization cursor

### 5.1 Why a timestamp cursor is not enough

`now()` is the transaction's **start** time. A transaction can start before another one, take longer, and commit
after a device has already pulled past its timestamp. No overlap window removes this risk entirely. Ordinary
Postgres sequences have the same flaw: numbers are handed out at insert time, not at commit time, so a lower number
can become visible after a higher one.

### 5.2 Per-family change number

```sql
-- inside the shared trigger function (security definer, search_path = '')
update public.families
   set change_seq = change_seq + 1
 where id = new.family_id
returning change_seq into new.change_seq;
```

- The `update` takes a row lock on that family's `families` row and holds it until the transaction ends.
- A concurrent write to the same family waits for the lock. Under READ COMMITTED it then re-reads the row and gets
  the next number.
- **Within a family, change numbers therefore become visible in commit order.** Once a reader can see number N,
  every number below N is either visible too or was rolled back. A rolled-back transaction also rolls back its
  increment, so the next writer reuses that number and no gaps appear.
- Different families never block each other.

**Pull query** (one page):

```sql
select * from <table>
 where family_id = $family and change_seq > $cursor
 order by change_seq
 limit 500;
```

The cursor is the highest `change_seq` the device has applied. It is stored per family and moves forward only after
a page has been applied locally.

### 5.3 Can querying only the current rows miss changes?

The question: a device reads the current state of rows, not a history of changes. Can an intermediate change be
lost? The table walks through each case.

| Case | Behaviour | Result |
|---|---|---|
| Several edits to one record between pulls | Each edit raises the row's `change_seq`, so the row is found with its latest state. Intermediate states are not delivered. | Correct. Sync transfers state, not history. The merge needs only the device's last synced version, the server's current version, and the local version. The device's own pending edit is never lost: it goes through the conditional write and, if it loses, into `record_versions`. |
| Concurrent transactions | The family row lock orders commits. A reader never sees N+1 before N. | No row is skipped. |
| Soft deletion | A deletion is an update (`deleted_at` set), so it raises `change_seq` like any other change. | Delivered like an edit. |
| Pagination | Each page is its own snapshot. A row on an unread page that changes moves to a **higher** number, and is still found later. A row on an already-read page that changes also moves higher, and is found on a later page or pull. Numbers only increase. | No row is skipped. A row may arrive twice, which is harmless because it is applied by `rev`. |
| Interrupted sync | The cursor advances only after a page has been fully applied. A restart repeats at most one page. | Applying the same row twice is harmless. |
| Device offline for a long time | Nothing is ever lost while tombstones remain. Once tombstones are purged (a later phase), `families.purged_through_seq` records the highest purged number. A device whose cursor is below it does a **full re-sync**: it downloads every live row and tombstone. Its synced local records that are absent from the server are treated as purged deletions. Its unsynced local records are pushed as usual. | Correct, but costs one full download. |
| Hard deletes | None from clients (no delete policy). Only the purge job deletes, and it raises the watermark first. | Covered by the watermark rule. |

### 5.4 Is a durable change_log required?

**Not for correctness, as long as these invariants hold. Each one is enforced in the schema and covered by a test:**

1. Clients never hard-delete rows. Deletion is always an update.
2. `family_id` and `id` never change after insert.
3. Every write to a family-data table goes through the trigger that assigns `change_seq` (no bypass, including for
   the service role).
4. Purges advance `families.purged_through_seq` in the same transaction as the delete.
5. **A row's visibility to a user changes only through membership changes, and a membership change always causes a
   full re-sync for that user.** Example: goals are visible only to their owner, so another parent never needs them.

A change_log becomes necessary if any of these invariants is dropped. Examples:

- per-row visibility that can change without a write (fine-grained sharing),
- hard deletes without a watermark,
- moving records between families,
- features that need history (an activity feed, undo, audit).

The cost of a change_log now would be about twice the writes, a growing table that needs its own retention and purge
rules, and more test surface. None of that protects against a loss that the invariants allow.

**Recovery from mistakes** is handled separately, by:

- `record_versions` (every losing version),
- Supabase daily backups on Pro (7 days),
- the device's own copy, which is never deleted automatically.

A row-history table can be added later without changing the sync protocol.

### 5.5 Required tests (Phase 2B-1)

These run against a local Supabase stack with two direct database connections, so lock ordering can be forced
deterministically:

| Test | Setup | Expected |
|---|---|---|
| Commit order | T1 writes in family F and holds its transaction open. T2 writes in F. | T2 waits. After T1 commits, T2's `change_seq` is T1's + 1. A reader in between sees neither, then T1's, then both. |
| Rollback | T1 writes and rolls back. T2 writes. | T2 gets the number T1 would have used. No gap. |
| Independent families | T1 holds F1. T2 writes F2. | T2 does not wait. |
| Multiple edits | Edit one row 5 times. | One pull returns it once, with the latest state and `rev = 6`. |
| Soft delete | Set `deleted_at`. | The pull returns the tombstone with a new `change_seq`. |
| Pagination under writes | 1,200 rows, page size 500. Update rows on unread and already-read pages between pages. | Every row's final state is received at least once. None is missed. |
| Interrupted pull | Stop after page 1 without saving the cursor. Restart. | All rows received. Duplicates are harmless. |
| Watermark | Simulate a purge: delete a tombstone and set `purged_through_seq`. Use a client with an older cursor. | The client is told to fully re-sync. |
| Server-column spoofing | A client sends `rev`, `change_seq`, or `updated_by`. | The values are overwritten or rejected. |
| Identity change | Update `family_id` or `id`. | Rejected. |
| Service-role write | Write as the service role (as `verify-photo` will). | `change_seq` still advances. |

---

## 6. Conflict resolution

A conflict means two devices changed the same record starting from the same `rev`.

The resolver (Phase 2B-2) is a pure, unit-tested function that receives three versions: the local version, the
server version, and the last synced version (`syncBase`).

| Situation | Record becomes | Other version |
|---|---|---|
| Different fields changed on each side | Both changes merged | — |
| Same short field (date, title, stage, completed) | Server value | Saved to `record_versions` (`field_conflict`) |
| Same long text (entry text, child notes) | Server version | Saved to `record_versions`. The entry shows a small "Another version saved" marker; the parent can compare or swap with one tap. No duplicate timeline entries. |
| `photo_ids` changed on both sides | Both kept: local order first, then the server's additions | — |
| **Deleted on one device, edited on another** | **Stays deleted** | The edited version is saved to `record_versions` (`edited_after_delete`). It appears in Recently Deleted with a "Restore this version" action. |
| Deleted on both | Deleted | — |
| Child deleted while its entries were edited elsewhere | Child stays deleted. The entry edits are applied and stay hidden with the child. | Restoring the child brings everything back |

The parent is asked only when a conflict cannot be resolved safely by these rules. The rules are designed so that
this almost never happens. Nothing is discarded silently.

---

## 7. Security model

### 7.1 Row Level Security

One membership check is used by every policy:

```sql
create function private.is_family_member(fid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.family_members
                 where family_id = fid and user_id = (select auth.uid()));
$$;
```

| Table | select | insert | update | delete |
|---|---|---|---|---|
| Family-data tables | member | member (with check) | member (old row and new row) | **none** |
| `goals` | member and `owner_user_id = auth.uid()` | same | same | none |
| `families` | member | none (only via `create_family()`) | none from clients | none |
| `family_members` | own rows | none | none | none |
| `profiles`, `user_settings` | `user_id = auth.uid()` | same | same | none |

Deleted records keep the same select policy, so they stay exactly as protected as live ones.

### 7.2 Privileged functions and roles

- Privileged functions live in the `private` schema, which is not exposed through the API. Each one is
  `security definer` with `set search_path = ''`.
- `execute` is revoked from `public` and `anon`. Each function is granted to `authenticated` only where needed.
- No function takes a `user_id` argument. Every function uses `auth.uid()`.
- `create_family()` creates the family and the caller's `owner` membership in one transaction. It refuses if the
  caller already belongs to a family. It is the one privileged function in `public`, because the app calls it
  as an RPC. Its execute grant goes to `authenticated` only.
- No client path can create, change, or delete a membership. Future invitations will use single-use, expiring
  tokens.
- **RLS never reads `user_metadata`**, because users can edit it. Membership comes from `family_members`. Provider
  markers live in `app_metadata` or in `private` tables.
- `anon` has no table grants and no policies. The publishable key opens nothing without a session.
- The `service_role` / secret key is used only inside Edge Functions and migrations. It is never put in the frontend
  or the repository.

### 7.3 Storage

- Bucket: `family-photos`.
  - Not public.
  - Size limit 15 MB per file.
  - Allowed types: `image/jpeg`, `image/png`, `image/webp`, `image/heic`.
- Object name: `<family_id>/<photo_id>.<ext>`. The policies require the name to match
  `^[0-9a-f-]{36}/photo-[0-9a-f-]{36}\.(jpg|png|webp|heic)$`.
- select / insert: the first folder must be a family the caller belongs to.
- insert also requires a matching `photos` row in that family.
- update: none. Photos never change.
- delete: none from clients. Only server jobs delete objects.
- No public URLs. Devices download through the authenticated API. A signed URL, if ever used, lives for minutes and
  is never stored.

### 7.4 Account linking rules (for every provider, including WeChat later)

- Never link accounts by matching a name, phone number, or unverified email.
- Supabase's built-in automatic linking of identities with the same **verified** email covers Apple, Google, and
  email.
- Linking a new provider requires a signed-in session from the last 10 minutes.
- An external identity that already belongs to another user is refused. Two accounts are never merged automatically.
- Unlinking is allowed only while another sign-in method remains.

### 7.5 Two-account test matrix (Phase 2B-1)

Accounts A and B are unrelated. A creates a family, the child `emma`, an entry, a photo object, and a soft-deleted
entry. B then attempts each of the following:

| # | B attempts | Expected |
|---|---|---|
| 1 | Select A's child by `(family_id, id)` | 0 rows |
| 2 | Select every table | Only B's rows |
| 3 | Select A's soft-deleted entry | 0 rows |
| 4 | Update or soft-delete A's child | 0 rows affected |
| 5 | Insert with A's `family_id` | RLS violation |
| 6 | Insert `emma` into B's own family | Succeeds, with no hint that A has one |
| 7 | Move B's row to A's `family_id` | Rejected |
| 8 | Entry pointing at A's child, or a plan or photo reference into A's family | Rejected |
| 9 | Download, list, or sign A's photo object; upload into A's folder | Error or empty |
| 10 | Insert into `family_members` for A's family | Rejected |
| 11 | Call `create_family()` a second time | Rejected |
| 12 | Call privileged functions directly; forge `user_metadata` | No effect on access |
| 13 | Write server-only columns (`rev`, `change_seq`, `verified_at`, …) | Overwritten or rejected |
| 14 | Storage name that breaks the pattern (`../`, another family's id, wrong extension) | Rejected |
| 15 | Any request with no session | 0 rows; writes and uploads rejected |
| 16 | Delete any row | Rejected |

A then repeats the key tests against B's data and confirms that A's own access still works.

---

## 8. Photo storage and integrity

1. When the photo is saved locally, the device computes its SHA-256. (Phase 1 already stores the bytes and metadata.)
2. The `photos` row is created with `sha256`, `byte_size`, and `mime_type`. `sha256` can never change after that.
3. The device uploads to the fixed object name, never overwriting. Files above 6 MB use resumable (TUS) upload. The
   object exists only once the upload has completed.
4. An Edge Function, `verify-photo` (Phase 2B-2), reads the object and computes its SHA-256.
   - Match: it sets `server_sha256` and `verified_at`.
   - Mismatch: it deletes the object using the service role and marks the photo for re-upload.
5. Retry rules:
   - "Already exists" with `verified_at` set → done.
   - "Already exists" without `verified_at` → call verify again.
   - Never assume success.
   - After repeated mismatches, the photo is flagged. The local copy is kept regardless.
6. A downloading device checks the bytes against `sha256` before storing them locally. A mismatch is discarded,
   retried, and reported.
7. A record can sync before its photos. Other devices show a placeholder until the photo is verified.
8. **Deletion:** removing a photo sets `deleted_at` on its row. A later purge job deletes objects that have been
   deleted for 30 days and are referenced by nothing. Account deletion removes the family's folder.

---

## 9. Authentication

| Method | iOS | Website |
|---|---|---|
| Sign in with Apple | Native Apple sign-in sheet; raw nonce to Supabase, hashed nonce to Apple; `signInWithIdToken`. The bundle ID is listed in the Apple provider's Client IDs. No secret rotation. | Apple JS or redirect sign-in. The OAuth secret is regenerated every 6 months. |
| Google | Google Sign-In iOS SDK, then `signInWithIdToken`. Web and iOS client IDs are both configured, and "Skip nonce check" is set as in Supabase's iOS guide. | Redirect sign-in |
| Email code | A typed 6-digit code (not a magic link, which would open Safari) | Same |
| No account | Local-only, as today | Same |

- Apple returns the full name only on the first sign-in, so the app saves it to `profiles` immediately.
- Apple guideline 4.8 is satisfied by offering Sign in with Apple wherever Google or WeChat is offered.
- Account deletion inside the app (guideline 5.1.1(v)):
  - an Edge Function deletes the rows, photos, and Auth user;
  - the parent re-confirms with Apple, so the function can revoke the Apple tokens;
  - no Apple tokens are stored.

---

## 10. Local data retention and sign-out

**Retention rule.** Local data is removed only when:

- the parent explicitly asks,
- the account is deleted, or
- a verified security requirement demands it.

There is no automatic expiry. **Unsynced records are never deleted**, whatever the trigger.

**Honest limits.**

- Separate local databases per account keep accounts apart correctly. They are **not** encryption and **not**
  access control.
- On the website, anyone using the same browser profile can read IndexedDB with developer tools.
- In the iOS app:
  - other apps cannot read RootMap's data;
  - iOS encrypts it whenever the device is locked and has not been unlocked since starting up;
  - anyone who unlocks the phone can open the app.

**Sign-out.** Staying signed in is the normal state, so most parents never see this screen. When they do, it is one
screen:

| Platform | Default | Alternative |
|---|---|---|
| iOS | **Sign out (keep on this iPhone).** Data stays and is hidden until the same account signs in again, then appears instantly. | "Sign out and remove from this iPhone" |
| Website | **Recommended on shared computers: "Sign out and remove from this browser."** The screen explains that data kept in a browser is hidden, not encrypted. | "Sign out (keep on this browser)" |

- Removal happens only after pending items have uploaded. If items are still waiting, the screen says how many and
  offers "Wait" or "Keep on this device". Choosing keep cancels the removal.
- Sign-out revokes the refresh token on the server and clears the stored session (Keychain or `localStorage`).
- When a different person signs in, they get their own local database. The first account's copy stays hidden.
- An optional Face ID app lock on iOS is postponed.
- iOS keeps Keychain items after the app is deleted. On first launch after a reinstall, the app clears any stale
  session.

---

## 11. First-login cloud migration (Phase 2B-3)

**What the parent sees:** after signing in, a small banner ("Backing up 48 memories and 130 photos…") while the app
stays usable. In the normal case there is no confirmation screen.

**Upload plan.** A pure function sorts local records using the Phase 1 `origin` rules:

| Group | Action |
|---|---|
| `user` records, and everything attached to an uploaded child | Uploaded automatically |
| Demo children the parent made their own (renamed, new photo, or with `user` records), plus their records | Uploaded automatically |
| Untouched demo data | Not uploaded; stays on the device. No question. |
| `unknown` origin | **One question** covering all of them: back up, or keep on this device only. Never uploaded silently. |
| `archive`, drafts, orphaned photos | Never uploaded |

The parent is asked only when one of these occurs:

- the ownership of some records is ambiguous (the `unknown` group above);
- a local child has the same name and date of birth as a child already in the cloud ("Is Mia on this device the same
  as Mia in your account?");
- a conflict cannot be resolved safely.

Likely duplicate entries are uploaded and listed afterwards for tidying, without blocking anything.

**Verification.** Counts alone are not enough.

| Check | How |
|---|---|
| Identities | Every planned `(family_id, id)` is read back. All present, nothing unplanned. |
| Field values | Field-by-field comparison with the local copy (the Phase 1 verifier approach). Dates are compared as `YYYY-MM-DD`; timestamps as instants (server microseconds vs client milliseconds); null and absent count as equal; text must match exactly. |
| Child relationships | Every `child_id` and `plans.child_ids` resolves within the family, both on the server (foreign key and trigger) and in the client check. |
| Photo references | Every referenced photo has `verified_at` set and a `sha256` equal to the local hash. |
| Completion | The RPC `complete_migration(id, manifest)` re-checks identities and photo verification on the server, then sets `cloud_migrations.status = 'complete'`. Only then does the device mark its records as linked. |

- An interrupted migration resumes. Repeating it is a no-op.
- Cloud data is never overwritten. Inserts use "on conflict do nothing", and conflicts go to the resolver.
- The pre-login (guest) database is kept unchanged. It is never deleted automatically (section 10).

---

## 12. iOS (Capacitor)

**Fit with the current code.**

| Area | Result |
|---|---|
| React 19, Vite 8, Tailwind 4 | Supported. Capacitor loads `dist/`. |
| Navigation | No conflicts: the app navigates with its `screen` state, not URL routes. |
| Vite `base` | `/` for both targets once the custom domain is live (today's GitHub Pages build uses `/rootmapmvp/`). |
| Web Locks, `crypto.randomUUID` | Phase 1 already handles both being absent. |
| `navigator.storage.persist()` | Has no meaning in a WKWebView. Durability comes from native storage. |
| Backup export (`src/lib/backup.ts`) | Needs the share sheet, because download links do not work in WKWebView. |
| Photo object URLs created at start-up (`src/lib/data/store.ts`) | Must become on-demand before the iOS beta (memory limits) |
| Safe areas, launch screen | CSS `env(safe-area-inset-*)` with `viewport-fit=cover`; a native launch screen that matches the opening animation |
| Origin `capacitor://localhost` | Local data is separate from the website's. The two meet only through the cloud. |

**Why native storage.** Capacitor's storage guide says iOS may reclaim web-view `localStorage` and IndexedDB when the
device is low on storage. It recommends SQLite for important data.

**Proof of concept** (a separate small app, before any change to the main app):

| Validate | Pass criteria |
|---|---|
| SQLite persistence | Data survives app kill, device restart, an iOS update, and a low-storage condition; transactions are atomic |
| Native photo files | Files in Application Support survive the same events; read and write speed is acceptable for 1,000+ photos; they are included in device backup |
| Keychain session | A session survives restarts; it can be read after first unlock; it is cleared after a reinstall |
| Photo picker | The file input opens the iOS picker with no library permission prompt; the camera works with a usage description; HEIC converts to JPEG |
| App lifecycle | Writes complete or roll back cleanly when the app is backgrounded or killed mid-write |
| Existing React code | The current `dist/` runs unchanged; the opening animation, fonts, and safe areas render correctly |

The main app does not move to SQLite until every row passes.

**App Store items.**

- Guideline 4.8: Sign in with Apple must be offered (it is).
- Guideline 5.1.1(v): the app must work without an account (it does) and must offer account deletion inside the app.
- Social-network tokens may not be stored off the device. WeChat tokens are discarded (section 13).
- Privacy labels and `PrivacyInfo.xcprivacy`, including the manifests of the Google and WeChat SDKs.
- The app is not in the Kids category.
- Guideline 4.2 (more than a repackaged website) is a review risk, reduced by offline use and native features.
- **A China App Store listing requires an ICP filing number**, which in practice needs a mainland entity.

---

## 13. WeChat (research only)

**Status:** no bridge will be built until both checks below pass.

**Entity.** There is no mainland company today. A future one is possible.

| Applicant | WeChat Login (reported) | Fee (reported) | China App Store |
|---|---|---|---|
| Mainland company | Yes | 300 CNY / year | Possible with an ICP filing |
| Overseas (e.g. US) company | Reported possible with a home-country registration certificate | US$99 / year | No (no ICP filing) |
| Individual | Treat as no (sources conflict; mainland sole-proprietor registration only) | — | No |

These are secondary sources. They need written confirmation from WeChat Open Platform support.

**Session method to verify before any build.** An Edge Function cannot issue a Supabase session directly. The
candidate method:

1. The Edge Function exchanges WeChat's one-time code on the server.
2. It **discards WeChat's tokens** (Apple 5.1.1(v)) and looks up `unionid` in a private table.
3. If no user exists, it creates one with a non-deliverable placeholder email on our own domain and
   `app_metadata.provider = 'wechat'`.
4. It calls `admin.generateLink` and returns only the `hashed_token`.
5. The app calls `verifyOtp` and receives a normal Supabase session.

Requirements for that method:

- An Auth hook blocks email-code sign-in for the placeholder domain.
- A community report says repeated `generateLink` calls can return the same token. A test spike must prove repeated
  sign-ins work.
- Fallback: a minimal OIDC facade registered as a Supabase custom OIDC provider.

---

## 14. International, privacy, and legal

- **China (PIPL):**
  - Personal information of children under 14 is sensitive.
  - It needs separate guardian consent.
  - Storing it outside China is a cross-border transfer and needs a legal mechanism.
  - Exemption thresholds have changed recently.
- **US:**
  - The amended COPPA Rule has applied since 2026-04-22. Whether it applies to a parent-facing app is a legal
    question.
  - State privacy laws may apply.
- **Both markets:**
  - English and Simplified Chinese copy for every new screen.
  - Names stored exactly as entered.
  - Time zone stored on the profile.
  - No ads, no trackers, no sale of data.
- **No compliance claims** until counsel confirms. The review must finish before any real family onboards.

---

## 15. Environments and operations

| Item | Now | Later |
|---|---|---|
| Local stack | `supabase start` (Docker) for development and every database test | — |
| Staging | One Supabase project on the Free plan. Its region does not bind production. | Kept for testing |
| Production | **Not created** | Pro, created after the region test |
| Migrations | `supabase/migrations/*.sql` in git; applied to staging with `supabase db push` | The same files reach production |
| CI | Database tests run against a local stack in GitHub Actions | Optional staging smoke test |

**Region test** (needs approval to create temporary Free projects):

- Candidate regions: US West, Tokyo, Singapore, and Seoul.
- Run from China Telecom, Unicom, and Mobile (broadband and mobile, two or more cities) and from both US coasts.
- Run for 7 days, including the 20:00–23:00 Beijing peak.
- Measure:
  - DNS and TLS success,
  - REST response time (median and p95),
  - 1 MB upload and download success,
  - Auth reachability,
  - the custom domain.
- Decision rule: choose the region with the best China results that also has US p95 below about 500 ms.

The region cannot be changed after the project is created.

---

## 16. Costs (approximate)

| Item | Cost |
|---|---|
| Supabase Pro (production, later) | $25 / month base; about $30 / month at 1,000 active families. Photo storage drives growth: $0.0213 / GB-month beyond 100 GB. |
| Supabase Free (staging) | $0 (pauses after a week of inactivity, no backups) |
| Apple Developer Program | About $99 / year (needed for iOS and Sign in with Apple) |
| Domain | About $10–20 / year |
| Email sender | $0 on most free tiers at MVP volume |
| WeChat verification | Reported $99 / year (overseas) or 300 CNY (mainland); to be confirmed |

---

## 17. Known risks

| Risk | Mitigation |
|---|---|
| Family-row lock serialises writes within one family | Families have one or two writers. Keep transactions short; batch migrations in chunks; monitor lock waits. |
| A future feature breaks a section 5.4 invariant (per-row sharing, hard deletes) | The invariants are tested in CI. Breaking one requires introducing a change_log first. |
| Purging a child tombstone while entries still reference it | The purge (a later phase) must handle dependants. Foreign keys block an unsafe purge. |
| Legacy values that do not fit cloud columns (data URLs, bundled asset paths, unusual ids) | The migration planner converts them, or keeps them local with a reason. The id check accepts every Phase 1 id form. |
| Clock-based ids (`p-${Date.now()}` from "Repeat" in My Week, `g-${Date.now()}` for goals) could collide between devices of one family | **Fixed in 2B-2 M0**: both use `newRecordId()`. A unit test fails if a screen builds an id from `Date.now()` again. Ids already stored keep their form. |
| A background change during an in-flight confirmed save publishes that save a few milliseconds early; if the save then fails it can stay visible until reload (known limitation, accepted in M0; see data-architecture.md, Remaining risks) | Sync must decide what to upload from the outbox written in the same transaction as the record (M3), never from the published screen state |
| The local Supabase stack differs slightly from hosted Supabase | Apply the same migrations to staging and run the test suite against it before each phase ends |
| iOS storage eviction | Native backend after the PoC; the cloud copy covers anything already synced |
| WeChat entity and session method unverified | No bridge until verified; Apple, Google, and email are not blocked |
| China reachability | Region test; local-first use; the custom domain allows a proxy later |
| App review under 4.2 | Native features, offline use, early TestFlight review |

---

## 18. Phase plan

| Phase | Scope | Status |
|---|---|---|
| **2B-1 Cloud foundation** | Schema, family ownership, RLS, storage policies, revision and `change_seq` triggers, two-account and sync-cursor tests, CI | **Done.** Deployed to staging on 2026-10-12 (section 19). Awaiting review. |
| 2B-2 Sync client | Outbox, conditional push, pull, resolver with `record_versions`, photo queue, `verify-photo`, sign-in screens (Apple, Google, email), sign-out | **In progress** (M0 awaiting review; see below) |
| 2B-3 First-login migration | Planner, automatic upload, verification, `complete_migration` | Later |
| iOS PoC | Separate proof of concept (section 12) | Before any iOS backend work |
| iOS app | Capacitor build, native backend, Keychain, native sign-in, account deletion, TestFlight | After the PoC |
| WeChat | Only after the entity and the session method are verified | Research |


### Phase 2B-2 milestones (approved 2026-10-12)

Order chosen for technical dependencies: the first-login upload (M6) reuses the record and photo sync (M4, M5).
Records already on the device are never uploaded before M6 has checked them.

| Milestone | Scope | Status |
|---|---|---|
| M0 Groundwork | Cloud settings per environment (local, staging, production), off by default and locked off for the public website, with a build guard against secret keys; platform adapters; screens follow store changes; uuid ids for goals and repeated plans | Implemented, awaiting review |
| M1 Account foundation | Session handling, email-code sign-in, sign-out with server revoke, `create_family()` once | Not started |
| M2 Sign-in screens | Opening screens wired up; email + 6-digit code (no password); WeChat hidden; Profile account section | Not started |
| M3 Account spaces and outbox | Per-account local database; outbox and sync state written with each change; guest database never modified | Not started |
| M4 Record sync | Mapping, conditional push, paged pull, resolver, `record_versions`, one syncing tab | Not started |
| M5 Photo sync | SHA-256 on save (and backfill), upload, `verify-photo`, checked download | Not started |
| M6 First-login migration | Ownership and duplicate checks, questions only when ambiguous, verified upload, `complete_migration()` | Not started |
| M7 Sign-out and reliability | Sign-out choices, account switching, full re-sync, sync status | Not started |

**Product decisions.** Email sign-in uses a typed 6-digit code, with no password. The WeChat button stays hidden until
WeChat works. The Welcome screen is shown to new devices only; a device that already has data opens straight into the
app. The public website keeps cloud features off. After sign-out, "continue without an account" starts a fresh guest
space and never shows another account's data.

**Architecture requirements.**

- **Environments.** `local` (`npm run dev`, a loopback Supabase only), `staging` (`--mode staging`, HTTPS), and
  `production` (the public website, cloud locked off). See `src/lib/cloud/environment.ts` and `.env.example`. No
  staging preview is deployed yet.
- **Guest data ownership.** Signing in does not by itself claim the guest data. Before guest records are copied
  into an account's space, the migration checks ownership and possible duplicates. Ambiguous records need the
  parent's confirmation. The original guest database is never changed.
- **Backup status.** Sync status is tracked per record and per photo from the start. "All backed up" is shown only
  when every relevant record and photo has been confirmed by the server (photos: `verified_at`). Pending, failed and
  held items never count as backed up.

---

## 19. Deployment status

### Environments

| Environment | Project | Region | Plan | Schema | Data |
|---|---|---|---|---|---|
| Local | `supabase start` (Docker) | — | — | Migrations `20261012000100`–`000600` | Test data only, recreated on every reset |
| Staging | `rootmap-staging` (`cbgkkeveprftddrobzao`) | us-east-2 (does not bind production) | Free | Migrations `20261012000100`–`000600`, applied 2026-10-12 with `supabase db push --linked` | None: 0 users, 0 objects, 0 app rows |
| Production | **Not created** | Decided by the region test (section 15) | Pro | — | — |

### Phase 2B-1 implementation

| Migration | Contents |
|---|---|
| `20261012000100_ownership.sql` | `private` schema; `families`, `family_members`, `profiles`, `user_settings`; `private.my_family_ids()`, `private.is_family_member()`; `public.create_family()` |
| `20261012000200_family_tables.sql` | The 9 family-data tables, keys, foreign keys, checks, pull and per-child indexes |
| `20261012000300_revision_triggers.sql` | `t00_member` (membership checked first), `t10_*` reference checks and guards, `t90_stamp` (`rev`, `change_seq`, `server_updated_at`, `updated_by`) |
| `20261012000400_rls.sql` | RLS on all 13 tables; 35 policies; no delete policies |
| `20261012000500_storage.sql` | Private `family-photos` bucket (15 MB; JPEG, PNG, WebP, HEIC); `private.photo_object_allowed()`; storage select and insert policies |
| `20261012000600_grants.sql` | Nothing for `anon`; column-level insert/update for `authenticated`; no automatic grants on future objects |

Every database change is a new migration file. An applied migration is never edited.

### Verified on staging after deployment (2026-10-12)

- All 6 migrations are recorded remotely.
- All 13 tables exist, and all 13 have RLS enabled.
- 35 table policies:
  - none name `anon` or `public`;
  - none allow delete.
- 2 storage policies (select, insert).
- The bucket is private, with the 15 MB limit and the 4 image types.
- `anon` has 0 table grants. `authenticated` has only table-level `SELECT`, plus column-level insert and update; no server-controlled column is writable.
- 13 functions:
  - every security definer function has a fixed `search_path`;
  - none can be executed by `PUBLIC` or `anon`;
  - `authenticated` can execute only `private.is_family_member`, `private.my_family_ids`, `private.photo_object_allowed`, and `public.create_family`.
- 25 triggers.
- No user data: 0 auth users, 0 storage objects, 0 application rows.

### Tests (local stack)

| Suite | Result |
|---|---|
| `npm run test:db` | **48/48 pass**: security 15, storage 8, revisions 13, sync cursor 12 |
| `npm test` | 14/14 |
| `npm run typecheck`, `npm run build` | Clean |
| `npm run test:e2e` | 31/31 (app 25, resilience 3, tabs 3) |

To confirm the tests detect regressions, the local database was sabotaged twice on purpose:

- RLS turned off on `children`, and clients allowed to write `rev`: 9 security tests failed.
- The family-locked change number replaced with a plain sequence: 6 cursor tests failed, including the concurrent commit-order test.

The test suite refuses to run against any non-local database, so it has never run against staging.

### Known limitations

- The GitHub Actions workflow (`.github/workflows/db-tests.yml`) runs on every push to `main` and on pull requests.
  Its first run, on commit `002dc21` (2026-10-12), passed: database tests, unit tests, and typecheck, in about
  2 minutes, with no credentials.
- Not yet built: `verify-photo`, the purge job, account deletion, `complete_migration()`, and the WeChat identity table.
- Staging is on the Free plan: it pauses after 7 days of inactivity and has no backups. Test data only.

---

## Sources

Checked on 2026-10-11:

- Supabase: [pricing](https://supabase.com/pricing), [custom OAuth/OIDC providers](https://supabase.com/docs/guides/auth/custom-oauth-providers),
  [Login with Apple](https://supabase.com/docs/guides/auth/auth-apple), [Login with Google](https://supabase.com/docs/guides/auth/social-login/auth-google),
  [regional network blocks](https://supabase.com/blog/navigating-regional-network-blocks)
- Capacitor: [storage guide](https://capacitorjs.com/docs/guides/storage), [Capacitor 8 announcement](https://ionic.io/blog/announcing-capacitor-8)
- Apple: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/),
  [offering account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app/),
  [App Store Connect app information (ICP)](https://developer.apple.com/help/app-store-connect/reference/app-information/)
- WeChat: [website login](https://developers.weixin.qq.com/doc/oplatform/en/Website_App/WeChat_Login/Wechat_Login.html),
  [iOS access guide](https://developers.weixin.qq.com/doc/oplatform/en/Mobile_App/Access_Guide/iOS.html);
  secondary: [qualification guide](https://blog.lusyoe.com/article/wechat-login-developer-qualification-guide.html)
- [GoTrue issue on generateLink / verifyOtp](https://github.com/supabase/gotrue/issues/1357)
- [Federal Register: COPPA Rule (2025)](https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule)

Some details come only from secondary sources and need confirmation: WeChat fees and entity rules, ICP filing for
individuals, PIPL thresholds, and WebKit storage behaviour inside apps.
