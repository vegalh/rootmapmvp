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
  - **M0 (groundwork) is done**: commit `cdda37c`, GitHub Actions passed. Cloud settings (off by default, locked
    off for the public website), platform adapters, screens that follow store changes, uuid ids.
  - **M1 (account foundation) is done**: commit `ae9f0f6`, GitHub Actions passed. Email-code sign-in, session
    restore and refresh, sign-out, and the family and profile on first sign-in (`src/lib/cloud/`).
  - **M2 (sign-in screens) is done**: commit `433a91b`, GitHub Actions passed, the public website checked (cloud
    off, no Supabase in its bundle). Staging email templates: approved, waiting to be changed in the dashboard.
  - **M3 (account spaces and outbox) is done**: commit `a18e414`, GitHub Actions passed, public website checked.
  - **M4 (record sync) is done**: commit `de5f8dc`, GitHub Actions passed, public website checked.
  - **M5 (private photo sync) is done.** Photo files upload to the private bucket (resumable above 6 MB), the
    `verify-photo` Edge Function checks each one before it counts as backed up, and other devices download and
    check them. A failed photo shows "Try Again" on the Account page. `verify-photo` is deployed to staging
    (2026-10-12, after its security review).
  - **M6 (first-login migration) is done**: commit `6f3dab3`, GitHub Actions passed, public website checked. A
    parent's guest data is brought into their account after one question, uploaded by the M4/M5 sync and completed
    only after the server re-checks it (`complete_migration()`). Migration `000700` applied to staging 2026-10-12.
  - **The full M7 is not planned.** Only two safety fixes were made (2026-10-12): the sign-out dialog says how many
    items aren't backed up yet (they stay on the device and upload at the next sign-in), and sync asks Auth every
    5 minutes (and before its first round) whether the session is still valid, so a session revoked elsewhere stops
    uploading at once instead of when its access token expires; the app then signs out and opens the guest space.
  - Each later milestone starts only after explicit approval.
- **Not yet in place:** no production project exists; Capacitor and WeChat are not started.

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
| `saved_collections` | `(family_id, id)` | Saved RootMap collections (id = collection id) | `savedCollections` |
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
| `saved_collections` | (id = collection id; no extra columns) |
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
  The one exception is `public.record_usage()` (section 20): a fixed, validated, rate-limited write of anonymous
  usage totals that `anon` may execute.
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
| Email and password (2026-10-27) | Created with a code, then required | Same |
| No account | Local-only, as today | Same |

- Apple returns the full name only on the first sign-in, so the app saves it to `profiles` immediately.
- Apple guideline 4.8 is satisfied by offering Sign in with Apple wherever Google or WeChat is offered.
- Account deletion inside the app (guideline 5.1.1(v)):
  - an Edge Function deletes the rows, photos, and Auth user;
  - the parent re-confirms with Apple, so the function can revoke the Apple tokens;
  - no Apple tokens are stored.

**Passwords (2026-10-27, the owner's decision).** An account is created with an email code, then a password is
required; later sign-ins use email and password.

- Welcome › Continue with Email shows email, password, **Sign in**, and **Email me a code**. The code is for a new
  parent or a forgotten password.
- After any sign-in, the app checks for a password. If the account has none, the only page is **Create a password**:
  at least 6 characters, typed twice, no tabs. This covers new accounts, accounts from before passwords, and a parent
  who quit halfway. It is shown only once the server has confirmed the account, so being offline never locks a
  parent out of their data.
- **Forgot your password:** the **Forgot password?** link under the password field emails a confirmation code. The
  code screen says "Reset your password". Once the code is accepted, the app opens on Set a new password (`#/password`).
  The old password stops working. Profile › RootMap Account › **Change password** works the same way at any time.
- A wrong password, an unknown email and an account without a password all give the same message. Nobody can tell
  which emails have accounts.
- "Has a password" is the `rootmap_password: true` mark in the user's metadata, set together with the password
  (`setPassword` in `src/lib/cloud/auth.ts`). Users can edit their metadata, but the mark only decides whether to
  ask. Supabase checks the password itself.
- Server settings (each project, Authentication › Providers › Email / Policies): minimum password length **6**
  (`supabase/config.toml` locally). If "Secure password change" is on, a change long after sign-in asks to sign
  in again with a code ("reauth-needed").
- CAPTCHA, when configured (`VITE_TURNSTILE_SITE_KEY`), covers password sign-in as well as codes.

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
  - No ads, no trackers, no sale of data. RootMap's own usage analytics (section 20) are first-party aggregate totals,
    off by default for each parent, and not enabled on the public website.
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
| M0 Groundwork | Cloud settings per environment (local, staging, production), off by default and locked off for the public website, with a build guard against secret keys; platform adapters; screens follow store changes; uuid ids for goals and repeated plans | **Done** (`cdda37c`) |
| M1 Account foundation | Session handling, email-code sign-in, sign-out with server revoke, `create_family()` once | **Done** (`ae9f0f6`) |
| M2 Sign-in screens | Opening screens wired up; email + 6-digit code (no password); WeChat hidden; Profile account section | **Done** (`433a91b`) |
| M3 Account spaces and outbox | Per-account local database; outbox and sync state written with each change; guest database never modified | **Done** (`a18e414`) |
| M4 Record sync | Mapping, conditional push, paged pull, resolver, `record_versions`, one syncing tab | **Done** (`de5f8dc`) |
| M5 Photo sync | SHA-256 on save (and backfill), upload, `verify-photo`, checked download | **Done** (`0e454f4` + Try Again) |
| M6 First-login migration | Ownership and duplicate checks, questions only when ambiguous, verified upload, `complete_migration()` | Implemented, awaiting review |
| M7 Sign-out and reliability | Sign-out choices, account switching, full re-sync, sync status | Not started |

**M1 implementation notes.**

- `src/lib/cloud/auth.ts`: `requestEmailCode` / `verifyEmailCode` (account created on first use, so "create" and
  "log in" are one flow), `restoreSession`, `signOut`, and `authFailure`, which turns server errors into a few
  explainable failures (`code-rejected`, `rate-limited`, `offline`, …). `account.ts`: `ensureFamily`,
  `ensureProfile`, `ensureAccount`. Both take the Supabase client, so the tests run the app's own code.
  `session.ts`: the app-wide sign-in state and the actions M2's screens will call. `client.ts`: the lazily loaded
  client.
- **Supabase is not in the public bundle.** It is imported lazily, behind a condition Vite decides at build time.
- **Family and profile setup are idempotent without a new migration.** The client looks for its membership first.
  It calls `create_family()` only if there is none, and looks again if a parallel device won the race. The profile is
  inserted with `on conflict do nothing`, so an existing profile is never changed. Nothing local is uploaded: the
  family has no name and the profile only its owner.
- **Restore is offline-first.** An unreachable server keeps the parent signed in, using the user stored with the
  session (M3 needs that id to open the account's local space). A session the server rejects means signed out.
- **Sign-out** uses scope `local`. The server revokes this device's refresh token and other devices stay signed in.
  The stored session is removed even when the server cannot be reached.
- The client uses the implicit flow: with PKCE, every code request would leave an unused verifier in storage. The
  Apple / Google redirect sign-in (a later phase) will use PKCE.
- The local stack's emails show only the code (`supabase/templates/email-code.html`, English and Chinese).
  **Staging still sends links:** its templates are changed in M2, with approval.
- **Known limitations.**
  - An access token already issued stays valid until it expires (`jwt_expiry`, 1 hour), even after sign-out; the
    device no longer holds it.
  - Code expiry is the server's `otp_expiry` (1 hour locally). It is not covered by a test; M2 sets the expiry
    for staging.
  - Sign-in state is per tab until M7.

**M2 implementation notes.**

- **Screens.** `OpeningExperience` (unchanged animation and look) now has Welcome → email → code. "Create an
  account" and "I already have an account" are the same flow with different words. The code is checked as soon as
  six digits are typed or pasted; "Send a new code" waits 60 seconds. WeChat and Apple buttons are hidden
  (`SOCIAL_PROVIDERS` is empty); Google is not built. No password or phone fields remain.
- **Who sees Welcome** (`src/lib/welcome.ts`), only in builds with cloud features:
  - a new device (no seed version recorded, nothing of the parent's own) sees it until the parent signs in or taps
    "Continue without an account"; a reload in between shows it again;
  - a device that already has RootMap data opens straight into the app, and nothing is written for it;
  - the device setting `rootmap-welcome` (`pending` / `done`) is not part of backups.
- **Profile.** The Account group gets "RootMap Account" (email; Sign out with a confirmation) or "Sign in or
  create an account", which opens the same sign-in screens. The row does not exist on the public website.
- **Data.** Signing in or out changes nothing stored locally (the browser test compares IndexedDB before and after
  each step). Only auth, the membership check, `create_family` and the empty profile are sent; no records, no
  photos. After sign-out the same local data stays visible: separating guest and account data is M3.
- **Errors** are shown in plain words: invalid email, wrong or expired code (Supabase reports both the same way),
  too many tries, no connection ("Everything on this device is safe"), sign-in unavailable.
- **Not changed:** PKCE / OAuth (with Google and Apple, later), the database, the OTP expiry.
- **Staging (approved for `rootmap-staging` only; to be changed in the dashboard, not yet done).** Staging emails
  still contain a link. To send the same 6-digit code as the local stack:
  1. Email templates "Confirm signup" (new parents) and "Magic Link" (returning parents): subject
     `Your RootMap code / RootMap 验证码`, body `supabase/templates/email-code.html` (shows `{{ .Token }}`, no link).
  2. Email OTP length: 6 (check the current value; change only if different).
  3. OTP expiry: **unchanged** (3600 seconds).
  Done in the dashboard (Authentication → Emails / Sign In / Providers → Email). `supabase config push` is not
  used, because it would also push the local stack's other settings (site URL, rate limits).

**M3 implementation notes.**

- **Spaces** (`src/lib/data/schema.ts`). The guest space is the database RootMap has always used (`rootmap`,
  version 1, same stores). Each account gets `rootmap-account-<userId>` (its own version 1) with the same stores
  plus `outbox` and `syncRecords`, and a `meta` record `space` (user id, device id, family id and sync cursor for
  M4). Account spaces never use the localStorage fallback (those keys are the guest's); if IndexedDB fails there,
  the app shows the "try again" screen.
- **Which space opens** (`src/lib/cloud/space.ts`): decided at start-up from the stored session, offline. Signing
  in, signing out, a revoked session or a sign-in in another tab reloads the page into the matching space, so no
  space's data is ever in memory with another's. The reload waits until sign-in (family and profile) has finished,
  and stops after three in a row (no loop).
- **The guest database is never written while signed in.** A new account space reads only the guest's language and
  appearance (read-only open, which never creates a database). Draft rescue copies are kept per space.
- **Outbox.** One entry per changed record (`<collection>:<id>`, `put` or `delete`, `seq`, `queuedAt`,
  `changedAt`, `deviceId`), written in the same IndexedDB transaction as the record, for every write path: screens,
  photos, restore from backup. Changing a record again keeps its place in the queue. Settings are not queued yet
  (which settings sync is decided with M4's mapping). Only account spaces have an outbox.
- **All or nothing.** A change that can't be fully queued (e.g. a value IndexedDB can't store) now aborts its whole
  transaction. Before M3 such a change could be stored partly; this also applies to the guest space.
- **Device id**: `rootmap.device-id` in localStorage (per browser profile), recorded in each account space.
- **Guest migration plan** (`src/lib/data/guestPlan.ts`): a pure function implementing section 11's grouping
  (upload / keep demo / ask / never, possible duplicates, photos), plus a read-only guest snapshot. Nothing calls
  it yet; M6 uses it, with the parent's confirmation.
- **What the parent sees.** After sign-in, a new account's space is empty (guest children are not shown or
  copied). After sign-out, the guest space reappears exactly as it was. The Account page explains this.

**M4 implementation notes** (`src/lib/sync/`).

- **Mapping** (`mapping.ts`): local records ↔ the client-owned columns of each table (`records` → `activity_records`,
  `saved` → `saved_activities`, `savedCollections` → `saved_collections`; legacy `observations` stay local, already folded into entries). Server columns are
  never sent; `id`, `goals.owner_user_id` and the photo identity columns are never updated. A download is merged onto
  the local record, so local-only fields survive. A child's default picture travels as `bundled:default-child`; other
  local pictures the server can't hold (e.g. demo assets) stay on the device.
- **Push** (`engine.ts`): outbox entries in dependency order (photos, children, then what refers to them). Insert
  with "on conflict do nothing"; update only `where rev = <last seen>`. No row back means conflict: the server's row
  is fetched and resolved, losing versions are written to `record_versions` **before** the merged result, and the
  result is written at the server's revision (at most 3 attempts per round). Version ids are derived from their
  content, so a repeat adds nothing.
- **Pull**: per table, `change_seq > cursor` in pages of 500; each page and its cursor are applied in one local
  transaction. A downloaded row for a record with an unsent local edit is resolved immediately (the merge is kept
  locally and sent next; losing local versions are queued as outbox `versions` entries), so the next upload can never
  overwrite the other device's change.
- **Local commits** (`store.ts` `commitSync`): all-or-nothing, and refused if any record involved has changed since
  sync looked at it (checked on disk inside the transaction, so another tab's edit counts too). A refused commit is
  recomputed; nothing sync writes is queued for upload again.
- **Never sent**: anything outside the open account space (guest data is in another database); records of `demo` or
  `unknown` origin ("held" until M6 decides); records that need one of those, or a photo that couldn't be sent
  ("waiting"); records the server refuses ("failed", retried each round). Photo **files** are not uploaded (M5); the
  photo's details (`photos` row with its SHA-256) are, because entries and children can only refer to photos the
  server knows.
- **Interruptions**: an upload the server applied but the device didn't record is recognised on retry by content
  (no second row, no extra revision, no version kept); an interrupted download repeats at most one page.
- **When it runs** (`runner.ts`): at start, 1.5 s after local changes, on reconnect and when the app returns to the
  screen, and every 30 s; one round at a time per account across tabs (Web Locks); back-off up to 5 minutes. A tab
  that sees another tab's changes on disk reloads its data first.
- **Status** (`status.ts`, Account page): "All backed up" only after a completed round with nothing pending, held or
  failed and every photo shown by a live record verified on the server. Until M5 that means a record with a photo is
  never "all backed up"; the page says how many photos are waiting.
- **Not in M4**: settings and the parent's profile (`user_settings`, `profiles` content), photo files, the
  first-login migration, purge / full re-sync after a watermark, a record_versions screen ("Another version saved").

**M5 implementation notes.**

- **`verify-photo`** (`supabase/functions/verify-photo/`): the caller must be signed in (the function asks Auth for
  the user behind the token; the gateway's JWT check is off for it). The photo's row is read **with the caller's
  token**, so row-level security decides: another family's photo is "not found". Only then does it use the service
  role (server-side only) to read the object and compute its SHA-256. Match (hash and size): sets `server_sha256`,
  `verified_at` and, if empty, `uploaded_at`. Mismatch: deletes the object. Missing: says so. Repeating it is safe.
  No database migration was needed.
- **Upload** (`src/lib/sync/photos.ts`), after each record round, for photos of the open account space whose row
  is on the server and not verified: ask `verify-photo` first (an earlier upload may have arrived), upload if
  missing (`upsert: false`; the bucket has no update policy, so nothing is ever overwritten), then verify again.
  Above 6 MB the upload is resumable (TUS, 6 MB chunks); its address is kept with the photo, so after an
  interruption or a reload it continues from what the server has. A local copy that no longer matches its own
  SHA-256 is never sent. After 3 rejected uploads the photo is reported and left alone until the parent taps
  **Try Again** on the Account page (shown whenever a photo had a problem); that clears the count and starts a round
  at once.
  The device's photo is never deleted or changed by any of this.
- **SHA-256**: computed when a photo is saved (every space, new photos); for older photos, when sync first needs
  it. Guest photos are never uploaded (they are in the guest database) — the first-login migration (M6) decides.
- **Download**: only verified photos, through the account's session (`storage.download`, checked by the bucket's
  select policy). The bytes are kept only if their SHA-256 matches the row; otherwise discarded, reported, and
  tried again next round. An existing local copy is never replaced.
- **Status**: a photo is backed up only when its row has `verified_at` (set by the server). Failed uploads or
  downloads are shown ("{n} photos had a problem uploading"); "All backed up" requires every photo shown by a live
  record to be verified.
- **Local stack and CI**: the Edge runtime is now on (`supabase/config.toml`, and the CI workflow no longer
  excludes it).
- **Security review (2026-10-12)** before deploying with the gateway's JWT check off:
  - the token is checked with Auth (`auth.getUser`) before anything else; no session, the public key, a forged or
    garbage token all get 401 (tested locally and on staging);
  - the row is read with the caller's token, so RLS decides; another family's photo is 404 and nothing is read or
    changed (tested);
  - the service role touches only `storage_path`, a **generated** column (`<family_id>/<id>.<ext>`, unique, not
    writable by clients), so a member can't point it at another family's file;
  - only `server_sha256`, `verified_at` and `uploaded_at` are written, and only for a row the caller can see.
- **Staging**: deployed 2026-10-12 with
  `npx supabase functions deploy verify-photo --project-ref cbgkkeveprftddrobzao --no-verify-jwt` (version 1,
  `verify_jwt: false`). The bucket and its policies were already there (migration `000500`). Nothing else changed.

**M6 implementation notes** (`src/lib/sync/guestImport.ts`, `src/pages/GuestImportPage.tsx`, migration `000700`).

- **What the parent sees.** After signing in on a device with memories from before, one screen: "Bring your
  memories into your account?" with the children's names and counts, which sample children stay on the device, and
  that everything also stays on the device. Two buttons: **Add to my account** / **Not now**. Further questions
  appear only when needed: records whose origin isn't known ("Are these yours too?": add / leave on this device)
  and each child with the same name and birth date as one already in the account ("Is Mia the same child?": same /
  different). The Account page then shows progress ("… {done} of {total} backed up") and finally "Your earlier
  memories are in your account". "Not now" copies nothing; the Account page offers it again. Another account
  signing in on the same device is asked separately and told some of it may already be in another account.
- **Why one question (not automatic).** Decision 14 says automatic when ownership is clear. On a website or shared
  device the app can't know that the person signing in is the one who used it as a guest, so the first upload of
  guest data always takes one tap. Making it automatic (e.g. for the first account on a device) is a small change.
- **Planner** (`guestPlan.ts`), fixed: the memories the app makes from the demo observations (`obs-o1`, `obs-o2`)
  are stored with origin `user` (the app wrote them), and older versions stored the demo pictures as photos (SVG).
  Both made every untouched demo child look "made own". Untouched demo content is now recognised by content (demo
  records, observations and those memories as shipped, default saved activities, a demo picture by its SHA-256), so
  only real changes make a demo child the parent's.
- **Copy** (`importGuestCopy` in `store.ts`): chosen records, photos (metadata and bytes), their outbox entries and
  the attempt's state (`meta` record `guestImport`) in **one IndexedDB transaction** in the account's space, using
  `add` (never overwrite). The guest database is only read (`openExisting`). Copied records get origin `user` (the
  parent confirmed them); the manifest's `sources` map each guest record to its account id.
- **Ids.** An id the account already uses for something else gets a new id (old one in `legacyId`), with references
  (child ids, photo ids) rewritten; a record already there with the same content is not copied again; a child is
  combined with an account child only when the parent answered "same child" (never on id alone). A chosen record
  always brings its child. Legacy observations stay local (already folded into memories).
- **Photos.** Bytes are read from the guest database and hashed when the parent says yes. A missing file, a file
  whose bytes no longer match its recorded SHA-256, or a type the bucket doesn't accept (e.g. SVG) is not uploaded
  and is reported ("{n} photos couldn't be added"); the reference is left out of the account's copy only. A demo
  child's bundled picture stays the bundled picture.
- **Upload** is the ordinary M4/M5 sync. **Completion** (`advanceGuestImport`, after every sync round): every manifest
  record confirmed by the server with nothing pending, every photo verified, then a field-by-field comparison of the
  server's rows with this device's records, then `complete_migration(family, id, manifest)`. The server re-checks
  that every record is in the family (goals: the caller's own) and every photo has `verified_at` and
  `server_sha256 = sha256` = the manifest's; only then is `cloud_migrations.status` complete. Until then the attempt
  stays "copied" and is retried each round.
- **Repeats and interruptions.** The copy is all-or-nothing; a second tap or tab finds the attempt already decided
  (Web Lock plus a state check inside the transaction). An interrupted upload continues with sync. The manifest is
  also stored on the server (`cloud_migrations`, per device), so a device whose account space was removed doesn't
  bring the same records again.
- **`complete_migration()`** (migration `20261012000700_complete_migration.sql`): `security definer`, no user id
  argument, caller must be a member of the family, `execute` for `authenticated` only. The status guard now allows
  the change only inside this function (a transaction-local setting clients can't set). Tested: completes only when
  everything is there and verified; other families get 42501; claims about records not in the caller's family stay
  incomplete; clients still can't set the status; no user, no completion.
- **Cost.** The check after sign-in reads the guest database and the account's matching ids once per app start
  until the parent has decided; photo files are read and hashed only after "Add to my account".
- **Not in M6:** the parent's profile, notes pad and other settings are not brought in (settings don't sync yet);
  guest records added after a completed import are not offered automatically; a "tidy duplicates" screen (likely
  duplicates are only counted); the "Another version saved" screen.

**Product decisions.** Email sign-in uses a typed 6-digit code, with no password. The WeChat button stays hidden until
WeChat works. The Welcome screen is shown to new devices only; a device that already has data opens straight into the
app. The public website keeps cloud features off. After sign-out the device's guest space opens; it never shows an
account's data. (M3: this is the existing guest space, unchanged, because guest data is kept until its ownership is
established. Whether a fresh guest space should be used once guest data has been moved into an account is decided
with M6 / M7.)

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
| Local | `supabase start` (Docker) | — | — | Migrations `20261012000100`–`000700` | Test data only, recreated on every reset |
| Staging, and the public website since 2026-10-27 | `rootmap-staging` (`cbgkkeveprftddrobzao`) | us-east-2 | Free | Migrations `20261012000100`–`000700`, applied 2026-10-12 with `supabase db push --linked` (`000700` after a dry run showed it was the only one pending) | None: 0 users, 0 objects, 0 app rows |
| Production (dedicated) | **Not created**: the website uses rootmap-staging | Decided by the region test (section 15) | Pro | — | — |

### The public website uses rootmap-staging (decided 2026-10-27)

On 2026-10-27 the owner decided that the public website uses sign-in, sync and analytics against the existing
**rootmap-staging** project. No separate production project exists. The privacy and legal review (section 14) is
still open; the owner chose to proceed.

Accepted trade-offs:

- **Free plan:** the project pauses after 7 days without activity, and the website's sign-in then fails until
  someone restores it in the dashboard.
- **No backups.**
- **Test data:** accounts and rows created during testing stay, and count in the admin dashboard.
- **Region:** us-east-2 is far from users in China, and it can't be changed.
- **No separate place to test:** migrations reach real users the moment they are pushed. Run them locally first
  (`npm run db:reset && npm run test:db`).

Moving to a dedicated project later: create it, then follow the steps below with its ref. Data does not move by
itself.

Website set-up:

1. **Schema:** all migrations are applied (`npx supabase db push --linked`); `verify-photo` is deployed.
2. **Authentication settings** (dashboard):
   - minimum password length 6;
   - the "Magic Link" and "Confirm signup" email templates show the code (`{{ .Token }}`);
   - Site URL `https://vegalh.github.io/rootmapmvp/`.
3. **Email sending:** custom SMTP (Authentication › SMTP). Without it, only the project team's own addresses get
   codes.
4. **GitHub repository variables** (Settings › Secrets and variables › Actions › **Variables**: public values,
   not secrets):
   - `VITE_ROOTMAP_CLOUD=on`
   - optionally `VITE_ROOTMAP_ANALYTICS=on`
   - `VITE_SUPABASE_URL=https://cbgkkeveprftddrobzao.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…`
   - optionally `VITE_TURNSTILE_SITE_KEY`

   Never the secret key: the build refuses it. Unset, the website stays local-only.
5. **Deploy:** push to `main`. Then sign in on the website and set your password.
6. **Admin:** `select private.grant_admin('<email>');` in the SQL editor (already done for the owner).

### Phase 2B-1 implementation

| Migration | Contents |
|---|---|
| `20261012000100_ownership.sql` | `private` schema; `families`, `family_members`, `profiles`, `user_settings`; `private.my_family_ids()`, `private.is_family_member()`; `public.create_family()` |
| `20261012000200_family_tables.sql` | The 9 family-data tables, keys, foreign keys, checks, pull and per-child indexes |
| `20261012000300_revision_triggers.sql` | `t00_member` (membership checked first), `t10_*` reference checks and guards, `t90_stamp` (`rev`, `change_seq`, `server_updated_at`, `updated_by`) |
| `20261012000400_rls.sql` | RLS on all 13 tables; 35 policies; no delete policies |
| `20261012000500_storage.sql` | Private `family-photos` bucket (15 MB; JPEG, PNG, WebP, HEIC); `private.photo_object_allowed()`; storage select and insert policies |
| `20261012000600_grants.sql` | Nothing for `anon`; column-level insert/update for `authenticated`; no automatic grants on future objects |
| `20261012000700_complete_migration.sql` (M6) | `public.complete_migration()`; the `cloud_migrations` status guard lets only that function complete an attempt |
| `20261027000100_usage_analytics.sql` (staging 2026-10-27) | Usage analytics: `private.admins`, aggregate usage tables, `public.record_usage()`, `public.am_i_admin()`, `public.admin_usage_summary()` (section 20) |
| `20261027000200_admin_grants.sql` (staging 2026-10-27) | Owner-only `private.grant_admin(email)`, `private.revoke_admin(email)`, `private.list_admins()` (section 20.6) |

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
- Not yet built: the purge job, account deletion, and the WeChat identity table.
- Staging is on the Free plan: it pauses after 7 days of inactivity and has no backups. Test data only.

---

## 20. Usage analytics (admin only)

Added 2026-10-27. Migrations `20261027000100_usage_analytics.sql` and `20261027000200_admin_grants.sql` were applied
to staging on 2026-10-27 with the owner's approval (`supabase db push --linked`, after a dry run showed only these
two pending). Verified there: `anon` can execute only `record_usage`; the grant functions are executable by no
client role; client roles have no grants on the analytics tables; an anonymous summary request is refused. One
admin has been granted on staging.

### 20.1 What is counted

Four measures, all as totals:

| Measure | Source | New collection? |
|---|---|---|
| Registered accounts | `auth.users` with a confirmed email | No |
| Active people per day, last 7 / 30 days (accounts and guests apart) | `private.account_days` / `private.guest_days`: one row per person per active day | Yes: a day on which the app sent usage |
| Children by age (completed years) | `public.children.dob`, computed on the server on its current date; deleted children (`deleted_at`) and demo children (`origin = 'demo'`) are left out | No |
| Time in the app; feature impressions, clicks and click rate | `private.usage_time`, `private.usage_counts` | Yes |

Features (`src/lib/analytics/catalog.ts`, mirrored by the whitelist in `record_usage()`; a unit test compares them):

| Feature | Impression | Click |
|---|---|---|
| `today.inspiration` | Today shown | Today's Inspiration opened |
| `today.lookingBack` | Looking Back shown on Today | A memory opened from it |
| `discover.activities` / `.books` / `.collections` | That Discover tab shown | An activity / book / collection opened from it |
| `activity.detail` | Activity or music page shown | Any of its actions (save or unsave, Add to My Week, Mark as Tried) |
| `activity.save` | Activity or music page shown | Saved (not unsaved) |
| `activity.addToWeek` | Activity or music page shown | Add to My Week |
| `activity.markTried` | Activity or music page shown | Mark as Tried |
| `music.play` | A playable recording shown | Play |
| `collection.save` | Collection page shown | Collection saved |
| `myWeek.saved` | My Week shown | A saved activity or collection opened |
| `moments.add` | Moments shown | Capture a Moment |

Rules:

- **Impressions:** at most one per feature per page visit. A visit starts when the page address changes, so
  re-renders, a language switch or a list refreshing in place never add one. Switching Discover tabs is a new visit
  of that tab. A reload is a new visit.
- **Click rate** = clicks ÷ impressions; "—" when there were no impressions, or when either number is hidden.
- **Active time:** only while the app is visible and the parent did something (tap, key, scroll) within the last
  60 seconds. Going to the background pauses at once. Coming back, or the next action, resumes. A gap of more than
  60 seconds adds only those 60 seconds. A device asleep without a visibility event, or a clock jump, adds at most
  60 seconds. A clock going backwards adds nothing. Each device and each person is capped at 12 hours a day.
  Only seconds per day are sent, never sessions or times.
- **Per person per day** = total seconds ÷ active person-days in the range.
- Days are the device's local date. Ages are on the server's date (UTC). A child born on 29 February turns one year
  older on 1 March in other years (`private.whole_years`).

### 20.2 Data boundaries

- Email is used only to count registered accounts. Ages are computed from children in families. The summary returns
  only "age → number of children".
- **The behaviour tables have no identity.** `usage_counts` is `(day, audience, feature, kind) → count` and
  `usage_time` is `(day, audience) → seconds`. They have no user id, family id, email, device id, guest id, batch id
  or timestamp. Each batch is added into the day's totals, so one family's activity can't be read back from them.
- Who was active is kept apart, only to count distinct people. `account_days` holds `(user_id, day)`. `guest_days`
  holds `(sha256("rootmap-guest:" + guest id), day)`. Both hold only per-day counters for rate limiting, no
  behaviour. A signed-in batch must not carry a guest id (refused), so a guest id is never linked to an account.
- Never sent or stored: names, children's ids or names, birthdates, activity ids, text, photos, exact times.
  `record_usage()` refuses any field outside its whitelist.
- **Small numbers:** the server returns every count from 1 to 2 as `null` (shown as "<3"). It hides a day's time
  when that day had fewer than 3 active people. The page can't show an exact small number because it never receives
  one.
- The admin page has no per-family, per-person or per-day-per-person view.
- Retention: retried-batch ids (`usage_batches`) are kept 14 days. The other tables are kept until a purge job
  exists (not built yet).

### 20.3 Write path and limits

`public.record_usage(batch jsonb)` (security definer, `search_path = ''`):

- It is the only function `anon` can execute. It needs no session, so a guest can count without signing in,
  entering an email or using a code. `anon` still has no table grants.
- It accepts exactly `{ v: 1, batch_id, day, guest_id (guests only), events: [{ feature, kind, count }], seconds }`.
  Anything else is refused with `22023` and writes nothing.
- Limits:
  - the payload is at most 8 KB;
  - each count is 1–500;
  - seconds are at most 12 hours;
  - the day is within the last week (or tomorrow, for time zones ahead of the server);
  - per person per day: 100 batches and 5,000 events (`54000`), and 12 hours (extra time is dropped);
  - server-wide per day: 10,000 new guests and 100,000 guest batches (`54000`).
- A retried `batch_id` is accepted without counting twice.

Abuse that remains possible: someone can invent guest ids and add plausible-looking counts within these limits.
The numbers are product signals, not billing figures. The guest/account split in `daily` shows guest traffic
separately.

### 20.4 Guests and their limits

- A guest device makes a random UUID (`rootmap.usage-guest-id` in localStorage) the first time it sends. The id is
  used only for this, and only its hash reaches the database.
- Clearing site data, a private window, another browser or another device means a new guest. Guest counts are
  therefore upper bounds of real people.
- Turning sharing off deletes the guest id. Turning it on again makes a new guest.

### 20.5 Switches

- **Build:** `VITE_ROOTMAP_ANALYTICS=on` (default off). It needs `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`, with the same rules as the cloud, but not `VITE_ROOTMAP_CLOUD`. A guest-only
  staging build can therefore count anonymously.
- **Public website:** allowed since 2026-10-27, by the owner's decision, with the privacy review still open. It
  uses the rootmap-staging project (section 19, "The public website uses rootmap-staging"). Only a secret key is
  refused (`assertSafeClientEnv`).
- **Parent:** Profile › Privacy & Data › "Share anonymous usage statistics" (`rootmap.usage-sharing`, device-wide,
  outside the spaces and backups). It is **off by default**. Turning it off stops counting and sending at once, and
  deletes the queue (`rootmap.usage-pending`) and the guest id.
- **Turning analytics off entirely:** build without `VITE_ROOTMAP_ANALYTICS` (devices then keep at most a leftover
  queue of under 50 batches, never sent). On the server, `revoke execute on function public.record_usage(jsonb) from
  anon, authenticated;` in a new migration stops all writes.

### 20.6 Admins

**Where:** Profile › Account › **Admin Dashboard** (管理后台), at `#/admin`. The row appears only for admins, and only
in a cloud build with a signed-in account. The public website and guest-only builds have no dashboard.

**The security boundary is the database.** Hiding the row is only a convenience.

- Admins are rows in `private.admins(user_id)`. No client role (`anon`, `authenticated`, `service_role`) can read or
  change that table. `private` is not in the API.
- `public.am_i_admin()` takes no arguments. `public.admin_usage_summary(p_days)` takes only the range (7, 30 or 90).
  Both decide from `auth.uid()` alone, through `private.is_admin()`. No user id, email or role from the client is
  ever used.
- The summary checks on **every** call and refuses everyone else with `42501`. That includes a signed-in parent who
  opens `#/admin` directly or calls the RPC by hand.
- The app asks `am_i_admin()` again whenever Profile or the dashboard opens and when the app returns to the
  foreground. When the dashboard is refused, the row is hidden at once.

**Granting and revoking** (migration `20261027000200_admin_grants.sql`). These are owner-only functions: their
execute grant is revoked from every client role, including `service_role`. Run them in the Supabase SQL editor of
the project concerned (staging now; production later). The editor runs as the database owner.

1. The person signs in to RootMap once with their email (in a cloud build of that project), so their account exists.
2. The owner runs:

```sql
-- Give access (case-insensitive). Fails with "no RootMap account signs in with …" if the account doesn't exist yet.
select private.grant_admin('their-login@example.com');

-- Take it away. Returns true if they were an admin. Takes effect on their very next request; no sign-out needed.
select private.revoke_admin('their-login@example.com');

-- Who has access now.
select * from private.list_admins();
```

3. They open Profile (or bring the app back to the foreground). "Admin Dashboard" appears, or disappears after a
   revocation.

Rules:

- Never write an email into the repository, a migration or the front end. Run the statements in the SQL editor
  only.
- An admin account must be a real RootMap login. Deleting the auth user removes the admin row too.
- A grant through a migration (for example for a fresh environment) uses the same function, with the email
  supplied when the migration is written for that environment, never committed. The SQL editor is the normal
  path.

The dashboard needs a cloud build with a signed-in admin. It never uses the service-role key.

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
